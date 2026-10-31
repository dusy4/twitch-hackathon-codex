using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using Unity.Collections;
using Unity.InferenceEngine;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.XR.ARFoundation;
using Debug = UnityEngine.Debug;

namespace RaidRift
{
    public struct Detection
    {
        public int classId;
        public string label;
        public float score;
        /// <summary>Displayed camera viewport: bottom-left origin, x right, y up.</summary>
        public Rect viewport;
    }

    /// <summary>One displayed AR frame in flight; results retain that frame's camera matrices.</summary>
    public class ObjectDetector : MonoBehaviour
    {
        /// <summary>Model input side (YOLOX-S: 640).</summary>
        public const int InputSize = InferenceSession.InputSize;
        public Camera arCamera;
        public float interval = 0.5f;
        public bool Ready { get; private set; }
        /// <summary>Capture-to-result wall time, including frame slicing and readback.</summary>
        public float LastInferenceMs { get; private set; }
        /// <summary>Main-thread decode/NMS time for the last published frame.</summary>
        public float LastDecodeMs { get; private set; }
        public int LastCount { get; private set; }
        /// <summary>Invoked on the main thread with matrices captured with the source frame.</summary>
        public event Action<IReadOnlyList<Detection>, Matrix4x4, Matrix4x4> OnDetections;

        InferenceSession _session;
        ARCameraBackground _background;
        RenderTexture _frameRt;
        CommandBuffer _captureCommands;
        Camera _captureCamera;
        InferencePump _pump;
        readonly Stopwatch _decodeTimer = new Stopwatch();
        Matrix4x4 _cameraToWorld, _projection;
        int _srcW, _srcH, _screenW, _screenH;
        uint _generation, _captureGeneration;
        int _captureFrame = -1;
        bool _captureQueued;
        float _nextCapture;

        void Start()
        {
            var pumpObject = new GameObject("Detector inference pump") { hideFlags = HideFlags.HideAndDontSave };
            DontDestroyOnLoad(pumpObject);
            _pump = pumpObject.AddComponent<InferencePump>();
            _pump.owner = this;
            InitializeSession();
        }

        void OnEnable()
        {
            Camera.onPreRender += BeforeCameraRender;
            Camera.onPostRender += AfterCameraRender;
            _nextCapture = 0f;
            Ready = _session != null;
        }

        void InitializeSession()
        {
            try
            {
                if (GraphicsSettings.currentRenderPipeline != null)
                    throw new NotSupportedException("Detector capture currently requires the built-in render pipeline.");
                if (arCamera == null) throw new InvalidOperationException("Assign the AR camera to ObjectDetector.arCamera.");
                _background = arCamera.GetComponent<ARCameraBackground>();
                if (_background == null) throw new InvalidOperationException("The detector camera needs ARCameraBackground.");
                var backend = SystemInfo.supportsComputeShaders ? BackendType.GPUCompute : BackendType.CPU;
                _session = new InferenceSession(backend);
                Ready = true;
                Debug.Log($"[RaidRift] detector ready: {backend}; {SystemInfo.graphicsDeviceType}; async readback; BGR 0..255");
            }
            catch (Exception e) { Recover(e); }
        }

        // Called by a separate active GameObject, including while this component/object is disabled.
        void Poll()
        {
            if (_session == null)
            {
                if (isActiveAndEnabled && Time.unscaledTime >= _nextCapture) InitializeSession();
                return;
            }
            List<Detection> detections = null;
            try
            {
                if (_session.Busy)
                {
                    if (!_session.Tick(out var output)) return;
                    if (!isActiveAndEnabled || _captureGeneration != _generation ||
                        _screenW != Screen.width || _screenH != Screen.height) return;
                    LastInferenceMs = _session.LastInferenceMs;
                    _decodeTimer.Restart();
                    // The bundled YOLOX-S graph already applies sigmoid to objectness/classes.
                    // Avoid a diagnostic scan of all 672,000 class scores on every device frame.
                    detections = DecodeCore(output, _srcW, _srcH, InputSize, 0.3f, 0.45f, true);
                    _decodeTimer.Stop();
                    LastDecodeMs = (float)_decodeTimer.Elapsed.TotalMilliseconds;
                    LastCount = detections.Count;
                }
            }
            catch (Exception e) { Recover(e); return; }
            // Consumer exceptions must not be mistaken for inference failures.
            if (detections != null) OnDetections?.Invoke(detections, _cameraToWorld, _projection);
        }

        void BeforeCameraRender(Camera camera)
        {
            if (camera != arCamera || !isActiveAndEnabled || !Ready || _session.Busy || _captureQueued ||
                _captureFrame == Time.frameCount || Time.unscaledTime < _nextCapture ||
                _background == null || !_background.isActiveAndEnabled ||
                !_background.backgroundRenderingEnabled || _background.material == null) return;
            try { QueueCapture(camera); }
            catch (Exception e) { Recover(e); }
        }

        void QueueCapture(Camera camera)
        {
            _screenW = Screen.width;
            _screenH = Screen.height;
            if (_screenW <= 0 || _screenH <= 0) return;
            _srcW = 480;
            _srcH = Mathf.Max(1, Mathf.RoundToInt(480f * _screenH / _screenW));
            if (_frameRt == null || _frameRt.height != _srcH)
            {
                ReleaseTexture(_frameRt);
                _frameRt = NewTexture(_srcW, _srcH, "Detector displayed camera");
            }

            _cameraToWorld = camera.cameraToWorldMatrix;
            _projection = camera.projectionMatrix;
            _captureGeneration = _generation;
            _captureFrame = Time.frameCount;
            if (_captureCommands == null) _captureCommands = new CommandBuffer { name = "Detector synchronized camera capture" };
            _captureCommands.Clear();
            // ARFoundation's background pass issues ARCore's render-thread fence wait first.
            // Added in onPreRender, after ARFoundation installed/updated its background commands,
            // so this also follows an AfterOpaques background at the same camera event.
            _captureCommands.Blit((Texture)null, _frameRt, _background.material);
            _captureCommands.SetRenderTarget(BuiltinRenderTextureType.CameraTarget);
            _captureCamera = camera;
            camera.AddCommandBuffer(CameraEvent.AfterForwardOpaque, _captureCommands);
            _captureQueued = true;
            _nextCapture = Time.unscaledTime + Mathf.Max(0f, interval);
        }

        void AfterCameraRender(Camera camera)
        {
            if (!_captureQueued || camera != _captureCamera) return;
            RemoveCaptureCommands();
            if (!isActiveAndEnabled || _captureGeneration != _generation || _captureFrame != Time.frameCount) return;
            try
            {
                // These commands follow the camera command buffer in the graphics queue. Only
                // the owned RT is read here; no external AR texture is sampled from Update.
                _session.Begin(_frameRt);
            }
            catch (Exception e) { Recover(e); }
        }

        void RemoveCaptureCommands()
        {
            if (_captureCamera != null && _captureCommands != null)
                _captureCamera.RemoveCommandBuffer(CameraEvent.AfterForwardOpaque, _captureCommands);
            _captureCamera = null;
            _captureQueued = false;
        }

        /// <summary>Invalidate the previous room's pending capture/result without blocking the GPU.</summary>
        public void ResetDetections()
        {
            unchecked { _generation++; }
            RemoveCaptureCommands();
            LastCount = 0;
            LastDecodeMs = LastInferenceMs = 0f;
            _nextCapture = 0f;
        }

        void Recover(Exception e)
        {
            Ready = false;
            RemoveCaptureCommands();
            Debug.LogWarning($"[RaidRift] detector will retry: {e}", this);
            _session?.Dispose();
            _session = null;
            _nextCapture = Time.unscaledTime + 2f;
        }

        void OnDisable()
        {
            Camera.onPreRender -= BeforeCameraRender;
            Camera.onPostRender -= AfterCameraRender;
            ResetDetections();
            Ready = false;
            // The independent pump finishes/discards work. Readback callbacks remain active.
        }

        void OnDestroy()
        {
            Ready = false;
            Camera.onPreRender -= BeforeCameraRender;
            Camera.onPostRender -= AfterCameraRender;
            RemoveCaptureCommands();
            _captureCommands?.Release();
            _captureCommands = null;
            if (_pump != null) _pump.Retire(_session, _frameRt);
            else { _session?.Dispose(); ReleaseTexture(_frameRt); }
            _session = null;
            _frameRt = null;
            OnDetections = null;
        }

        // Runtime-only helper; never serialized into a scene. It survives disabling the owner,
        // and drains a destroyed owner's last request before releasing its source texture.
        public sealed class InferencePump : MonoBehaviour
        {
            internal ObjectDetector owner;
            InferenceSession _retiredSession;
            RenderTexture _retiredSource;

            internal void Retire(InferenceSession session, RenderTexture source)
            {
                owner = null;
                _retiredSession = session;
                _retiredSource = source;
            }

            void Update()
            {
                if (owner != null) { owner.Poll(); return; }
                try
                {
                    if (_retiredSession != null && _retiredSession.Busy && !_retiredSession.Tick(out _)) return;
                }
                catch (Exception e) { Debug.LogWarning($"[RaidRift] discarded detector work failed: {e}"); }
                Destroy(gameObject);
            }

            void OnDestroy()
            {
                _retiredSession?.Dispose();
                ReleaseTexture(_retiredSource);
            }
        }

        internal static RenderTexture NewTexture(int width, int height, string name)
        {
            // Camera bytes are already display RGB. Never add an sRGB encode/decode to preprocessing.
            var rt = new RenderTexture(width, height, 0, RenderTextureFormat.ARGB32, RenderTextureReadWrite.Linear)
            {
                name = name, filterMode = FilterMode.Bilinear, wrapMode = TextureWrapMode.Clamp,
                useMipMap = false, autoGenerateMips = false
            };
            if (!rt.Create()) { ReleaseTexture(rt); throw new InvalidOperationException("Cannot create detector render texture."); }
            return rt;
        }

        internal static void ReleaseTexture(RenderTexture rt)
        {
            if (rt == null) return;
            rt.Release();
            if (Application.isPlaying) Destroy(rt); else DestroyImmediate(rt);
        }

        /// <summary>Shared runtime/editor pipeline. Call Begin/Tick/Dispose on the main thread.
        /// Tick returns a borrowed exact-length buffer, valid until the next Begin or Dispose.</summary>
        public sealed class InferenceSession : IDisposable
        {
            public const int InputSize = 640; // YOLOX-S, COCO-80
            public bool Busy { get; private set; }
            public float LastInferenceMs { get; private set; }
            public string OutputShape { get; private set; }

            readonly BackendType _backend;
            readonly int _layersPerTick;
            readonly Stopwatch _timer = new Stopwatch();
            const int OutputLength = (80 * 80 + 40 * 40 + 20 * 20) * 85;
            // Exact-sized arrays keep the public Decode/self-test contract (ArrayPool rents may be larger).
            static readonly Stack<float[]> s_OutputPool = new Stack<float[]>();
            float[] _outputValues, _inputValues;
            Worker _worker;
            Tensor<float> _input, _output;
            RenderTexture _letterbox;
            IEnumerator _schedule;
            Exception _readbackError;
            bool _inputPending, _inputReady, _outputPending, _outputReady, _outputOnGpu;
            bool _readbackInFlight, _disposed;

            public InferenceSession(BackendType backend)
            {
                if (backend != BackendType.CPU && backend != BackendType.GPUCompute)
                    throw new ArgumentException("Use CPU or GPUCompute.", nameof(backend));
                if (!SystemInfo.supportsAsyncGPUReadback)
                    throw new NotSupportedException("Non-blocking detector requires async GPU readback; no synchronous fallback is used.");
                if (backend == BackendType.GPUCompute && !SystemInfo.supportsComputeShaders)
                    throw new NotSupportedException("GPUCompute requires compute shaders.");
                _backend = backend;
                _layersPerTick = backend == BackendType.CPU ? 4 : 24;
                try
                {
                    _outputValues = s_OutputPool.Count > 0 ? s_OutputPool.Pop() : new float[OutputLength];
                    var asset = Resources.Load<ModelAsset>("Models/yolox_s");
                    if (asset == null) throw new InvalidOperationException("Missing Resources/Models/yolox_s.onnx ModelAsset.");
                    var source = ModelLoader.Load(asset);
                    // TextureConverter emits 0..1. Prepend the documented functional multiply so the
                    // unchanged YOLOX network receives BGR 0..255, including pad value 114.
                    var graph = new FunctionalGraph();
                    var inputs = graph.AddInputs(source);
                    inputs[0] = inputs[0] * 255f;
                    var outputs = Functional.Forward(source, inputs);
                    graph.AddOutput(outputs[0], "detections");
                    _worker = new Worker(graph.Compile(), backend);
                    _letterbox = NewTexture(InputSize, InputSize, "Detector letterbox");
                    if (backend == BackendType.GPUCompute)
                        _input = new Tensor<float>(new TensorShape(1, 3, InputSize, InputSize));
                }
                catch { Dispose(); throw; }
            }

            public void Begin(Texture source)
            {
                if (_disposed) throw new ObjectDisposedException(nameof(InferenceSession));
                if (Busy) throw new InvalidOperationException("Only one detector inference may be in flight.");
                if (source == null || source.width <= 0 || source.height <= 0)
                    throw new ArgumentException("A nonempty source texture is required.", nameof(source));
                Busy = true;
                _readbackError = null;
                _inputReady = _outputReady = false;
                _timer.Restart();
                Letterbox(source, _letterbox);
                if (_backend == BackendType.GPUCompute)
                {
                    TextureConverter.ToTensor(_letterbox, _input, InputTransform());
                    _schedule = _worker.ScheduleIterable(_input);
                }
                else
                {
                    // Avoid TextureConverter's pixel-tensor -> CPU path: its readback is synchronous
                    // on devices without compute shaders. Read the ordinary RGBA8 RT asynchronously.
                    _inputPending = true;
                    _readbackInFlight = true;
                    try { AsyncGPUReadback.Request(_letterbox, 0, TextureFormat.RGBA32, OnPixelsReadback); }
                    catch { _readbackInFlight = false; throw; }
                }
            }

            public bool Tick(out float[] output)
            {
                output = null;
                if (_disposed) throw new ObjectDisposedException(nameof(InferenceSession));
                if (!Busy) return false;
                if (_readbackError != null) throw new InvalidOperationException("Detector readback failed; retry the frame.", _readbackError);
                if (_inputPending)
                {
                    if (!_inputReady) return false;
                    _input = new Tensor<float>(new TensorShape(1, 3, InputSize, InputSize), _inputValues);
                    _inputPending = false;
                    _schedule = _worker.ScheduleIterable(_input);
                    return false;
                }
                if (_outputPending)
                {
                    if (_outputOnGpu)
                    {
                        if (!_outputReady) return false;
                    }
                    else
                    {
                        if (!_output.IsReadbackRequestDone()) return false;
                        // Direct CPU view: no DownloadToArray or temporary native allocation.
                        _output.AsReadOnlySpan().CopyTo(_outputValues);
                    }
                    output = _outputValues;
                    _output = null; // PeekOutput is owned by Worker.
                    _outputPending = false;
                    Busy = false;
                    _timer.Stop();
                    LastInferenceMs = (float)_timer.Elapsed.TotalMilliseconds;
                    if (_backend == BackendType.CPU) { _input.Dispose(); _input = null; }
                    return true;
                }

                // Limit both layer count and CPU scheduling time. A single layer is indivisible.
                double tickStart = _timer.Elapsed.TotalMilliseconds;
                for (int i = 0; i < _layersPerTick; i++)
                {
                    if (!_schedule.MoveNext())
                    {
                        (_schedule as IDisposable)?.Dispose();
                        _schedule = null;
                        _output = _worker.PeekOutput() as Tensor<float>;
                        if (_output == null) throw new InvalidOperationException("YOLOX output must be a float tensor.");
                        OutputShape = _output.shape.ToString();
                        if (_output.shape.length != OutputLength)
                            throw new InvalidOperationException($"Expected [1,8400,85] YOLOX-S output; got {OutputShape}.");
                        _outputPending = true;
                        _outputOnGpu = _output.dataOnBackend is ComputeTensorData;
                        if (_outputOnGpu)
                        {
                            // Request exactly the tensor's elements, not the worker pool's buffer capacity.
                            var data = (ComputeTensorData)_output.dataOnBackend;
                            _readbackInFlight = true;
                            try { AsyncGPUReadback.Request(data.buffer, OutputLength * sizeof(float), 0, OnOutputReadback); }
                            catch { _readbackInFlight = false; throw; }
                        }
                        else _output.ReadbackRequest();
                        break;
                    }
                    if (_timer.Elapsed.TotalMilliseconds - tickStart >= 3.0) break;
                }
                return false;
            }

            public static TextureTransform InputTransform() => new TextureTransform()
                .SetTensorLayout(TensorLayout.NCHW).SetChannelSwizzle(ChannelSwizzle.BGRA)
                .SetCoordOrigin(CoordOrigin.TopLeft);

            void OnPixelsReadback(AsyncGPUReadbackRequest request)
            {
                try
                {
                    if (_disposed) return;
                    if (request.hasError) throw new InvalidOperationException("Detector input GPU readback failed.");
                    // Consume the native view in its completion callback, even if the owner is disabled.
                    var pixels = request.GetData<Color32>();
                    int plane = InputSize * InputSize;
                    if (_inputValues == null) _inputValues = new float[3 * plane];
                    // RT raw row zero is bottom on GLES. Match TextureConverter.TopLeft.
                    for (int y = 0; y < InputSize; y++)
                    for (int x = 0; x < InputSize; x++)
                    {
                        var p = pixels[(InputSize - 1 - y) * InputSize + x];
                        int i = y * InputSize + x;
                        _inputValues[i] = p.b / 255f;
                        _inputValues[plane + i] = p.g / 255f;
                        _inputValues[2 * plane + i] = p.r / 255f;
                    }
                    _inputReady = true;
                }
                catch (Exception e) { _readbackError = e; }
                finally { CompleteReadback(); }
            }

            void OnOutputReadback(AsyncGPUReadbackRequest request)
            {
                try
                {
                    if (_disposed) return;
                    if (request.hasError) throw new InvalidOperationException("Detector output GPU readback failed.");
                    NativeArray<float>.Copy(request.GetData<float>(), 0, _outputValues, 0, OutputLength);
                    _outputReady = true;
                }
                catch (Exception e) { _readbackError = e; }
                finally { CompleteReadback(); }
            }

            void CompleteReadback()
            {
                _readbackInFlight = false;
                if (_disposed) ReleaseResources();
            }

            /// <summary>GPU bilinear resize, floor-sized like cv2.resize, top-left on a 114-filled canvas.</summary>
            public static void Letterbox(Texture source, RenderTexture target)
            {
                if (source == null || target == null || target.width != InputSize || target.height != InputSize)
                    throw new ArgumentException("Letterbox needs a source and a 640x640 target.");
                double r = Math.Min((double)InputSize / source.width, (double)InputSize / source.height);
                int w = Math.Max(1, (int)(source.width * r)), h = Math.Max(1, (int)(source.height * r));
                var previous = RenderTexture.active;
                bool srgbWrite = GL.sRGBWrite;
                var filter = source.filterMode;
                GL.PushMatrix();
                try
                {
                    RenderTexture.active = target;
                    GL.sRGBWrite = false;
                    GL.Clear(false, true, new Color(114f / 255f, 114f / 255f, 114f / 255f, 1f));
                    GL.LoadPixelMatrix(0, InputSize, InputSize, 0);
                    source.filterMode = FilterMode.Bilinear;
                    // The no-color overload uses Unity's neutral DrawTexture tint.
                    Graphics.DrawTexture(new Rect(0, 0, w, h), source);
                }
                finally
                {
                    source.filterMode = filter;
                    GL.PopMatrix();
                    RenderTexture.active = previous;
                    GL.sRGBWrite = srgbWrite;
                }
            }

            public void Dispose()
            {
                if (_disposed) return;
                _disposed = true;
                Busy = false;
                _timer.Stop();
                // Retain worker/buffers/RT until native readback stops using them. Callbacks run
                // independently of any MonoBehaviour's enabled state and consume no expired data.
                if (!_readbackInFlight) ReleaseResources();
            }

            void ReleaseResources()
            {
                (_schedule as IDisposable)?.Dispose();
                _schedule = null;
                _output = null;
                _worker?.Dispose();
                _worker = null;
                _input?.Dispose();
                _input = null;
                ReleaseTexture(_letterbox);
                _letterbox = null;
                if (_outputValues != null && s_OutputPool.Count < 2) s_OutputPool.Push(_outputValues);
                _outputValues = _inputValues = null;
            }
        }

        struct Candidate
        {
            public int classId;
            public float score, x1, y1, x2, y2;
        }

        /// <summary>Raw grid-encoded YOLOX output to clipped bottom-left viewport boxes. No scene objects.</summary>
        public static List<Detection> Decode(float[] output, int srcW, int srcH, int inputSize = InputSize,
            float scoreThreshold = 0.3f, float iouThreshold = 0.45f)
            => DecodeCore(output, srcW, srcH, inputSize, scoreThreshold, iouThreshold, false);

        static List<Detection> DecodeCore(float[] output, int srcW, int srcH, int inputSize,
            float scoreThreshold, float iouThreshold, bool scoresAreProbabilities)
        {
            if (output == null) throw new ArgumentNullException(nameof(output));
            if (srcW <= 0 || srcH <= 0 || inputSize <= 0 || inputSize % 32 != 0)
                throw new ArgumentOutOfRangeException(nameof(inputSize), "Positive source sizes and an input size divisible by 32 are required.");
            if (!Finite(scoreThreshold) || scoreThreshold < 0f || scoreThreshold > 1f ||
                !Finite(iouThreshold) || iouThreshold < 0f || iouThreshold > 1f)
                throw new ArgumentOutOfRangeException(nameof(scoreThreshold));
            int anchors = checked((inputSize / 8) * (inputSize / 8) + (inputSize / 16) * (inputSize / 16) +
                                  (inputSize / 32) * (inputSize / 32));
            if (output.Length != checked(anchors * 85))
                throw new ArgumentException($"Expected [{anchors},85] raw YOLOX output; got {output.Length} floats.", nameof(output));

            bool objLogits = false, clsLogits = false;
            if (!scoresAreProbabilities)
            {
                GetScoreRanges(output, out float objMin, out float objMax, out float clsMin, out float clsMax);
                objLogits = objMin < 0f || objMax > 1f;
                clsLogits = clsMin < 0f || clsMax > 1f;
            }
            var candidates = new List<Candidate>();
            int row = 0;
            for (int stride = 8; stride <= 32; stride *= 2)
            {
                int side = inputSize / stride;
                for (int gy = 0; gy < side; gy++)
                for (int gx = 0; gx < side; gx++, row++)
                {
                    int offset = row * 85;
                    float obj = output[offset + 4];
                    if (!Finite(obj)) continue;
                    if (objLogits) obj = Sigmoid(obj);
                    if (obj < scoreThreshold) continue;
                    int classId = -1;
                    float best = float.NegativeInfinity;
                    for (int c = 0; c < CocoLabels.Count; c++)
                    {
                        float value = output[offset + 5 + c];
                        if (Finite(value) && value > best) { best = value; classId = c; }
                    }
                    if (classId < 0) continue;
                    float score = obj * (clsLogits ? Sigmoid(best) : best);
                    if (score < scoreThreshold) continue;
                    float cx = (output[offset] + gx) * stride, cy = (output[offset + 1] + gy) * stride;
                    float w = (float)Math.Exp(output[offset + 2]) * stride;
                    float h = (float)Math.Exp(output[offset + 3]) * stride;
                    if (!Finite(cx) || !Finite(cy) || !Finite(w) || !Finite(h) || w <= 0f || h <= 0f) continue;
                    candidates.Add(new Candidate { classId = classId, score = score,
                        x1 = cx - w * 0.5f, y1 = cy - h * 0.5f, x2 = cx + w * 0.5f, y2 = cy + h * 0.5f });
                }
            }
            candidates.Sort((a, b) => b.score.CompareTo(a.score));
            var kept = new List<Candidate>();
            var result = new List<Detection>();
            float ratio = Math.Min((float)inputSize / srcW, (float)inputSize / srcH);
            foreach (var candidate in candidates)
            {
                bool suppressed = false;
                foreach (var prior in kept)
                {
                    float overlap = IoU(prior, candidate);
                    // Class-wise NMS, plus cross-class suppression of near-identical boxes (one animal reported as both cat and dog).
                    if ((prior.classId == candidate.classId && overlap > iouThreshold) || overlap > 0.8f)
                    { suppressed = true; break; }
                }
                if (suppressed) continue;
                // NMS precedes clipping, matching demo_postprocess + class-wise NMS.
                kept.Add(candidate);
                float x1 = Clamp(candidate.x1 / ratio, 0f, srcW), x2 = Clamp(candidate.x2 / ratio, 0f, srcW);
                float y1 = Clamp(candidate.y1 / ratio, 0f, srcH), y2 = Clamp(candidate.y2 / ratio, 0f, srcH);
                if (x2 <= x1 || y2 <= y1) continue; // entirely in the padding / outside the image
                result.Add(new Detection { classId = candidate.classId, label = CocoLabels.Get(candidate.classId),
                    score = candidate.score, viewport = new Rect(x1 / srcW, 1f - y2 / srcH,
                        (x2 - x1) / srcW, (y2 - y1) / srcH) });
            }
            return result;
        }

        /// <summary>Raw probability/logit diagnostics, shared with the editor test; nonfinite values are ignored.</summary>
        public static void GetScoreRanges(float[] output, out float objMin, out float objMax,
            out float clsMin, out float clsMax)
        {
            if (output == null || output.Length == 0 || output.Length % 85 != 0)
                throw new ArgumentException("Expected complete YOLOX rows.", nameof(output));
            objMin = clsMin = float.PositiveInfinity;
            objMax = clsMax = float.NegativeInfinity;
            for (int row = 0; row < output.Length; row += 85)
            {
                float value = output[row + 4];
                if (Finite(value)) { objMin = Math.Min(objMin, value); objMax = Math.Max(objMax, value); }
                for (int c = 5; c < 85; c++)
                {
                    value = output[row + c];
                    if (Finite(value)) { clsMin = Math.Min(clsMin, value); clsMax = Math.Max(clsMax, value); }
                }
            }
        }

        static bool Finite(float value) => !float.IsNaN(value) && !float.IsInfinity(value);
        static float Clamp(float value, float min, float max) => Math.Max(min, Math.Min(max, value));
        static float Sigmoid(float value) => value >= 0f ? 1f / (1f + (float)Math.Exp(-value)) :
            (float)Math.Exp(value) / (1f + (float)Math.Exp(value));

        static float IoU(Candidate a, Candidate b)
        {
            double w = Math.Max(0.0, Math.Min(a.x2, b.x2) - Math.Max(a.x1, b.x1));
            double h = Math.Max(0.0, Math.Min(a.y2, b.y2) - Math.Max(a.y1, b.y1));
            double intersection = w * h;
            double union = (double)(a.x2 - a.x1) * (a.y2 - a.y1) +
                           (double)(b.x2 - b.x1) * (b.y2 - b.y1) - intersection;
            return union > 0.0 ? (float)(intersection / union) : 0f;
        }
    }
}
