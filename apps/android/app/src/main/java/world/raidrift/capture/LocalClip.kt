package world.raidrift.capture

import android.content.Context
import android.content.Intent
import android.media.MediaRecorder
import android.os.Environment
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

    @Suppress("DEPRECATION")
    fun start() {
        check(!recording && file == null) { "Share or discard the previous clip first" }
        val folder = File(context.getExternalFilesDir(Environment.DIRECTORY_MOVIES), "raidrift").apply { mkdirs() }
        val destination = File(folder, "raidrift-${System.currentTimeMillis()}.mp4")
        val capture = MediaRecorder()
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
            mirror.startMirroring(capture.surface, width = 1280, height = 720)
            capture.start()
            recorder = capture; file = destination; recording = true
            message = "Recording · stops automatically after 20 seconds · no audio"
        } catch (_: Exception) {
            runCatching { mirror.stopMirroring(capture.surface) }
            capture.release(); destination.delete()
            message = "Video encoder could not start. Recording is unavailable on this device."
        }
    }

    fun stop() {
        val capture = recorder ?: return
        recorder = null
        runCatching { mirror.stopMirroring(capture.surface) }
        val completed = runCatching { capture.stop() }.isSuccess
        capture.release(); recording = false
        if (!completed || file?.length() == 0L) {
            file?.delete(); file = null; message = "Clip was too short or interrupted; discarded."
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
