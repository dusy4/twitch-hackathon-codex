using System;
using Unity.Collections;
using UnityEngine;
using UnityEngine.Rendering;
#if UNITY_ANDROID && !UNITY_EDITOR
using UnityEngine.Android;
#endif

namespace RaidRift
{
    [Serializable]
    public class LiveSettings
    {
        public string url;
        public string key;
        public int fps = 30;
        public int startKbps = 4000, minKbps = 800, maxKbps = 6000;
        public bool adaptive = true;
        public bool mic = true;
        public bool landscape = true;
    }

    /// <summary>Clean AR camera -> GPU NV12 -> async direct buffers -> Android H.264/AAC publisher.
    /// Main-thread API. Caller binds View to Hud.SetBackdrop after StartLive/state changes.</summary>
    public class LivePublisher : MonoBehaviour
    {
        public Camera arCamera;
        [Tooltip("GLES uses false. Diagnostic override for device orientation tests only.")]
        public bool flipVideoY;
        public bool IsLive { get; private set; }
        public string State { get; private set; } = "idle";
        public int BitrateKbps { get; private set; }
        public float SendFps { get; private set; }
        public int DroppedFrames => _localDrops + _networkDrops;
        public float UptimeSeconds { get; private set; }
        /// <summary>Sessions rebuilt by the stuck-reconnect watchdog (shown in Setup diagnostics).</summary>
        public int Restarts { get; private set; }
        public event Action<string> StateChanged;
        public RenderTexture View => _view;
        bool _micMuted;
        float _gameVolume = 1;
        public bool MicMuted
        {
            get => _micMuted;
            set { _micMuted = value; SetMix(); }
        }
        public float GameVolume
        {
            get => _gameVolume;
            set { _gameVolume = float.IsNaN(value) ? 0 : Mathf.Clamp01(value); SetMix(); }
        }

        RenderTexture _view;
        Material _convert;
        LiveAudioTap _audioTap;
        LiveSettings _settings, _resume;
        int _generation, _localDrops, _networkDrops, _targetFps;
        bool _ownsSleep;
        int _previousSleep = SleepTimeout.SystemSetting;
#if UNITY_ANDROID && !UNITY_EDITOR
        double _nextFrame, _nextStats, _lastPump, _stuckSince;
        int _width, _height;
        AndroidJavaObject _bridge;
        IntPtr _submit, _audioPush;
        readonly jvalue[] _videoArgs = new jvalue[3], _audioArgs = new jvalue[2];
        NativeArray<byte> _audioBytes;
        IntPtr _audioBuffer;
        sealed class Slot
        {
            public NativeArray<byte> bytes;
            public IntPtr buffer;
            public RenderTexture packed;
            public AsyncGPUReadbackRequest request;
            public long timestamp;
            public int phase; // 0 free, 1 GPU owns memory, 2 codec owns memory
        }
        readonly Slot[] _slots = new Slot[3];
#endif

        public void StartLive(LiveSettings settings)
        {
            StopLive();
            if (!isActiveAndEnabled) { SetState("error: publisher disabled"); return; }
            if (settings == null || string.IsNullOrWhiteSpace(settings.url))
            { SetState("error: ingest URL required"); return; }
            if (arCamera == null) { SetState("error: AR camera required"); return; }
            if (arCamera.targetTexture != null) { SetState("error: camera already captured"); return; }
            _settings = Copy(settings);
            _localDrops = _networkDrops = 0;
            _targetFps = _settings.fps;
            BitrateKbps = _settings.startKbps;
            SetState("connecting");
#if UNITY_ANDROID && !UNITY_EDITOR
            if (_settings.mic && !Permission.HasUserAuthorizedPermission(Permission.Microphone))
            {
                int generation = _generation;
                var callbacks = new PermissionCallbacks();
                callbacks.PermissionGranted += _ => { if (generation == _generation) Begin(); };
                callbacks.PermissionDenied += _ => { if (generation == _generation) Fail("microphone permission denied"); };
                Permission.RequestUserPermission(Permission.Microphone, callbacks);
            }
            else Begin();
#else
            Fail("Android device required");
#endif
        }

        static LiveSettings Copy(LiveSettings s) => new LiveSettings
        {
            url = s.url.Trim(), key = s.key ?? "", fps = Mathf.Clamp(s.fps, 1, 60),
            minKbps = Mathf.Clamp(s.minKbps, 100, 6000),
            maxKbps = Mathf.Clamp(s.maxKbps, Mathf.Clamp(s.minKbps, 100, 6000), 10000),
            startKbps = Mathf.Clamp(s.startKbps, Mathf.Clamp(s.minKbps, 100, 6000),
                Mathf.Clamp(s.maxKbps, Mathf.Clamp(s.minKbps, 100, 6000), 10000)),
            adaptive = s.adaptive, mic = s.mic, landscape = s.landscape
        };

        public static Vector4 Crop(int sourceWidth, int sourceHeight, int width, int height)
        {
            float sourceAspect = sourceWidth / (float)sourceHeight, targetAspect = width / (float)height;
            var scale = sourceAspect > targetAspect
                ? new Vector2(targetAspect / sourceAspect, 1) : new Vector2(1, sourceAspect / targetAspect);
            return new Vector4(scale.x, scale.y, (1 - scale.x) * 0.5f, (1 - scale.y) * 0.5f);
        }

#if UNITY_ANDROID && !UNITY_EDITOR
        void Begin()
        {
            try
            {
                if (!SystemInfo.supportsAsyncGPUReadback) { Fail("async GPU readback unavailable"); return; }
                if (arCamera == null || arCamera.targetTexture != null) { Fail("camera already captured"); return; }
                var listener = FindFirstObjectByType<AudioListener>();
                if (listener == null || !listener.isActiveAndEnabled) { Fail("active AudioListener required"); return; }
                var oldTap = listener.GetComponent<LiveAudioTap>();
                // Go live again while live: the previous session's tap is disabled but its Destroy is deferred to the
                // end of the frame. Remove it now instead of failing the new session with "audio already captured".
                if (oldTap != null && !oldTap.enabled) { DestroyImmediate(oldTap); oldTap = null; }
                if (oldTap != null) { Fail("audio already captured"); return; }
                bool landscape = Screen.width > 0 && Screen.height > 0
                    ? Screen.width > Screen.height : _settings.landscape;
                _width = landscape ? 1280 : 720; _height = landscape ? 720 : 1280;
                var shader = Resources.Load<Shader>("LiveNv12");
                if (shader == null || !shader.isSupported) { Fail("NV12 shader unavailable"); return; }
                _convert = new Material(shader);
                _convert.SetVector("_Size", new Vector4(_width, _height, _width / 4, _height * 3 / 2));
                _view = new RenderTexture(Screen.width, Screen.height, 24, RenderTextureFormat.ARGB32)
                { name = "Live clean AR", useMipMap = false, antiAliasing = 1 };
                _view.Create(); arCamera.targetTexture = _view;
                for (int i = 0; i < _slots.Length; i++)
                {
                    var slot = _slots[i] = new Slot();
                    slot.bytes = new NativeArray<byte>(_width * _height * 3 / 2, Allocator.Persistent);
                    slot.buffer = DirectBuffer(slot.bytes);
                    slot.packed = new RenderTexture(_width / 4, _height * 3 / 2, 0,
                        RenderTextureFormat.ARGB32, RenderTextureReadWrite.Linear)
                    { name = "Live NV12 " + i, filterMode = FilterMode.Point, useMipMap = false, antiAliasing = 1 };
                    slot.packed.Create();
                }
                _audioTap = listener.gameObject.AddComponent<LiveAudioTap>();
                _audioBytes = new NativeArray<byte>(960 * 4, Allocator.Persistent);
                _audioBuffer = DirectBuffer(_audioBytes);
                using (var player = new AndroidJavaClass("com.unity3d.player.UnityPlayer"))
                using (var activity = player.GetStatic<AndroidJavaObject>("currentActivity"))
                    _bridge = new AndroidJavaObject("com.raidrift.live.LiveBridge", activity,
                        _settings.url, _settings.key, _width, _height, _settings.fps,
                        _settings.startKbps, _settings.minKbps, _settings.maxKbps, _settings.adaptive, _settings.mic);
                _submit = AndroidJNI.GetMethodID(_bridge.GetRawClass(), "submitVideo", "(Ljava/nio/ByteBuffer;JI)Z");
                _audioPush = AndroidJNI.GetMethodID(_bridge.GetRawClass(), "pushGameAudio", "(Ljava/nio/ByteBuffer;I)Z");
                SetMix();
                _previousSleep = Screen.sleepTimeout; _ownsSleep = true;
                Screen.sleepTimeout = SleepTimeout.NeverSleep;
                _nextFrame = _nextStats = 0;
                Camera.onPostRender += Capture;
                // View is now available for the caller's HUD backdrop.
                StateChanged?.Invoke(State);
            }
            catch (Exception) { Fail("publisher initialization failed"); }
        }

        static IntPtr DirectBuffer(NativeArray<byte> bytes)
        {
            IntPtr local = AndroidJNI.NewDirectByteBuffer(bytes);
            if (local == IntPtr.Zero) throw new InvalidOperationException("Direct buffer unavailable");
            IntPtr global = AndroidJNI.NewGlobalRef(local);
            AndroidJNI.DeleteLocalRef(local);
            return global;
        }

        void Capture(Camera camera)
        {
            if (camera != arCamera || _bridge == null || _view == null || _settings == null) return;
            double time = Time.realtimeSinceStartupAsDouble;
            double period = 1.0 / Math.Max(1, _targetFps);
            // Vsync jitter: a frame a hair early must not be skipped (that turns 30 fps into uneven 15/30 judder).
            if (time < _nextFrame - period * 0.25) return;
            _nextFrame = _nextFrame == 0 || time - _nextFrame > period * 2
                ? time + period : _nextFrame + period;
            Slot slot = null;
            for (int i = 0; i < _slots.Length; i++) if (_slots[i] != null && _slots[i].phase == 0) { slot = _slots[i]; break; }
            if (slot == null) { _localDrops++; return; }
            var previous = RenderTexture.active;
            try
            {
                slot.timestamp = _bridge.Call<long>("clockUs");
                _convert.SetVector("_Crop", Crop(_view.width, _view.height, _width, _height));
                _convert.SetFloat("_FlipY", flipVideoY ? 1 : 0);
                Graphics.Blit(_view, slot.packed, _convert);
                slot.request = AsyncGPUReadback.RequestIntoNativeArray(ref slot.bytes, slot.packed, 0, TextureFormat.RGBA32);
                slot.phase = 1;
            }
            catch (Exception) { Fail("video readback failed"); }
            finally { RenderTexture.active = previous; }
        }
#endif

        void Update()
        {
#if UNITY_ANDROID && !UNITY_EDITOR
            if (_bridge == null) return;
            if (arCamera == null || arCamera.targetTexture != _view)
            { Fail("camera capture interrupted"); return; }
            try
            {
                int released = _bridge.Call<int>("takeReleasedSlots");
                for (int i = 0; i < _slots.Length; i++)
                {
                    var slot = _slots[i];
                    if (slot.phase == 2 && (released & (1 << i)) != 0) slot.phase = 0;
                    if (slot.phase != 1 || !slot.request.done) continue;
                    if (slot.request.hasError) { slot.phase = 0; _localDrops++; continue; }
                    _videoArgs[0].l = slot.buffer; _videoArgs[1].j = slot.timestamp; _videoArgs[2].i = i;
                    bool accepted = AndroidJNI.CallBooleanMethod(_bridge.GetRawObject(), _submit, _videoArgs);
                    slot.phase = accepted ? 2 : 0;
                    if (!accepted) _localDrops++;
                }
                PumpGameAudio();
                if (Screen.width > 0 && Screen.height > 0 && (_view.width != Screen.width || _view.height != Screen.height))
                {
                    _view.Release(); _view.width = Screen.width; _view.height = Screen.height; _view.Create();
                }
                if (Time.realtimeSinceStartupAsDouble < _nextStats) return;
                _nextStats = Time.realtimeSinceStartupAsDouble + 0.25;
                IsLive = _bridge.Call<bool>("isLive");
                BitrateKbps = _bridge.Call<int>("getBitrateKbps");
                SendFps = _bridge.Call<float>("getSendFps");
                _networkDrops = _bridge.Call<int>("getDroppedFrames");
                UptimeSeconds = _bridge.Call<float>("getUptimeSeconds");
                _targetFps = _bridge.Call<int>("getTargetFps");
                string state = _bridge.Call<string>("getState");
                if (state.StartsWith("error:", StringComparison.Ordinal)) { StopInternal(); SetState(state); }
                else SetState(state);
                // Street safety: a blackholed cell connection can leave RootEncoder's reconnect blocked in a socket
                // write for minutes. After 30 s without going live, rebuild the whole session (fresh bridge,
                // encoders and socket) through the normal start path instead of waiting on the stuck transport.
                bool stuck = !IsLive && (state == "connecting" || state.StartsWith("reconnecting", StringComparison.Ordinal));
                double t = Time.realtimeSinceStartupAsDouble;
                if (!stuck) _stuckSince = 0;
                else if (_stuckSince == 0) _stuckSince = t;
                else if (t - _stuckSince > 30 && _settings != null)
                {
                    var again = _settings;
                    _stuckSince = 0;
                    Restarts++;
                    StartLive(again);
                    return;
                }
            }
            catch (Exception) { Fail("Android publisher failed"); }
#endif
        }

#if UNITY_ANDROID && !UNITY_EDITOR
        void PumpGameAudio()
        {
            var ring = _audioTap.Ring;
            // Main-thread stalls must not replay stale game sound. After a long stall the ring is full of OLD
            // samples (overflow drops the new ones), so keeping its tail would still be ~1 s late: drop it all.
            double now = Time.realtimeSinceStartupAsDouble;
            if (now - _lastPump > 0.2) ring.Trim(0); else ring.Trim(3840);
            _lastPump = now;
            for (int chunk = 0; chunk < 4 && ring.Available > 0; chunk++)
            {
                int frames = Math.Min(960, ring.Available);
                for (int i = 0; i < frames; i++)
                {
                    ring.Read(out float left, out float right);
                    WritePcm(_audioBytes, i * 4, left); WritePcm(_audioBytes, i * 4 + 2, right);
                }
                _audioArgs[0].l = _audioBuffer; _audioArgs[1].i = frames * 2;
                AndroidJNI.CallBooleanMethod(_bridge.GetRawObject(), _audioPush, _audioArgs);
            }
        }
        static void WritePcm(NativeArray<byte> bytes, int index, float sample)
        {
            int value = float.IsNaN(sample) ? 0 : Mathf.RoundToInt(Mathf.Clamp(sample, -1, 1) * 32767);
            bytes[index] = (byte)value; bytes[index + 1] = (byte)(value >> 8);
        }
#endif

        void SetMix()
        {
#if UNITY_ANDROID && !UNITY_EDITOR
            if (_bridge == null) return;
            try { _bridge.Call("setMicMuted", _micMuted); _bridge.Call("setGameVolume", _gameVolume); }
            catch (Exception) { Fail("audio controls unavailable"); }
#endif
        }

        public void StopLive()
        {
            _resume = null;
            StopInternal();
            SetState("idle");
        }
        void StopInternal()
        {
            _generation++; _settings = null;
#if UNITY_ANDROID && !UNITY_EDITOR
            Camera.onPostRender -= Capture;
            _stuckSince = 0; _lastPump = 0; // a new session gets its own connect window and audio clock
            // Java's copy barrier releases ALL direct memory before NativeArrays.
            if (_bridge != null) { _bridge.Call("stop"); _bridge.Dispose(); _bridge = null; }
            for (int i = 0; i < _slots.Length; i++)
            {
                var slot = _slots[i];
                if (slot == null) continue;
                if (slot.phase == 1 && !slot.request.done) slot.request.WaitForCompletion();
                if (slot.buffer != IntPtr.Zero) AndroidJNI.DeleteGlobalRef(slot.buffer);
                if (slot.bytes.IsCreated) slot.bytes.Dispose();
                Release(slot.packed); _slots[i] = null;
            }
            if (_audioBuffer != IntPtr.Zero) AndroidJNI.DeleteGlobalRef(_audioBuffer);
            _audioBuffer = IntPtr.Zero;
            if (_audioBytes.IsCreated) _audioBytes.Dispose();
#endif
            if (_audioTap != null) { _audioTap.enabled = false; Destroy(_audioTap); _audioTap = null; }
            if (arCamera != null && arCamera.targetTexture == _view) arCamera.targetTexture = null;
            Release(_view); _view = null;
            if (_convert != null) { Destroy(_convert); _convert = null; }
            if (_ownsSleep) { Screen.sleepTimeout = _previousSleep; _ownsSleep = false; }
            IsLive = false; SendFps = 0; UptimeSeconds = 0; BitrateKbps = 0;
        }
        static void Release(RenderTexture texture)
        {
            if (texture == null) return;
            texture.Release(); Destroy(texture);
        }
        void Fail(string reason) { StopInternal(); SetState("error: " + reason); }
        void SetState(string state)
        {
            if (State == state) return;
            State = state; StateChanged?.Invoke(state);
        }
        void OnApplicationPause(bool paused)
        {
            if (paused && _view != null)
            {
                _resume = _settings;
                StopInternal(); SetState("idle");
            }
            else if (!paused && _resume != null)
            {
                var settings = _resume; _resume = null; StartLive(settings);
            }
        }
        void OnDisable() => StopLive();
        void OnDestroy() => StopLive();
    }
}
