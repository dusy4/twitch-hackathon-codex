using System;
using System.Threading;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace RaidRift.EditorTools
{
    public static class LiveSelfTest
    {
        static void Check(bool condition, string message)
        { if (!condition) throw new Exception("LiveSelfTest: " + message); }

        [MenuItem("RaidRift/Test live publisher")]
        public static void Run()
        {
            bool pass = true;
            try
            {
                Core(); Nv12Gpu();
                Debug.Log("[LiveSelfTest] PASS: ring overflow/wrap/concurrency, 44.1/48k resampling, crop, GPU NV12 colour/orientation");
            }
            catch (System.Exception e) { pass = false; Debug.LogError("[LiveSelfTest] FAIL: " + e); }
            if (Application.isBatchMode) EditorApplication.Exit(pass ? 0 : 2);
        }

        public static void Core() { Audio(); Crop(); }

        public static void Audio()
        {
            var ring = new LiveAudioRing(4);
            for (int i = 0; i < 4; i++) Check(ring.Write(i, -i), "ring write");
            Check(!ring.Write(999, 999), "overflow must reject new frame");
            for (int i = 0; i < 2; i++)
            { Check(ring.Read(out float l, out float r) && l == i && r == -i, "ring order"); }
            Check(ring.Write(4, -4) && ring.Write(5, -5), "ring wrap");
            for (int i = 2; i < 6; i++)
            { Check(ring.Read(out float l, out float r) && l == i && r == -i, "wrapped stereo order"); }
            Check(!ring.Read(out _, out _), "underflow");

            var concurrent = new LiveAudioRing(1024);
            Exception producerError = null;
            var producer = new Thread(() =>
            {
                try { for (int i = 0; i < 100000; i++) while (!concurrent.Write(i, -i)) Thread.Yield(); }
                catch (Exception e) { producerError = e; }
            }) { IsBackground = true };
            producer.Start();
            for (int i = 0; i < 100000; i++)
            {
                float l, r;
                while (!concurrent.Read(out l, out r)) Thread.Yield();
                Check(l == i && r == -i, "release/acquire publication");
            }
            Check(producer.Join(2000) && producerError == null, "producer completion");

            foreach (int rate in new[] { 44100, 48000 })
            foreach (int channels in new[] { 1, 2 })
            {
                var output = new LiveAudioRing(65536);
                var resampler = new LiveAudioResampler();
                // Split at uneven callback boundaries. A ramp exposes interpolation
                // and discontinuities more effectively than a constant/silence test.
                int source = 0;
                while (source < rate)
                {
                    int size = Math.Min(127, rate - source);
                    var input = new float[size * channels];
                    for (int i = 0; i < size; i++)
                    {
                        input[i * channels] = (source + i) / (float)rate;
                        if (channels == 2) input[i * channels + 1] = -input[i * channels];
                    }
                    resampler.Push(input, channels, rate, output); source += size;
                }
                int count = output.Available;
                Check(Math.Abs(count - 48000) <= 2, "resampled duration");
                for (int i = 0; i < count; i++)
                {
                    output.Read(out float l, out float r);
                    Check(Math.Abs(l - i / 48000f) < 0.00002f && (channels == 1 ? l == r : l == -r), "resampled ramp/stereo");
                }
            }
        }

        static void Crop()
        {
            foreach (var shape in new[] { new Vector2Int(1440,3120), new Vector2Int(3120,1440), new Vector2Int(1280,720) })
                foreach (var target in new[] { new Vector2Int(720,1280), new Vector2Int(1280,720) })
                {
                    Vector4 c = LivePublisher.Crop(shape.x, shape.y, target.x, target.y);
                    Check(c.x > 0 && c.x <= 1 && c.y > 0 && c.y <= 1, "crop bounds");
                    Check(Math.Abs(shape.x * c.x / (shape.y * c.y) - target.x / (float)target.y) < 0.00001f, "no stretch");
                    Check(Math.Abs(c.z * 2 + c.x - 1) < 0.00001f && Math.Abs(c.w * 2 + c.y - 1) < 0.00001f, "centred crop");
                }
        }

        static Color TestColor(int x, int y) => y < 12
            ? (x < 8 ? Color.blue : Color.white) : (x < 8 ? Color.red : Color.green);

        static void Nv12Gpu()
        {
            Check(SystemInfo.supportsAsyncGPUReadback, "GPU readback required for shader test");
            Shader shader = Resources.Load<Shader>("LiveNv12");
            Check(shader != null && shader.isSupported, "NV12 shader support");
            var texture = new Texture2D(16, 24, TextureFormat.RGBA32, false);
            var source = new RenderTexture(16, 24, 0, RenderTextureFormat.ARGB32);
            var packed = new RenderTexture(4, 24, 0, RenderTextureFormat.ARGB32, RenderTextureReadWrite.Linear);
            var material = new Material(shader);
            RenderTexture previous = RenderTexture.active;
            try
            {
                texture.filterMode = FilterMode.Point;
                for (int y = 0; y < 24; y++) for (int x = 0; x < 16; x++) texture.SetPixel(x, y, TestColor(x,y));
                texture.Apply(); source.Create(); packed.Create();
                Graphics.Blit(texture, source);
                material.SetVector("_Size", new Vector4(16,16,4,24));
                material.SetVector("_Crop", LivePublisher.Crop(16,24,16,16));
                Graphics.Blit(source, packed, material);
                var request = AsyncGPUReadback.Request(packed, 0, TextureFormat.RGBA32);
                request.WaitForCompletion();
                Check(!request.hasError, "NV12 readback");
                var bytes = request.GetData<byte>();
                Check(bytes.Length == 384, "packed frame length");
                // Top-left red, top-right green, bottom-left blue, bottom-right white.
                // Sample away from borders. Tests RGBA byte order and both UV orders.
                foreach (var point in new[] { new Vector2Int(2,2), new Vector2Int(12,2), new Vector2Int(2,12), new Vector2Int(12,12) })
                {
                    Color c = point.y < 8 ? (point.x < 8 ? Color.red : Color.green)
                        : (point.x < 8 ? Color.blue : Color.white);
                    int y = Mathf.RoundToInt(16 + 219 * (0.2126f*c.r + 0.7152f*c.g + 0.0722f*c.b));
                    int u = Mathf.RoundToInt(128 + 224 * (-0.114572f*c.r - 0.385428f*c.g + 0.5f*c.b));
                    int v = Mathf.RoundToInt(128 + 224 * (0.5f*c.r - 0.454153f*c.g - 0.045847f*c.b));
                    int chroma = 256 + point.y/2 * 16 + point.x/2 * 2;
                    Check(Math.Abs(bytes[point.y*16+point.x] - y) <= 2, "NV12 luma/orientation at " + point);
                    Check(Math.Abs(bytes[chroma] - u) <= 2 && Math.Abs(bytes[chroma+1] - v) <= 2, "NV12 chroma at " + point);
                }
            }
            finally
            {
                RenderTexture.active = previous;
                source.Release(); packed.Release();
                UnityEngine.Object.DestroyImmediate(texture); UnityEngine.Object.DestroyImmediate(source);
                UnityEngine.Object.DestroyImmediate(packed); UnityEngine.Object.DestroyImmediate(material);
            }
        }
    }
}
