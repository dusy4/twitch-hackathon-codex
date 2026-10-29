package world.raidrift.arprobe;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.opengl.GLES20;
import android.opengl.GLSurfaceView;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.Gravity;
import android.widget.FrameLayout;
import android.widget.TextView;
import com.google.ar.core.Config;
import com.google.ar.core.Frame;
import com.google.ar.core.Plane;
import com.google.ar.core.PointCloud;
import com.google.ar.core.Session;
import com.google.ar.core.TrackingState;
import javax.microedition.khronos.egl.EGLConfig;
import javax.microedition.khronos.opengles.GL10;

/** Isolates ARCore plane detection from Filament/SceneView. Never synthesizes a plane. */
public final class ProbeActivity extends Activity implements GLSurfaceView.Renderer {
    private GLSurfaceView view;
    private TextView status;
    private Session session;
    private volatile boolean running;
    private int texture, width = 720, height = 1280;
    private long lastReport, frames, started;

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        FrameLayout root = new FrameLayout(this);
        view = new GLSurfaceView(this);
        view.setEGLContextClientVersion(3);
        view.setPreserveEGLContextOnPause(true);
        view.setRenderer(this);
        root.addView(view);
        status = new TextView(this);
        status.setTextColor(0xffffffff); status.setBackgroundColor(0xcc10121c);
        status.setTextSize(18); status.setPadding(24, 60, 24, 24);
        status.setText("QA ONLY · direct ARCore\nNo camera images are displayed or saved. Waiting for permission.");
        FrameLayout.LayoutParams params = new FrameLayout.LayoutParams(-1, -2, Gravity.TOP);
        root.addView(status, params); setContentView(root);
        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED)
            requestPermissions(new String[]{Manifest.permission.CAMERA}, 1);
    }
    @Override public void onResume() {
        super.onResume(); startSession();
    }
    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request, permissions, results);
        if (request == 1 && results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) startSession();
    }
    private void startSession() {
        if (running || checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) return;
        try {
            if (session == null) {
                session = new Session(this);
                Config config = new Config(session);
                config.setPlaneFindingMode(Config.PlaneFindingMode.HORIZONTAL_AND_VERTICAL);
                config.setDepthMode(Config.DepthMode.DISABLED);
                config.setLightEstimationMode(Config.LightEstimationMode.DISABLED);
                config.setUpdateMode(Config.UpdateMode.LATEST_CAMERA_IMAGE);
                session.configure(config);
            }
            session.resume(); running = true; started = SystemClock.elapsedRealtime(); frames = 0;
            view.onResume();
        } catch (Exception error) { report("Session failed: " + error.getClass().getSimpleName()); }
    }
    @Override public void onPause() {
        running = false; view.onPause(); if (session != null) session.pause(); super.onPause();
    }
    @Override public void onDestroy() {
        if (session != null) session.close(); super.onDestroy();
    }
    @Override public void onSurfaceCreated(GL10 gl, EGLConfig config) {
        int[] names = new int[1]; GLES20.glGenTextures(1, names, 0); texture = names[0];
        GLES20.glBindTexture(0x8D65, texture);
        GLES20.glTexParameteri(0x8D65, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR);
        GLES20.glTexParameteri(0x8D65, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR);
    }
    @Override public void onSurfaceChanged(GL10 gl, int w, int h) { width = w; height = h; GLES20.glViewport(0, 0, w, h); }
    @Override public void onDrawFrame(GL10 gl) {
        GLES20.glClearColor(0.03f, 0.04f, 0.06f, 1); GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT);
        if (!running || session == null || texture == 0) return;
        try {
            session.setCameraTextureName(texture);
            session.setDisplayGeometry(getWindowManager().getDefaultDisplay().getRotation(), width, height);
            Frame frame = session.update(); frames++;
            long now = SystemClock.elapsedRealtime();
            if (now - lastReport < 1000) return;
            lastReport = now;
            int tracked = 0, horizontal = 0, total = 0, points;
            for (Plane plane : session.getAllTrackables(Plane.class)) {
                total++;
                if (plane.getTrackingState() == TrackingState.TRACKING && plane.getSubsumedBy() == null) {
                    tracked++; if (plane.getType() == Plane.Type.HORIZONTAL_UPWARD_FACING) horizontal++;
                }
            }
            try (PointCloud cloud = frame.acquirePointCloud()) { points = cloud.getPoints().remaining() / 4; }
            int hits = frame.hitTest(width / 2f, height * .65f).size();
            report("QA ONLY · direct ARCore 1.57\nCamera: " + frame.getCamera().getTrackingState() + " / " + frame.getCamera().getTrackingFailureReason()
                + "\nPlanes total=" + total + " tracked=" + tracked + " floor=" + horizontal
                + "\nPoints=" + points + " centerHits=" + hits + "\nUpdate fps=" + (frames * 1000L / Math.max(1, now - started))
                + "\nConfig=" + session.getConfig().getPlaneFindingMode());
        } catch (Exception error) { report("Frame failed: " + error.getClass().getSimpleName()); }
    }
    private void report(String text) {
        android.util.Log.i("RaidRiftARProbe", text.replace('\n', ' '));
        runOnUiThread(() -> status.setText(text));
    }
}
