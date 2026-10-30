package world.raidrift.capture

import android.content.Context
import android.content.Intent
import android.media.MediaRecorder
import android.media.MediaExtractor
import android.media.MediaFormat
import android.os.Environment
import android.view.Surface
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.core.content.FileProvider
import io.github.sceneview.utils.SurfaceMirrorer
import java.io.File

/** Explicit, silent, local capture of the rendered camera+virtual scene. Never uploads. */
class LocalClip(private val context: Context, private val mirror: SurfaceMirrorer) {
    var recording by mutableStateOf(false); private set
    var file by mutableStateOf<File?>(null); private set
    var message by mutableStateOf("Silent MP4 · saved only on this device"); private set
    private var recorder: MediaRecorder? = null
    /** SurfaceMirrorer matches Java Surface identity; MediaRecorder.getSurface may wrap anew. */
    private var inputSurface: Surface? = null
    init {
        context.getExternalFilesDir(Environment.DIRECTORY_MOVIES)?.let { root ->
            file = File(root, "raidrift").listFiles { candidate -> candidate.isFile && candidate.name.startsWith("raidrift-") && candidate.extension == "mp4" }
                ?.maxByOrNull { it.lastModified() }
            if (file != null) message = "Previous local clip recovered · review or discard before recording again"
        }
    }

    @Suppress("DEPRECATION")
    fun start() {
        check(!recording && file == null) { "Share or discard the previous clip first" }
        val storage = context.getExternalFilesDir(Environment.DIRECTORY_MOVIES)
            ?: run { message = "Device storage is unavailable"; return }
        val folder = File(storage, "raidrift")
        if (!folder.isDirectory && !folder.mkdirs()) { message = "Device storage is unavailable"; return }
        val destination = File(folder, "raidrift-pending.mp4")
        val capture = MediaRecorder()
        var surface: Surface? = null
        try {
            capture.setVideoSource(MediaRecorder.VideoSource.SURFACE)
            capture.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            capture.setVideoEncoder(MediaRecorder.VideoEncoder.H264)
            capture.setVideoSize(1280, 720)
            capture.setVideoFrameRate(30)
            capture.setVideoEncodingBitRate(4_000_000)
            capture.setMaxDuration(20_000)
            capture.setMaxFileSize(12_000_000)
            capture.setOnInfoListener { _, what, _ ->
                if (what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED || what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_FILESIZE_REACHED) stop()
            }
            capture.setOutputFile(destination.absolutePath)
            capture.prepare()
            surface = capture.surface
            mirror.startMirroring(surface, width = 1280, height = 720)
            capture.start()
            recorder = capture; inputSurface = surface; file = destination; recording = true
            message = "Recording · stops automatically after 20 seconds · no audio"
        } catch (_: Exception) {
            surface?.let { runCatching { mirror.stopMirroring(it) } }
            capture.release(); surface?.release(); destination.delete()
            message = "Video encoder could not start. Recording is unavailable on this device."
        }
    }

    fun stop() {
        val capture = recorder ?: return
        recorder = null
        val surface = inputSurface; inputSurface = null
        surface?.let { runCatching { mirror.stopMirroring(it) } }
        val completed = runCatching { capture.stop() }.isSuccess
        capture.release(); surface?.release(); recording = false
        val valid = completed && file?.let { candidate ->
            if (candidate.length() == 0L) false else runCatching {
                val probe = MediaExtractor()
                try {
                    probe.setDataSource(candidate.absolutePath)
                    (0 until probe.trackCount).any { probe.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("video/") == true }
                } finally { probe.release() }
            }.getOrDefault(false)
        } == true
        if (!valid) {
            file?.delete(); file = null; message = "Recording was interrupted or invalid; discarded. Try again or use Broadcast."
        } else message = "Local clip ready · review before sharing · no audio"
    }

    fun discard() { stop(); file?.delete(); file = null; message = "Clip discarded" }
    fun share() {
        check(!recording)
        val clip = file ?: return
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.captures", clip)
        context.startActivity(Intent.createChooser(Intent(Intent.ACTION_SEND).apply {
            type = "video/mp4"; putExtra(Intent.EXTRA_STREAM, uri)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }, "Share your RaidRift clip"))
    }
}
