package world.raidrift.capture

import android.content.Context
import android.graphics.Bitmap
import android.media.Image
import android.os.SystemClock
import android.util.Base64
import androidx.core.graphics.createBitmap
import androidx.core.graphics.scale
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.objectdetector.ObjectDetector
import java.io.ByteArrayOutputStream
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

data class DetectionBatch(val detections: List<Detection>, val capturedAt: Long, val latencyMs: Long)

/** A JPEG of the displayed camera image, ready for POST v1/native/frame. */
class FrameJpeg(val frameId: String, val base64: String, val width: Int, val height: Int, val bytes: Int)

/**
 * On-device MediaPipe EfficientDet-Lite0 (all 80 COCO classes) on ARCore CPU camera images.
 * The render thread only copies the YUV planes (then the caller closes the Image);
 * conversion, rotation, inference and optional JPEG encoding for server detection run on one
 * background thread, one frame at a time.
 */
class DetectorWorker(private val context: Context) {
    private val executor: ExecutorService = Executors.newSingleThreadExecutor { Thread(it, "RaidRiftDetector").apply { priority = Thread.NORM_PRIORITY - 1 } }
    private val busy = AtomicBoolean(false)
    private val closed = AtomicBoolean(false)
    val latest = AtomicReference<DetectionBatch?>(null)
    /** Latest encoded frame waiting to be uploaded (consumed by the render loop). */
    val pendingUpload = AtomicReference<FrameJpeg?>(null)
    @Volatile var status = "Detector not started"; private set
    @Volatile var fps = 0f; private set
    @Volatile var latencyMs = 0L; private set
    @Volatile var uploadStatus = ""; private set
    private var detector: ObjectDetector? = null
    private var initFailed = false
    private var bitmap: Bitmap? = null
    private var y = ByteArray(0); private var u = ByteArray(0); private var v = ByteArray(0)
    private var runs = 0; private var since = SystemClock.elapsedRealtime()

    /** Ready for another image (uploads keep working even if the detector model failed to load). */
    val idle get() = !busy.get() && !closed.get()
    val detectorAvailable get() = !initFailed

    /**
     * Main thread. Copies the planes; the caller still owns and must close [image].
     * With [uploadFrameId], the same image is also encoded as a JPEG of the displayed region.
     */
    fun submit(image: Image, mapping: ImageToView, detect: Boolean = true, uploadFrameId: String? = null): Boolean {
        if (!detect && uploadFrameId == null) return false
        if (!busy.compareAndSet(false, true)) return false
        try {
            val planes = image.planes
            fun copy(index: Int, into: ByteArray): ByteArray {
                val buffer = planes[index].buffer.duplicate(); buffer.rewind()
                val target = if (into.size == buffer.remaining()) into else ByteArray(buffer.remaining())
                buffer.get(target); return target
            }
            y = copy(0, y); u = copy(1, u); v = copy(2, v)
            val yRow = planes[0].rowStride; val uvRow = planes[1].rowStride; val uvPixel = planes[1].pixelStride
            val width = image.width; val height = image.height
            val captured = SystemClock.elapsedRealtime()
            executor.execute { run(yRow, uvRow, uvPixel, width, height, mapping, captured, detect, uploadFrameId) }
            return true
        } catch (_: Exception) { busy.set(false); return false }
    }

    private fun run(yRow: Int, uvRow: Int, uvPixel: Int, width: Int, height: Int, mapping: ImageToView, captured: Long, detect: Boolean, uploadFrameId: String?) {
        try {
            if (closed.get()) return
            if (uploadFrameId != null) encode(yRow, uvRow, uvPixel, width, height, mapping, uploadFrameId)
            if (!detect || initFailed) return
            val model = detector ?: createDetector() ?: return
            val step = if (maxOf(width, height) > 400) maxOf(1, maxOf(width, height) / 320) else 1
            val rotation = mapping.rotation
            val (pixels, ow, oh) = yuvToUprightArgb(y, yRow, u, v, uvRow, uvPixel, width, height, step, rotation)
            val bmp = bitmap?.takeIf { it.width == ow && it.height == oh } ?: createBitmap(ow, oh).also { bitmap?.recycle(); bitmap = it }
            bmp.setPixels(pixels, 0, ow, 0, 0, ow, oh)
            val result = model.detect(BitmapImageBuilder(bmp).build())
            // Detector boxes are in upright-bitmap pixels; scale back to full-resolution upright pixels.
            val scale = step.toFloat()
            val detections = result.detections().mapNotNull { d ->
                val category = d.categories().maxByOrNull { it.score() } ?: return@mapNotNull null
                val label = category.categoryName()?.trim()?.takeIf { it.isNotEmpty() } ?: return@mapNotNull null
                val r = d.boundingBox()
                mapping.uprightBoxToView(r.left * scale, r.top * scale, r.right * scale, r.bottom * scale)?.let { Detection(label, category.score(), it) }
            }
            val now = SystemClock.elapsedRealtime()
            latencyMs = now - captured
            runs++
            if (now - since >= 1000) { fps = runs * 1000f / (now - since); runs = 0; since = now }
            status = "Detector running · ${detections.size} objects"
            latest.set(DetectionBatch(detections, captured, latencyMs))
        } catch (e: Throwable) {
            status = "Detector error: ${e.javaClass.simpleName} ${e.message?.take(80) ?: ""}"
        } finally { busy.set(false) }
    }

    /** Displayed region of the camera image, about 640 px wide, JPEG q70, at most 400 KB. */
    private fun encode(yRow: Int, uvRow: Int, uvPixel: Int, width: Int, height: Int, mapping: ImageToView, frameId: String) {
        try {
            val crop = visibleUprightCrop(mapping)
            val step = maxOf(1, Math.round(crop[2] / 640f))
            val (pixels, ow, oh) = yuvToUprightArgb(y, yRow, u, v, uvRow, uvPixel, width, height, step, mapping.rotation, crop)
            val bmp = Bitmap.createBitmap(pixels, ow, oh, Bitmap.Config.ARGB_8888)
            var jpeg = ByteArray(0); var outW = ow; var outH = oh
            try {
                for (quality in intArrayOf(70, 55, 40)) {
                    jpeg = ByteArrayOutputStream().use { out -> bmp.compress(Bitmap.CompressFormat.JPEG, quality, out); out.toByteArray() }
                    if (jpeg.size <= MAX_FRAME_BYTES) break
                }
                if (jpeg.size > MAX_FRAME_BYTES) {
                    val half = bmp.scale(maxOf(1, ow / 2), maxOf(1, oh / 2))
                    outW = half.width; outH = half.height
                    jpeg = ByteArrayOutputStream().use { out -> half.compress(Bitmap.CompressFormat.JPEG, 60, out); out.toByteArray() }
                    half.recycle()
                }
            } finally { bmp.recycle() }
            if (jpeg.isEmpty() || jpeg.size > MAX_FRAME_BYTES) { uploadStatus = "$frameId too large (${jpeg.size / 1024} KB)"; return }
            pendingUpload.set(FrameJpeg(frameId, Base64.encodeToString(jpeg, Base64.NO_WRAP), outW, outH, jpeg.size))
            uploadStatus = "$frameId encoded ${jpeg.size / 1024} KB ${outW}x$outH"
        } catch (e: Throwable) {
            uploadStatus = "JPEG error: ${e.javaClass.simpleName}"
        }
    }

    private fun createDetector(): ObjectDetector? = try {
        status = "Loading detector model…"
        // No category allowlist: all 80 COCO classes are reported.
        val options = ObjectDetector.ObjectDetectorOptions.builder()
            .setBaseOptions(BaseOptions.builder().setModelAssetPath(MODEL_ASSET).build())
            .setRunningMode(RunningMode.IMAGE)
            .setMaxResults(15)
            // 0.5: at 0.35 with all 80 classes EfficientDet-Lite0 called a magazine "surfboard" and a
            // backpack "dining table". Anything it misses, the PC's open-vocabulary detector finds by name.
            .setScoreThreshold(0.5f)
            .build()
        ObjectDetector.createFromOptions(context, options).also { detector = it; status = "Detector ready" }
    } catch (e: Throwable) {
        initFailed = true
        status = "Detector unavailable: ${e.javaClass.simpleName} ${e.message?.take(80) ?: ""}"
        null
    }

    fun close() {
        if (!closed.compareAndSet(false, true)) return
        executor.execute { runCatching { detector?.close() }; detector = null; bitmap?.recycle(); bitmap = null }
        executor.shutdown()
    }

    companion object {
        const val MODEL_ASSET = "models/efficientdet_lite0.tflite"
        /** JPEG cap; base64 adds a third, keeping the JSON body at or under ~400 KB. */
        const val MAX_FRAME_BYTES = 300 * 1024
    }
}
