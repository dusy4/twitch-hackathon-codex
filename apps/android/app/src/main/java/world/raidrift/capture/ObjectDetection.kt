package world.raidrift.capture

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
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
import java.util.concurrent.atomic.AtomicInteger

data class DetectionBatch(val detections: List<Detection>, val capturedAt: Long, val latencyMs: Long, val context: ObservationContext? = null)

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
    private val generation = AtomicInteger(0)
    val latest = AtomicReference<DetectionBatch?>(null)
    /** Latest encoded frame waiting to be uploaded (consumed by the render loop). */
    val pendingUpload = AtomicReference<FrameJpeg?>(null)
    @Volatile var status = "Detector not started"; private set
    @Volatile var fps = 0f; private set
    @Volatile var latencyMs = 0L; private set
    @Volatile var uploadStatus = ""; private set
    private var detector: ObjectDetector? = null
    private var fastMode = false
    private var slowRuns = 0
    private var initFailed = false
    private var bitmap: Bitmap? = null
    private val resizePaint = Paint(Paint.FILTER_BITMAP_FLAG)
    private var y = ByteArray(0); private var u = ByteArray(0); private var v = ByteArray(0)
    private var runs = 0; private var since = SystemClock.elapsedRealtime()

    /** Ready for another image (uploads keep working even if the detector model failed to load). */
    val idle get() = !busy.get() && !closed.get()
    val detectorAvailable get() = !initFailed

    /**
     * Main thread. Copies the planes; the caller still owns and must close [image].
     * With [uploadFrameId], the same image is also encoded as a JPEG of the displayed region.
     */
    fun submit(image: Image, mapping: ImageToView, detect: Boolean = true, uploadFrameId: String? = null, observation: ObservationContext? = null): Boolean {
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
            val epoch = generation.get()
            executor.execute { run(yRow, uvRow, uvPixel, width, height, mapping, captured, detect, uploadFrameId, observation, epoch) }
            return true
        } catch (_: Exception) { busy.set(false); return false }
    }

    private fun run(yRow: Int, uvRow: Int, uvPixel: Int, width: Int, height: Int, mapping: ImageToView, captured: Long, detect: Boolean, uploadFrameId: String?, observation: ObservationContext?, epoch: Int) {
        try {
            if (closed.get() || epoch != generation.get()) return
            if (uploadFrameId != null) encode(yRow, uvRow, uvPixel, width, height, mapping, uploadFrameId)
            if (epoch != generation.get()) { pendingUpload.set(null); return }
            if (!detect || initFailed) return
            val model = detector ?: createDetector() ?: return
            // Detect the visible crop at >=448px before the model's own resize. Previously the
            // entire sensor was decimated to ~320px, then letterboxed, losing tiny room objects.
            val crop = visibleUprightCrop(mapping)
            val step = maxOf(1, maxOf(crop[2], crop[3]) / 640)
            val rotation = mapping.rotation
            val (pixels, ow, oh) = yuvToUprightArgb(y, yRow, u, v, uvRow, uvPixel, width, height, step, rotation, crop)
            val bmp = bitmap?.takeIf { it.width == ow && it.height == oh } ?: createBitmap(ow, oh).also { bitmap?.recycle(); bitmap = it }
            bmp.setPixels(pixels, 0, ow, 0, 0, ow, oh)
            // The task stretches non-square inputs. Pad explicitly: stretching turned the dog
            // fixture into "horse" and missed chairs. Preserve this transform through decoding.
            val inputSize = if (fastMode) 320 else MODEL_INPUT_SIZE
            val fit = Letterbox(ow, oh, inputSize)
            // MPImage owns and recycles its Bitmap on close. This padded input must not be reused.
            val square = createBitmap(inputSize, inputSize)
            square.eraseColor(android.graphics.Color.rgb(128, 128, 128))
            Canvas(square).drawBitmap(bmp, null, RectF(fit.padX, fit.padY, fit.padX + ow * fit.scale, fit.padY + oh * fit.scale), resizePaint)
            val input = BitmapImageBuilder(square).build()
            val result = try { model.detect(input) } finally { input.close() }
            // Detector boxes are in upright-bitmap pixels; scale back to full-resolution upright pixels.
            val sx = crop[2].toFloat() / ow; val sy = crop[3].toFloat() / oh
            val detections = result.detections().mapNotNull { d ->
                val category = d.categories().maxByOrNull { it.score() } ?: return@mapNotNull null
                val label = category.categoryName()?.trim()?.takeIf { it.isNotEmpty() } ?: return@mapNotNull null
                val r = d.boundingBox()
                val box = fit.toSource(r.left, r.top, r.right, r.bottom) ?: return@mapNotNull null
                mapping.uprightBoxToView(crop[0] + box[0] * sx, crop[1] + box[1] * sy, crop[0] + box[2] * sx, crop[1] + box[3] * sy)?.let { Detection(label, category.score(), it) }
            }
            val now = SystemClock.elapsedRealtime()
            latencyMs = now - captured
            runs++
            if (now - since >= 1000) { fps = runs * 1000f / (now - since); runs = 0; since = now }
            status = if (detections.isEmpty()) "Scanning · no confident objects yet" else "${detections.size} objects · ${latencyMs}ms"
            if (!closed.get() && epoch == generation.get()) latest.set(DetectionBatch(detections, captured, latencyMs, observation))
            // Thermal/slow-device fallback uses measured complete worker time, not a model FPS claim.
            slowRuns = if (latencyMs > 450) slowRuns + 1 else maxOf(0, slowRuns - 1)
            if (!fastMode && runs > 0 && slowRuns >= 4) {
                runCatching { detector?.close() }; detector = null; fastMode = true; slowRuns = 0
                status = "Using lighter recognition to keep the camera smooth"
            }
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
            if (!closed.get()) pendingUpload.set(FrameJpeg(frameId, Base64.encodeToString(jpeg, Base64.NO_WRAP), outW, outH, jpeg.size))
            uploadStatus = "$frameId encoded ${jpeg.size / 1024} KB ${outW}x$outH"
        } catch (e: Throwable) {
            uploadStatus = "JPEG error: ${e.javaClass.simpleName}"
        }
    }

    private fun createDetector(): ObjectDetector? = try {
        status = "Loading detector model…"
        // No category allowlist: all 80 COCO classes are reported.
        val options = ObjectDetector.ObjectDetectorOptions.builder()
            .setBaseOptions(BaseOptions.builder().setModelAssetPath(if (fastMode) "models/efficientdet_lite0.tflite" else MODEL_ASSET).build())
            .setRunningMode(RunningMode.IMAGE)
            .setMaxResults(15)
            // Low-score candidates are confirmed over multiple observations before 3D anchoring.
            .setScoreThreshold(0.32f)
            .build()
        ObjectDetector.createFromOptions(context, options).also { detector = it; status = "Detector ready" }
    } catch (e: Throwable) {
        if (!fastMode) {
            fastMode = true
            status = "Trying lighter object recognition…"
            createDetector()
        } else {
        initFailed = true
        status = "Detector unavailable: ${e.javaClass.simpleName} ${e.message?.take(80) ?: ""}"
        null
        }
    }

    fun close() {
        if (!closed.compareAndSet(false, true)) return
        executor.execute { runCatching { detector?.close() }; detector = null; bitmap?.recycle(); bitmap = null }
        executor.shutdown()
    }

    /** In-flight work from a previous AR session must never create anchors in a new session. */
    fun invalidate() { generation.incrementAndGet(); latest.set(null); pendingUpload.set(null) }

    companion object {
        const val MODEL_ASSET = "models/efficientdet_lite2_int8.tflite"
        const val MODEL_INPUT_SIZE = 448
        /** JPEG cap; base64 adds a third, keeping the JSON body at or under ~400 KB. */
        const val MAX_FRAME_BYTES = 300 * 1024
    }
}
