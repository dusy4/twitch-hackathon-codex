using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using Unity.InferenceEngine;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace RaidRift.EditorTools
{
    /// <summary>Batch entry point: -executeMethod RaidRift.EditorTools.DetectorSelfTest.Run.
    /// Keep graphics enabled; optionally pass -detectorCPU. Do not pass -quit (completion exits).</summary>
    public static class DetectorSelfTest
    {
        static Runner _runner;

        public static void Run()
        {
            if (_runner != null) { Debug.LogWarning("[RaidRift] detector self-test already running."); return; }
            try
            {
                SyntheticCheck();
                Debug.Log("[RaidRift] detector synthetic Decode: PASS (letterbox, y flip, logits, class-wise NMS)");
            }
            catch (Exception e)
            {
                Debug.LogError("[RaidRift] detector synthetic Decode: FAIL " + e);
                if (Application.isBatchMode) EditorApplication.Exit(2);
                return;
            }
            try
            {
                _runner = new Runner();
                _runner.Start();
                EditorApplication.update += Update;
                AssemblyReloadEvents.beforeAssemblyReload += Cancel;
            }
            catch (Exception e) { Finish(3, e); }
        }

        static void Update()
        {
            try { if (_runner.Step()) Finish(0, null); }
            catch (Exception e) { Finish(3, e); }
        }

        static void Cancel() => Finish(3, new InvalidOperationException("Detector self-test interrupted by assembly reload."));

        static void Finish(int code, Exception error)
        {
            EditorApplication.update -= Update;
            AssemblyReloadEvents.beforeAssemblyReload -= Cancel;
            _runner?.Dispose();
            _runner = null;
            if (error != null) Debug.LogError("[RaidRift] detector self-test: " + error);
            else Debug.Log("[RaidRift] detector self-test: PASS; annotated images in Builds/detector/");
            if (Application.isBatchMode) EditorApplication.Exit(code);
        }

        const int S = ObjectDetector.InputSize, Side = S / 8, Anchors = Side * Side + (S / 16) * (S / 16) + (S / 32) * (S / 32);

        static void SyntheticCheck()
        {
            // Both aspect ratios exercise nonzero padding; expected boxes are asymmetric in y.
            foreach (var size in new[] { new Vector2Int(640, 360), new Vector2Int(360, 640) })
            {
                var output = new float[Anchors * 85];
                SetBox(output, 7 * Side + 10, size.x, size.y, 59, 0.9f, 0.8f);
                AssertBox(ObjectDetector.Decode(output, size.x, size.y), 1);

                // Overlapping lower-score bed suppressed (class-wise). A near-identical "chair" box (IoU > 0.8) is the
                // same object under a second label (the cat/dog case on the reference image): cross-class suppressed.
                SetBox(output, 7 * Side + 11, size.x, size.y, 59, 0.8f, 0.8f);
                SetBox(output, 7 * Side + 12, size.x, size.y, 56, 0.7f, 0.8f);
                var detections = ObjectDetector.Decode(output, size.x, size.y);
                AssertBox(detections, 1);

                // Whole groups of raw logits, including background, test the sigmoid fallback.
                for (int row = 0; row < Anchors; row++)
                for (int col = 4; col < 85; col++) output[row * 85 + col] = -20f;
                SetBox(output, 7 * Side + 10, size.x, size.y, 59, Logit(0.9f), Logit(0.8f));
                AssertBox(ObjectDetector.Decode(output, size.x, size.y), 1);
            }
        }

        static float Logit(float p) => (float)Math.Log(p / (1f - p));

        static void SetBox(float[] output, int row, int width, int height, int classId, float obj, float cls)
        {
            float r = Math.Min((float)S / width, (float)S / height);
            int offset = row * 85;
            // Source top-left xywh = (0.1W, 0.1H, 0.2W, 0.3H).
            output[offset] = 0.2f * width * r / 8f - row % Side;
            output[offset + 1] = 0.25f * height * r / 8f - row / Side;
            output[offset + 2] = (float)Math.Log(0.2f * width * r / 8f);
            output[offset + 3] = (float)Math.Log(0.3f * height * r / 8f);
            output[offset + 4] = obj;
            output[offset + 5 + classId] = cls;
        }

        static void AssertBox(List<Detection> detections, int count)
        {
            Require(detections.Count == count, $"Expected {count} detections, got {detections.Count}.");
            var d = detections[0];
            Require(d.classId == 59 && d.label == "bed", "Expected COCO bed (59).");
            Require(Math.Abs(d.score - 0.72f) < 0.0001f, "Expected obj * cls = 0.72.");
            Require(Math.Abs(d.viewport.x - 0.1f) < 0.0001f && Math.Abs(d.viewport.y - 0.6f) < 0.0001f &&
                    Math.Abs(d.viewport.width - 0.2f) < 0.0001f && Math.Abs(d.viewport.height - 0.3f) < 0.0001f,
                "Letterbox undo / bottom-left viewport mismatch: " + d.viewport);
        }

        static void Require(bool condition, string message)
        {
            if (!condition) throw new InvalidOperationException(message);
        }

        sealed class Runner : IDisposable
        {
            ObjectDetector.InferenceSession _session;
            Texture2D _image, _probe;
            RenderTexture _probeRt, _retiredProbeRt;
            Tensor<float> _probeTensor;
            AsyncGPUReadbackRequest _probePixels;
            bool _pixelsChecked, _tensorChecked, _probeDone, _probeRequested;
            string[] _files;
            string _destination;
            int _index;
            double _deadline;

            public void Start()
            {
                Require(SystemInfo.graphicsDeviceType != GraphicsDeviceType.Null,
                    "The GPU letterbox test needs graphics. Run batch mode without -nographics.");
                Require(SystemInfo.supportsAsyncGPUReadback, "Async GPU readback is unavailable in this editor graphics configuration.");
                string root = Directory.GetParent(Application.dataPath).FullName;
                string images = Path.Combine(root, "Tools", "testimages");
                _files = Directory.GetFiles(images, "*.jpg", SearchOption.TopDirectoryOnly);
                Array.Sort(_files, StringComparer.OrdinalIgnoreCase);
                Require(_files.Length > 0, "No Tools/testimages/*.jpg files found.");
                _destination = Path.Combine(root, "Builds", "detector");
                Directory.CreateDirectory(_destination);
                bool cpu = Array.Exists(Environment.GetCommandLineArgs(), a => a == "-detectorCPU");
                var backend = !cpu && SystemInfo.supportsComputeShaders ? BackendType.GPUCompute : BackendType.CPU;
                Debug.Log($"[RaidRift] detector self-test backend={backend} graphics={SystemInfo.graphicsDeviceType} images={_files.Length}");
                _session = new ObjectDetector.InferenceSession(backend);
                StartPreprocessProbe();
                _deadline = EditorApplication.timeSinceStartup + 300;
            }

            void StartPreprocessProbe()
            {
                // Linear texture preserves JPEG/display bytes. Four unequal colors expose RGB/BGR,
                // vertical flips, incorrect tint, gamma conversion, and centering instead of top-left.
                _probe = new Texture2D(8, 4, TextureFormat.RGBA32, false, true);
                var pixels = new Color32[32];
                for (int y = 0; y < 4; y++)
                for (int x = 0; x < 8; x++) pixels[y * 8 + x] = ProbeColor(x < 4, y >= 2);
                _probe.SetPixels32(pixels);
                _probe.filterMode = FilterMode.Point; // exact colours at any upscale (80x at 640 input)
                _probe.Apply();
                _probeRt = new RenderTexture(S, S, 0, RenderTextureFormat.ARGB32, RenderTextureReadWrite.Linear);
                Require(_probeRt.Create(), "Could not allocate preprocessing probe RT.");
                ObjectDetector.InferenceSession.Letterbox(_probe, _probeRt);
                if (SystemInfo.supportsComputeShaders)
                {
                    _probeTensor = new Tensor<float>(new TensorShape(1, 3, S, S));
                    TextureConverter.ToTensor(_probeRt, _probeTensor, ObjectDetector.InferenceSession.InputTransform());
                    _probeTensor.ReadbackRequest();
                }
                else _tensorChecked = true;
                // Queue last so completion also fences all GPU sampling of this RT.
                _probePixels = AsyncGPUReadback.Request(_probeRt, 0, TextureFormat.RGBA32, request =>
                {
                    if (_retiredProbeRt == null) return;
                    _retiredProbeRt.Release();
                    UnityEngine.Object.DestroyImmediate(_retiredProbeRt);
                    _retiredProbeRt = null;
                });
                _probeRequested = true;
            }

            static Color32 ProbeColor(bool left, bool top) => top ?
                (left ? new Color32(240, 20, 10, 255) : new Color32(10, 240, 20, 255)) :
                (left ? new Color32(20, 10, 240, 255) : new Color32(80, 100, 120, 255));

            bool CheckPreprocessProbe()
            {
                // Chart-square centres (S/16 = half a source texel at S/8 px per texel): exact colours under linear filtering.
                int c = S / 16;
                int[] xs = { c, S - c, c, S - c, c }, ys = { c, c, S / 2 - c, S / 2 - c, S - 116 };
                for (int phase = 0; phase < 2; phase++)
                {
                    if (phase == 0 && !_pixelsChecked && _probePixels.done)
                    {
                        Require(!_probePixels.hasError, "Preprocessing probe RT readback failed.");
                        var data = _probePixels.GetData<Color32>();
                        for (int i = 0; i < xs.Length; i++)
                        {
                            var expected = i == 4 ? new Color32(114, 114, 114, 255) : ProbeColor(xs[i] < S / 2, ys[i] < S / 4);
                            var actual = data[(S - 1 - ys[i]) * S + xs[i]];
                            Require(Math.Abs(actual.r - expected.r) <= 2 && Math.Abs(actual.g - expected.g) <= 2 &&
                                    Math.Abs(actual.b - expected.b) <= 2,
                                $"Letterbox probe at top-left ({xs[i]},{ys[i]}): got {actual}, expected {expected}.");
                        }
                        _pixelsChecked = true;
                    }
                    if (phase == 1 && !_tensorChecked && _probeTensor.IsReadbackRequestDone())
                    {
                        var data = _probeTensor.DownloadToArray();
                        for (int i = 0; i < xs.Length; i++)
                        {
                            var expected = i == 4 ? new Color32(114, 114, 114, 255) : ProbeColor(xs[i] < S / 2, ys[i] < S / 4);
                            int p = ys[i] * S + xs[i], plane = S * S;
                            Require(Math.Abs(data[p] * 255f - expected.b) <= 3 &&
                                    Math.Abs(data[plane + p] * 255f - expected.g) <= 3 &&
                                    Math.Abs(data[2 * plane + p] * 255f - expected.r) <= 3,
                                $"Tensor probe BGR/top-left mismatch at ({xs[i]},{ys[i]}): got bgr=({data[p] * 255f:F0},{data[plane + p] * 255f:F0},{data[2 * plane + p] * 255f:F0}) expected rgb={expected}.");
                        }
                        _tensorChecked = true;
                    }
                }
                if (!_pixelsChecked || !_tensorChecked) return false;
                _probeTensor?.Dispose(); _probeTensor = null;
                _probeRt.Release(); UnityEngine.Object.DestroyImmediate(_probeRt); _probeRt = null;
                UnityEngine.Object.DestroyImmediate(_probe); _probe = null;
                Debug.Log($"[RaidRift] detector preprocessing: PASS; top-left resize {S}x{S / 2}, bottom pad 114; BGR bytes /255 then model *255; no gamma conversion");
                return true;
            }

            public bool Step()
            {
                Require(EditorApplication.timeSinceStartup < _deadline, "Detector self-test timed out waiting for inference/readback.");
                if (!_probeDone)
                {
                    if (!CheckPreprocessProbe()) return false;
                    _probeDone = true;
                }
                if (!_session.Busy)
                {
                    if (_index == _files.Length) return true;
                    _image = new Texture2D(2, 2, TextureFormat.RGBA32, false, true);
                    Require(ImageConversion.LoadImage(_image, File.ReadAllBytes(_files[_index])), "Cannot decode " + _files[_index]);
                    _session.Begin(_image);
                    _deadline = EditorApplication.timeSinceStartup + 300;
                    return false;
                }
                if (!_session.Tick(out var output)) return false;
                string file = Path.GetFileName(_files[_index]);
                Debug.Log($"[RaidRift] detector {file}: raw output shape={_session.OutputShape} floats={output?.Length}");
                ObjectDetector.GetScoreRanges(output, out float objMin, out float objMax, out float clsMin, out float clsMax);
                int nonfinite = 0;
                foreach (float f in output) if (float.IsNaN(f) || float.IsInfinity(f)) nonfinite++;
                Debug.Log(FormattableString.Invariant($"[RaidRift] detector {file}: shape={_session.OutputShape} floats={output.Length} obj=[{objMin:G6},{objMax:G6}] cls=[{clsMin:G6},{clsMax:G6}] sigmoidObj={objMin < 0 || objMax > 1} sigmoidCls={clsMin < 0 || clsMax > 1} nonfinite={nonfinite} elapsedMs={_session.LastInferenceMs:F1}"));
                Require(nonfinite == 0, "Model output contains nonfinite values: " + file);
                var detections = ObjectDetector.Decode(output, _image.width, _image.height, ObjectDetector.InputSize);
                foreach (var d in detections)
                    Debug.Log(string.Format(CultureInfo.InvariantCulture,
                        "[RaidRift] detector {0}: {1} {2:F3} rect=({3:F4}, {4:F4}, {5:F4}, {6:F4})",
                        file, d.label, d.score, d.viewport.x, d.viewport.y, d.viewport.width, d.viewport.height));
                if (detections.Count == 0) Debug.LogWarning($"[RaidRift] detector {file}: no detections at score >= 0.3");
                Annotate(_image, detections);
                File.WriteAllBytes(Path.Combine(_destination, Path.GetFileNameWithoutExtension(file) + ".png"), _image.EncodeToPNG());
                UnityEngine.Object.DestroyImmediate(_image); _image = null;
                _index++;
                return false;
            }

            static void Annotate(Texture2D texture, List<Detection> detections)
            {
                int width = texture.width, height = texture.height;
                var pixels = texture.GetPixels32(); // Texture2D rows and viewport both start at bottom-left.
                foreach (var detection in detections)
                {
                    var r = detection.viewport;
                    int x1 = Mathf.Clamp(Mathf.FloorToInt(r.xMin * width), 0, width - 1);
                    int x2 = Mathf.Clamp(Mathf.CeilToInt(r.xMax * width) - 1, 0, width - 1);
                    int y1 = Mathf.Clamp(Mathf.FloorToInt(r.yMin * height), 0, height - 1);
                    int y2 = Mathf.Clamp(Mathf.CeilToInt(r.yMax * height) - 1, 0, height - 1);
                    Color32 color = Color.HSVToRGB((detection.classId * 0.618034f) % 1f, 0.85f, 1f);
                    for (int t = 0; t < 3; t++)
                    {
                        for (int x = x1; x <= x2; x++)
                        { pixels[Math.Min(y1 + t, y2) * width + x] = color; pixels[Math.Max(y2 - t, y1) * width + x] = color; }
                        for (int y = y1; y <= y2; y++)
                        { pixels[y * width + Math.Min(x1 + t, x2)] = color; pixels[y * width + Math.Max(x2 - t, x1)] = color; }
                    }
                }
                texture.SetPixels32(pixels);
                texture.Apply();
            }

            public void Dispose()
            {
                _session?.Dispose();
                _probeTensor?.Dispose();
                if (_probeRt != null)
                {
                    if (_probeRequested && !_probePixels.done) _retiredProbeRt = _probeRt;
                    else { _probeRt.Release(); UnityEngine.Object.DestroyImmediate(_probeRt); }
                    _probeRt = null;
                }
                if (_probe != null) UnityEngine.Object.DestroyImmediate(_probe);
                if (_image != null) UnityEngine.Object.DestroyImmediate(_image);
            }
        }
    }
}
