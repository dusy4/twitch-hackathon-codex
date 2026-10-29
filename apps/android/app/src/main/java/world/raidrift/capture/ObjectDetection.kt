package world.raidrift.capture

import android.content.Context
import android.graphics.Bitmap
import android.media.Image
import android.os.SystemClock
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.objectdetector.ObjectDetector
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

data class DetectionBatch(val detections: List<Detection>, val capturedAt: Long, val latencyMs: Long)

/**
 * On-device MediaPipe EfficientDet-Lite0 (COCO) on ARCore CPU camera images.
 * The render thread only copies the YUV planes (then the caller closes the Image);
 * conversion, rotation and inference run on one background thread, one frame at a time.
 */
class DetectorWorker(private val context: Context) {
    private val executor: ExecutorService = Executors.newSingleThreadExecutor { Thread(it, "RaidRiftDetector").apply { priority = Thread.NORM_PRIORITY - 1 } }
    private val busy = AtomicBoolean(false)
    private val closed = AtomicBoolean(false)
    val latest = AtomicReference<DetectionBatch?>(null)
    @Volatile var status = "Detector not started"; private set
    @Volatile var fps = 0f; private set
    @Volatile var latencyMs = 0L; private set
    private var detector: ObjectDetector? = null
    private var initFailed = false
    private var bitmap: Bitmap? = null
    private var y = ByteArray(0); private var u = ByteArray(0); private var v = ByteArray(0)
    private var runs = 0; private var since = SystemClock.elapsedRealtime()

    val idle get() = !busy.get() && !closed.get() && !initFailed

    /** Main thread. Copies the planes; the caller still owns and must close [image]. */
    fun submit(image: Image, mapping: ImageToView): Boolean {
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
            executor.execute { run(yRow, uvRow, uvPixel, width, height, mapping, captured) }
            return true
        } catch (_: Exception) { busy.set(false); return false }
    }

    private fun run(yRow: Int, uvRow: Int, uvPixel: Int, width: Int, height: Int, mapping: ImageToView, captured: Long) {
        try {
            if (closed.get()) return
            val model = detector ?: createDetector() ?: return
            val step = if (maxOf(width, height) > 400) maxOf(1, maxOf(width, height) / 320) else 1
            val rotation = mapping.rotation
            val (pixels, ow, oh) = yuvToUprightArgb(y, yRow, u, v, uvRow, uvPixel, width, height, step, rotation)
            val bmp = bitmap?.takeIf { it.width == ow && it.height == oh } ?: Bitmap.createBitmap(ow, oh, Bitmap.Config.ARGB_8888).also { bitmap?.recycle(); bitmap = it }
            bmp.setPixels(pixels, 0, ow, 0, 0, ow, oh)
            val result = model.detect(BitmapImageBuilder(bmp).build())
            // Detector boxes are in upright-bitmap pixels; scale back to full-resolution upright pixels.
            val scale = step.toFloat()
            val detections = result.detections().mapNotNull { d ->
                val category = d.categories().maxByOrNull { it.score() } ?: return@mapNotNull null
                val label = category.categoryName()
                if (label !in INTEREST_CLASSES) return@mapNotNull null
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

    private fun createDetector(): ObjectDetector? = try {
        status = "Loading detector model…"
        val options = ObjectDetector.ObjectDetectorOptions.builder()
            .setBaseOptions(BaseOptions.builder().setModelAssetPath(MODEL_ASSET).build())
            .setRunningMode(RunningMode.IMAGE)
            .setMaxResults(12)
            .setScoreThreshold(0.35f)
            .setCategoryAllowlist(INTEREST_CLASSES.toList())
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

    companion object { const val MODEL_ASSET = "models/efficientdet_lite0.tflite" }
}
