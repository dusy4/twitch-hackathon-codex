using System.Collections.Generic;
using UnityEngine;

namespace RaidRift
{
    /// <summary>
    /// The "Mario 64 in your room" effect (Lucas Martinic's Quest prototype, rebuilt for a phone):
    /// a soft-edged rift window standing on the landing spot shows a whole voxel world behind it, rendered
    /// by a second camera from the phone's exact pose (real parallax). Heroes walk out of that world through
    /// the window onto the real floor, and the scanned room around the rift is painted into Rift terrain.
    /// Everything here is procedural and original (no Nintendo or Minecraft assets).
    /// Local frame: origin = window base on the floor, +z = into the rift world (away from the streamer).
    /// </summary>
    public class RiftWorld : MonoBehaviour
    {
        public const int Layer = 8;
        public const float WindowWidth = 1.3f, WindowHeight = 1.9f;

        public bool Open => _age >= 0f;
        public Vector3 Foot(int i) => transform.TransformPoint(new Vector3(((i % 4) - 1.5f) * 0.3f, 0f, -0.3f - (i / 4) * 0.25f)); // 0.22 m put hats on top of each other
        public Vector3 Inside(int i) => transform.TransformPoint(new Vector3(((i % 4) - 1.5f) * 0.2f, 0f, 0.9f + (i / 4) * 0.15f));
        public Vector3 Forward => transform.forward;

        Camera _arCamera, _riftCamera;
        RenderTexture _view;
        Transform _window;
        Material _windowMat;
        float _age = -1f;
        readonly List<Transform> _islands = new List<Transform>();
        readonly List<Vector3> _islandRest = new List<Vector3>();
        readonly List<Transform> _motes = new List<Transform>();
        static readonly int CenterId = Shader.PropertyToID("_RiftCenter"), RadiusId = Shader.PropertyToID("_RiftRadius");

        public static RiftWorld Create(Vector3 foot, Vector3 cameraPosition, Camera arCamera)
        {
            var away = Vector3.ProjectOnPlane(foot - cameraPosition, Vector3.up);
            if (away.sqrMagnitude < 1e-4f) away = Vector3.forward;
            var go = new GameObject("Rift World");
            go.transform.SetPositionAndRotation(foot, Quaternion.LookRotation(away.normalized, Vector3.up));
            var rift = go.AddComponent<RiftWorld>();
            rift._arCamera = arCamera;
            rift.Build();
            return rift;
        }

        void Build()
        {
            var voxel = Resources.Load<Material>("Materials/VoxelLit");
            var world = new GameObject("Terrain");
            world.layer = Layer;
            world.transform.SetParent(transform, false);
            world.AddComponent<MeshFilter>().sharedMesh = BuildTerrain();
            var r = world.AddComponent<MeshRenderer>();
            r.sharedMaterial = voxel;
            r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;

            var rng = new System.Random(7);
            for (int i = 0; i < 3; i++)
            {
                var island = new GameObject("Island " + i) { layer = Layer };
                island.transform.SetParent(transform, false);
                var rest = new Vector3((i - 1) * 1.6f + (float)rng.NextDouble() * 0.4f, 0.6f + i * 0.35f, 2.6f + i * 1.1f);
                island.transform.localPosition = rest;
                island.AddComponent<MeshFilter>().sharedMesh = BuildIsland(rng);
                island.AddComponent<MeshRenderer>().sharedMaterial = voxel;
                _islands.Add(island.transform);
                _islandRest.Add(rest);
            }

            var sky = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            Destroy(sky.GetComponent<Collider>());
            sky.layer = Layer;
            sky.transform.SetParent(transform, false);
            sky.transform.localScale = Vector3.one * 40f;
            sky.GetComponent<Renderer>().sharedMaterial = Resources.Load<Material>("Materials/RiftSky");

            for (int i = 0; i < 36; i++)
            {
                var m = GameObject.CreatePrimitive(PrimitiveType.Cube);
                Destroy(m.GetComponent<Collider>());
                m.layer = Layer;
                m.transform.SetParent(transform, false);
                m.transform.localScale = Vector3.one * 0.025f;
                m.GetComponent<Renderer>().sharedMaterial = Resources.Load<Material>("Materials/Crystal");
                _motes.Add(m.transform);
            }

            // The window into the rift, on the streamer's side of the world.
            var quad = GameObject.CreatePrimitive(PrimitiveType.Quad);
            Destroy(quad.GetComponent<Collider>());
            quad.name = "Rift Window";
            quad.transform.SetParent(transform, false);
            quad.transform.localPosition = new Vector3(0f, WindowHeight / 2f, 0f);
            quad.transform.localScale = new Vector3(WindowWidth, WindowHeight, 1f) * 0.01f;
            _windowMat = new Material(Resources.Load<Material>("Materials/RiftWindow"));
            quad.GetComponent<Renderer>().sharedMaterial = _windowMat;
            _window = quad.transform;

            // Second camera: same pose and lens as the AR camera, sees only the rift world.
            var camGo = new GameObject("Rift Camera");
            camGo.transform.SetParent(_arCamera.transform, false);
            _riftCamera = camGo.AddComponent<Camera>();
            _riftCamera.cullingMask = 1 << Layer;
            _riftCamera.clearFlags = CameraClearFlags.SolidColor;
            _riftCamera.backgroundColor = new Color(0.2f, 0.1f, 0.35f, 1f);
            _riftCamera.nearClipPlane = 0.03f;
            _riftCamera.farClipPlane = 80f;
            _riftCamera.depth = _arCamera.depth - 1f;
            _view = new RenderTexture(Mathf.Max(256, Screen.width / 2), Mathf.Max(256, Screen.height / 2), 24, RenderTextureFormat.ARGB32);
            _view.Create();
            _riftCamera.targetTexture = _view;
            _windowMat.SetTexture("_RiftTex", _view);
            // AR review #4 (2026-11-01): back to the 0.20 always-on render path (LateUpdate copies the AR projection);
            // the on-demand nested Camera.Render inside the AR camera's culling was the only render change near AR.
            _riftCamera.enabled = true;
            _autoFallback = true;
            quad.AddComponent<WindowHook>().owner = this;
            _age = 0f;
            Sfx.Play("rift_open", 0.95f); // layered riser + sub-boom impact + crystal tail
            Sfx.Loop("rift_ambience", _window, 0.35f, 5f);
        }

        // The window samples _RiftTex in screen space, so the rift view must be rendered with the exact pose and
        // projection of the camera that is drawing the window right now. Copying the AR camera's projection in
        // LateUpdate broke whenever the AR camera rendered with another target/aspect (stream View, previews): the
        // window then showed the rift sky's pale side as a white slab (PlaySmoke play-washout). Classic portal
        // pattern instead: render from the window's OnWillRenderObject; skipped entirely while the window is
        // off-screen. One render per camera per frame unless that camera's lens or pose changed.
        bool _rendering;
        int _renderedFrame = -1;
        Camera _renderedFor;
        Matrix4x4 _renderedProj, _renderedPose;

        void RenderFor(Camera cam)
        {
            if (_rendering || _autoFallback || cam == null || cam == _riftCamera || _riftCamera == null) return;
            var pose = cam.transform.localToWorldMatrix;
            var proj = cam.projectionMatrix;
            if (Application.isPlaying && _renderedFrame == Time.frameCount && _renderedFor == cam && _renderedProj == proj && _renderedPose == pose) return;
            _rendering = true;
            try
            {
                _riftCamera.transform.SetPositionAndRotation(cam.transform.position, cam.transform.rotation);
                _riftCamera.projectionMatrix = proj;
                _riftCamera.Render();
                _renderedFrame = Time.frameCount; _renderedFor = cam; _renderedProj = proj; _renderedPose = pose;
            }
            finally { _rendering = false; }
        }

        // Safety net (not testable on a phone tonight): if the window is visible but the hook has not rendered for
        // 30 frames, go back to the old behaviour (rift camera renders itself each frame with the AR projection).
        bool _autoFallback;
        Renderer _windowRenderer;

        // Hidden for a selfie (or re-enabled) leaves _renderedFrame stale: never let that read as "the hook stalled".
        void OnEnable() { _renderedFrame = Time.frameCount; }

        void CheckRenderPath()
        {
            if (_autoFallback || _riftCamera == null || _window == null || _age < 1f) return;
            if (_windowRenderer == null) _windowRenderer = _window.GetComponent<Renderer>();
            if (_windowRenderer == null || !_windowRenderer.isVisible || Time.frameCount - _renderedFrame < 30) return;
            _autoFallback = true;
            _riftCamera.enabled = true;
            Debug.LogWarning("[RaidRift] rift window: on-demand render never fired, falling back to an always-on rift camera");
        }

        void LateUpdate()
        {
            if (!_autoFallback || _riftCamera == null || _arCamera == null) return;
            _riftCamera.projectionMatrix = _arCamera.projectionMatrix;
        }

        [ExecuteAlways] // editor previews (FxPreview, HudPreview) render outside play mode
        class WindowHook : MonoBehaviour
        {
            public RiftWorld owner;
            void OnWillRenderObject() { if (owner != null) owner.RenderFor(Camera.current); }
        }

        // ---------------- close (VFX-PLAN: 0.18 s inward pull + 0.10 s snap + ember tail) ----------------
        float _closeAt = -1f;
        Vector3 _closeScale;
        public bool Closing => _closeAt >= 0f;

        /// <summary>Collapse the window on screen instead of vanishing: it squeezes to a vertical slit (seam
        /// sparks pulled inward), snaps shut with a small pop, then embers drift off. Destroys itself (~0.3 s).
        /// Another rift may already be open; this one stops driving the shared room-paint globals.</summary>
        public void Collapse()
        {
            if (Closing) return;
            _closeAt = Time.time;
            _closeScale = _window != null ? _window.localScale : new Vector3(WindowWidth, WindowHeight, 1f);
            var mid = transform.position + Vector3.up * WindowHeight * 0.5f;
            RiftFx.Charge(mid, transform.forward, 0.5f);
            Sfx.PlayAt("teleport_out", mid, 0.7f);
            CameraFeel.Shake(0.2f);
        }

        bool UpdateClose()
        {
            if (!Closing) return false;
            float k = Time.time - _closeAt;
            var full = _closeScale;
            if (k < 0.18f)
            {
                float u = Mathf.SmoothStep(0f, 1f, k / 0.18f);
                _window.localScale = new Vector3(Mathf.Lerp(full.x, 0.04f, u), full.y * Mathf.Lerp(1f, 1.04f, u), 1f);
            }
            else if (k < 0.28f)
            {
                float u = (k - 0.18f) / 0.10f;
                _window.localScale = new Vector3(0.04f * (1f - u) + 0.005f, Mathf.Lerp(full.y * 1.04f, 0.01f, u * u), 1f);
            }
            else
            {
                var mid = transform.position + Vector3.up * WindowHeight * 0.5f;
                Fx.Sparkle(mid, new Color(0.7f, 0.45f, 1f), 26, 0.9f);
                Fx.Sparkle(mid, new Color(0.35f, 0.95f, 0.85f), 10, 0.6f);
                Destroy(gameObject);
            }
            return true;
        }

        void Update()
        {
            _age += Time.deltaTime;
            CheckRenderPath();
            if (UpdateClose()) return;
            // Window opens with a little overshoot; the paint then spreads across the real room.
            float t = Mathf.Clamp01(_age / 1.1f);
            float s = 1f + 2.2f * Mathf.Pow(t - 1f, 3f) + 1.2f * Mathf.Pow(t - 1f, 2f);
            _window.localScale = new Vector3(WindowWidth, WindowHeight, 1f) * Mathf.Max(0.01f, s);
            float radius = Mathf.Lerp(0f, 1.3f, Mathf.SmoothStep(0f, 1f, Mathf.Clamp01((_age - 0.6f) / 5f)));
            Shader.SetGlobalVector(CenterId, transform.position);
            Shader.SetGlobalFloat(RadiusId, radius);
            for (int i = 0; i < _islands.Count; i++)
                _islands[i].localPosition = _islandRest[i] + Vector3.up * Mathf.Sin(_age * 0.7f + i * 2f) * 0.06f;
            for (int i = 0; i < _motes.Count; i++)
            {
                float a = _age * (0.2f + (i % 5) * 0.05f) + i * 1.7f;
                _motes[i].localPosition = new Vector3(Mathf.Sin(a) * (0.6f + i % 3), 0.3f + Mathf.Repeat(_age * 0.08f + i * 0.13f, 1.8f), 0.8f + (i % 7) * 0.6f + Mathf.Cos(a) * 0.3f);
                _motes[i].localRotation = Quaternion.Euler(_age * 60f + i * 10f, _age * 40f, 45f);
            }
        }

        void OnDestroy()
        {
            if (!Closing) Shader.SetGlobalFloat(RadiusId, 0f); // a collapsing rift was replaced: the new one owns the paint
            if (_riftCamera != null) Destroy(_riftCamera.gameObject);
            if (_view != null) { _view.Release(); Destroy(_view); }
            if (_windowMat != null) Destroy(_windowMat);
        }

        /// <summary>True when [p] is behind the window plane, inside the rift world.</summary>
        public bool IsInside(Vector3 p) => Vector3.Dot(p - transform.position, transform.forward) > 0.02f;

        // ---------------- procedural voxel art ----------------
        const float Cell = 0.1f;

        static float Noise(float x, float z) => Mathf.PerlinNoise(x * 0.45f + 13.1f, z * 0.45f + 7.7f);

        /// <summary>Ledge → valley → hills. The heroes' ledge is flush with the real floor (y = 0) for
        /// 1.3 m behind the window; then the world drops ~1.4 m into a valley with a glowing river, and rises
        /// again into hills, the keep and far mountains, so the tall window shows a whole vista with sky.</summary>
        static float Height(float x, float z)
        {
            float h;
            if (z < 1.3f) h = Mathf.Abs(x) > 1.0f ? Noise(x * 2f, z * 2f) * 0.25f : 0f;
            else
            {
                h = -1.4f + Noise(x, z) * 0.35f;
                if (z > 4.5f) h += (z - 4.5f) * 0.42f + Noise(z, x) * 0.9f * Mathf.Clamp01((z - 4.5f) / 3f);
                if (River(x, z)) h = -1.6f;
            }
            return Mathf.Round(h / Cell) * Cell;
        }

        static bool River(float x, float z) => z > 1.6f && z < 6.5f && Mathf.Abs(x - Mathf.Sin(z * 0.7f) * 0.9f) < 0.22f;

        static Mesh BuildTerrain()
        {
            var b = new VoxelBuilder();
            // Fine 10 cm voxels near the window, coarser 25 cm ones in the distance (vertex budget).
            void Region(float x0, float x1, float z0, float z1, float cell)
            {
                for (float x = x0; x < x1 - 1e-4f; x += cell)
                    for (float z = z0; z < z1 - 1e-4f; z += cell)
                    {
                        float cx = x + cell / 2, cz = z + cell / 2, h = Height(cx, cz);
                        bool ledge = cz < 1.3f;
                        bool path = ledge && Mathf.Abs(cx) < 0.45f;
                        bool river = River(cx, cz);
                        float v = Mathf.PerlinNoise(cx * 3.1f, cz * 3.1f);
                        Color top = river ? new Color(0.35f, 0.95f, 0.85f, 0.35f)
                            : path ? Color.Lerp(new Color(0.74f, 0.68f, 0.88f), new Color(0.6f, 0.54f, 0.76f), v)
                            : h > 0.6f && v > 0.6f ? new Color(0.95f, 0.6f, 0.85f)
                            : v > 0.74f ? new Color(0.3f, 0.82f, 0.72f)
                            : Color.Lerp(new Color(0.46f, 0.21f, 0.68f), new Color(0.64f, 0.3f, 0.82f), v);
                        var side = Color.Lerp(new Color(0.27f, 0.16f, 0.32f), new Color(0.38f, 0.22f, 0.4f), v);
                        b.Box(Matrix4x4.identity, new Vector3(x, -2.2f, z), new Vector3(x + cell, h, z + cell), top, side);
                    }
            }
            Region(-2.0f, 2.0f, 0f, 2.0f, Cell);
            Region(-5.0f, -2.0f, 0f, 2.0f, 0.25f);
            Region(2.0f, 5.0f, 0f, 2.0f, 0.25f);
            Region(-5.0f, 5.0f, 2.0f, 12.0f, 0.25f);

            var rng = new System.Random(11);
            for (int i = 0; i < 110; i++)
            {
                float x = (float)(rng.NextDouble() * 9 - 4.5), z = (float)(rng.NextDouble() * 9.5 + 1.5);
                if (River(x, z)) continue;
                float h = Height(x, z);
                if (i % 3 == 0)
                {
                    float tall = 0.3f + (float)rng.NextDouble() * 0.8f;
                    var m = Matrix4x4.TRS(new Vector3(x, h, z), Quaternion.Euler((float)rng.NextDouble() * 20 - 10, (float)rng.NextDouble() * 90, (float)rng.NextDouble() * 20 - 10), Vector3.one);
                    var glow = rng.NextDouble() > 0.5 ? new Color(0.55f, 1f, 0.88f, 0.25f) : new Color(0.85f, 0.55f, 1f, 0.25f);
                    b.Box(m, new Vector3(-0.06f, 0f, -0.06f), new Vector3(0.06f, tall, 0.06f), glow, glow);
                }
                else
                {
                    float trunk = 0.25f + (float)rng.NextDouble() * 0.25f;
                    b.Box(Matrix4x4.identity, new Vector3(x - 0.04f, h, z - 0.04f), new Vector3(x + 0.04f, h + trunk, z + 0.04f), new Color(0.35f, 0.22f, 0.2f), new Color(0.3f, 0.18f, 0.16f));
                    var leaf = rng.NextDouble() > 0.4 ? new Color(0.3f, 0.78f, 0.66f) : new Color(0.9f, 0.48f, 0.78f);
                    float s = 0.16f + (float)rng.NextDouble() * 0.1f;
                    b.Box(Matrix4x4.identity, new Vector3(x - s, h + trunk, z - s), new Vector3(x + s, h + trunk + s * 1.6f, z + s), leaf, new Color(leaf.r * 0.85f, leaf.g * 0.85f, leaf.b * 0.85f));
                }
            }
            // Flowers on the ledge, beside the path (close detail for parallax).
            for (int i = 0; i < 40; i++)
            {
                float x = (float)(rng.NextDouble() * 3.6 - 1.8), z = (float)(rng.NextDouble() * 1.1 + 0.15);
                if (Mathf.Abs(x) < 0.55f) continue;
                var petal = rng.NextDouble() > 0.5 ? new Color(1f, 0.75f, 0.35f, 0.6f) : new Color(0.6f, 1f, 0.9f, 0.6f);
                float h = Height(x, z);
                b.Box(Matrix4x4.identity, new Vector3(x - 0.01f, h, z - 0.01f), new Vector3(x + 0.01f, h + 0.07f, z + 0.01f), new Color(0.3f, 0.6f, 0.5f), new Color(0.3f, 0.6f, 0.5f));
                b.Box(Matrix4x4.identity, new Vector3(x - 0.025f, h + 0.07f, z - 0.025f), new Vector3(x + 0.025f, h + 0.11f, z + 0.025f), petal, petal);
            }
            // The Rift Keep on the far hill, glowing gate and window.
            var stone = new Color(0.56f, 0.5f, 0.7f);
            var dark = new Color(0.42f, 0.36f, 0.55f);
            float kx = 0.6f, kz = 7.2f, kh = Height(kx, kz);
            b.Box(Matrix4x4.identity, new Vector3(kx - 0.8f, kh, kz), new Vector3(kx + 0.8f, kh + 1.2f, kz + 0.9f), stone, dark);
            b.Box(Matrix4x4.identity, new Vector3(kx - 0.3f, kh + 1.2f, kz + 0.2f), new Vector3(kx + 0.3f, kh + 2.4f, kz + 0.7f), stone, dark);
            b.Box(Matrix4x4.identity, new Vector3(kx - 0.9f, kh, kz - 0.1f), new Vector3(kx - 0.55f, kh + 1.7f, kz + 0.25f), stone, dark);
            b.Box(Matrix4x4.identity, new Vector3(kx + 0.55f, kh, kz - 0.1f), new Vector3(kx + 0.9f, kh + 1.7f, kz + 0.25f), stone, dark);
            for (int i = 0; i < 7; i++)
                b.Box(Matrix4x4.identity, new Vector3(kx - 0.8f + i * 0.24f, kh + 1.2f, kz), new Vector3(kx - 0.68f + i * 0.24f, kh + 1.34f, kz + 0.1f), stone, dark);
            var gate = new Color(0.9f, 0.6f, 1f, 0.15f);
            b.Box(Matrix4x4.identity, new Vector3(kx - 0.18f, kh, kz - 0.01f), new Vector3(kx + 0.18f, kh + 0.5f, kz), gate, gate);
            var lamp = new Color(0.55f, 1f, 0.88f, 0.15f);
            b.Box(Matrix4x4.identity, new Vector3(kx - 0.08f, kh + 1.8f, kz + 0.19f), new Vector3(kx + 0.08f, kh + 2.0f, kz + 0.2f), lamp, lamp);
            // Far mountains.
            for (int i = 0; i < 11; i++)
            {
                float x = -9f + i * 1.8f, h = 2.5f + (float)rng.NextDouble() * 3f, w = 1.0f + (float)rng.NextDouble() * 1.0f;
                float z0 = 12f + (float)rng.NextDouble() * 3f;
                b.Box(Matrix4x4.identity, new Vector3(x - w, -2.2f, z0), new Vector3(x + w, h, z0 + 2f), new Color(0.68f, 0.52f, 0.9f), new Color(0.5f, 0.36f, 0.72f));
                b.Box(Matrix4x4.identity, new Vector3(x - w * 0.4f, h, z0 + 0.6f), new Vector3(x + w * 0.4f, h + 0.5f, z0 + 1.4f), new Color(0.95f, 0.9f, 1f), new Color(0.8f, 0.72f, 0.95f));
            }
            return b.ToMesh();
        }

        static Mesh BuildIsland(System.Random rng)
        {
            var b = new VoxelBuilder();
            float w = 0.35f + (float)rng.NextDouble() * 0.2f;
            for (int i = 0; i < 5; i++)
            {
                float k = w * (1f - i * 0.18f);
                b.Box(Matrix4x4.identity, new Vector3(-k, -0.08f * (i + 1), -k), new Vector3(k, -0.08f * i, k),
                    i == 0 ? new Color(0.5f, 0.24f, 0.72f) : new Color(0.32f, 0.18f, 0.36f), new Color(0.32f, 0.18f, 0.36f));
            }
            var glow = new Color(0.55f, 1f, 0.88f, 0.2f);
            b.Box(Matrix4x4.TRS(Vector3.zero, Quaternion.Euler(0f, 30f, 8f), Vector3.one), new Vector3(-0.04f, 0f, -0.04f), new Vector3(0.04f, 0.35f, 0.04f), glow, glow);
            return b.ToMesh();
        }

        class VoxelBuilder
        {
            readonly List<Vector3> _v = new List<Vector3>();
            readonly List<Vector3> _n = new List<Vector3>();
            readonly List<Color> _c = new List<Color>();
            readonly List<int> _t = new List<int>();

            public void Box(Matrix4x4 m, Vector3 min, Vector3 max, Color top, Color side)
            {
                var p = new Vector3[8];
                for (int i = 0; i < 8; i++)
                    p[i] = m.MultiplyPoint3x4(new Vector3((i & 1) == 0 ? min.x : max.x, (i & 2) == 0 ? min.y : max.y, (i & 4) == 0 ? min.z : max.z));
                Face(p[2], p[6], p[7], p[3], m.MultiplyVector(Vector3.up), top);        // top
                Face(p[0], p[2], p[3], p[1], m.MultiplyVector(Vector3.back), side);     // -z
                Face(p[5], p[7], p[6], p[4], m.MultiplyVector(Vector3.forward), side);  // +z
                Face(p[4], p[6], p[2], p[0], m.MultiplyVector(Vector3.left), side);     // -x
                Face(p[1], p[3], p[7], p[5], m.MultiplyVector(Vector3.right), side);    // +x
            }

            void Face(Vector3 a, Vector3 b, Vector3 c, Vector3 d, Vector3 n, Color col)
            {
                int i = _v.Count;
                _v.Add(a); _v.Add(b); _v.Add(c); _v.Add(d);
                for (int k = 0; k < 4; k++) { _n.Add(n.normalized); _c.Add(col); }
                _t.Add(i); _t.Add(i + 1); _t.Add(i + 2);
                _t.Add(i); _t.Add(i + 2); _t.Add(i + 3);
            }

            public Mesh ToMesh()
            {
                var mesh = new Mesh { indexFormat = UnityEngine.Rendering.IndexFormat.UInt32 };
                mesh.SetVertices(_v);
                mesh.SetNormals(_n);
                mesh.SetColors(_c);
                mesh.SetTriangles(_t, 0);
                mesh.RecalculateBounds();
                return mesh;
            }
        }
    }
}
