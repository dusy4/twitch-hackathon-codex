using UnityEngine;

namespace RaidRift
{
    /// <summary>
    /// Game feel on the final AR image, visible on the phone and on the stream. Trauma-based screen shake
    /// (amount = trauma², Perlin noise, decays ~1.4/s), zoom punch, colour flash, radial chromatic pulse,
    /// edge vignette pulse and a light bloom so portal glow reads on camera. All of it happens on the
    /// composited image, never on the tracked camera pose, so AR registration and tracking are untouched.
    /// Calls are static so any system can add impact: CameraFeel.Impact(0.6f) on a portal tear.
    /// </summary>
    [RequireComponent(typeof(Camera))]
    public class CameraFeel : MonoBehaviour
    {
        static CameraFeel _instance;

        [Header("Shake")]
        public float maxOffset = 0.012f;    // uv at trauma 1 ≈ 9 px at 720p (VFX plan cap 7 px, x1.3 for impact)
        public float maxAngle = 0.36f;      // degrees at trauma 1 (plan 0.28°)
        public float frequency = 15f;       // Hz of the noise
        public float traumaDecay = 1.9f;    // per second: a 0.65 tear is gone in ~0.35 s
        [Header("Bloom")]
        public float bloomThreshold = 0.9f;
        public float bloomKnee = 0.35f;
        public float bloomIntensity = 0.12f; // idle: whole-image bloom also hazes room lights, so keep it low and pulse it on impacts
        [Header("Stream safety")]
        [Range(0f, 1f)] public float intensity = 1f; // master scale, e.g. lower for motion-sensitive viewers

        float _trauma, _punch, _flash, _chroma, _vignette, _bloomPulse;
        Color _flashColor = Color.white, _vignetteColor = new Color(0.22f, 0.04f, 0.38f);
        float _seed;
        Material _mat;
        static readonly int MainTexSize = Shader.PropertyToID("_MainTex_TexelSize");
        static readonly int BloomTex = Shader.PropertyToID("_BloomTex");
        readonly RenderTexture[] _chain = new RenderTexture[3];

        /// <summary>Viewer comfort: no shake/zoom/fringe; flashes stay but softer. Persisted on the phone.</summary>
        public static bool ReducedMotion
        {
            get => PlayerPrefs.GetInt("rr.reducedMotion", 0) == 1;
            set { PlayerPrefs.SetInt("rr.reducedMotion", value ? 1 : 0); PlayerPrefs.Save(); }
        }

        // ---------------- API ----------------
        /// <summary>Add shake trauma (0..1). Stacks, capped at 1.</summary>
        public static void Shake(float trauma) { if (_instance != null) _instance._trauma = Mathf.Min(1f, Mathf.Max(_instance._trauma, trauma) + 0.1f * Mathf.Min(_instance._trauma, trauma)); } // target, not a sum: collisions never stack unbounded

        /// <summary>Quick zoom-in that springs back (0.02 = 2%).</summary>
        public static void Punch(float zoom) { if (_instance != null) _instance._punch = Mathf.Max(_instance._punch, zoom); }

        public static void Flash(Color color, float amount)
        {
            if (_instance == null) return;
            _instance._flashColor = color;
            _instance._flash = Mathf.Max(_instance._flash, amount);
        }

        public static void Chroma(float amount) { if (_instance != null) _instance._chroma = Mathf.Max(_instance._chroma, amount); }

        public static void Vignette(Color color, float amount)
        {
            if (_instance == null) return;
            _instance._vignetteColor = color;
            _instance._vignette = Mathf.Max(_instance._vignette, amount);
        }

        /// <summary>One-call "hit": shake + punch + chroma (+ optional flash), scaled by strength 0..1.</summary>
        public static void Impact(float strength, Color? flash = null)
        {
            Shake(0.9f * strength);
            Punch(0.025f * strength);
            Chroma(0.003f * strength);
            if (_instance != null) _instance._bloomPulse = Mathf.Max(_instance._bloomPulse, 0.6f * strength);
            Flash(flash ?? new Color(0.91f, 0.78f, 1f), 0.14f * strength); // #E8C7FF single-frame peak
        }

        // ---------------- runtime ----------------
        void OnEnable() { _instance = this; _seed = Random.value * 100f; }
        void OnDisable() { if (_instance == this) _instance = null; ReleaseChain(); }

        void Update()
        {
            float dt = Time.unscaledDeltaTime;
            _trauma = Mathf.MoveTowards(_trauma, 0f, traumaDecay * dt);
            _punch = Mathf.Lerp(_punch, 0f, 1f - Mathf.Exp(-12f * dt));  // ~180 ms return
            _flash = Mathf.MoveTowards(_flash, 0f, 1.8f * dt);              // 0.14 peak gone in ~80 ms
            _bloomPulse = Mathf.MoveTowards(_bloomPulse, 0f, 2f * dt);
            _chroma = Mathf.Lerp(_chroma, 0f, 1f - Mathf.Exp(-6f * dt));
            _vignette = Mathf.MoveTowards(_vignette, 0f, 0.9f * dt);
        }

        void OnRenderImage(RenderTexture src, RenderTexture dst)
        {
            if (_mat == null)
            {
                // The Resources material keeps the shader in the build.
                var asset = Resources.Load<Material>("Materials/CameraFeel");
                var shader = asset != null ? asset.shader : Shader.Find("RaidRift/CameraFeel");
                if (shader == null || !shader.isSupported) { Graphics.Blit(src, dst); return; }
                _mat = new Material(shader) { hideFlags = HideFlags.HideAndDontSave };
            }
            float k = Mathf.Clamp01(intensity);
            float m = ReducedMotion ? 0f : k; // motion terms
            float shake = _trauma * _trauma * m;
            float t = Time.unscaledTime * frequency;
            var offset = new Vector2(Noise(_seed, t), Noise(_seed + 17.3f, t)) * (maxOffset * shake);
            float angle = Noise(_seed + 41.7f, t) * maxAngle * shake * Mathf.Deg2Rad;
            // Always zoom a little past the largest offset so no frame edge ever shows.
            float zoom = 1f + _punch * m + maxOffset * 2.2f * shake + Mathf.Abs(angle) * 0.6f;
            _mat.SetVector("_Shake", new Vector4(offset.x, offset.y, angle, zoom));
            _mat.SetFloat("_Aspect", (float)src.width / Mathf.Max(1, src.height));
            _mat.SetFloat("_Chroma", _chroma * m);
            _mat.SetVector("_FlashColor", new Vector4(_flashColor.r, _flashColor.g, _flashColor.b, Mathf.Min(0.18f, _flash) * k));
            _mat.SetFloat("_Vignette", _vignette * k);
            _mat.SetColor("_VignetteColor", _vignetteColor);

            // Bloom: prefilter at 1/4 res, two more halvings, then tent-upsample back with additive blend.
            _mat.SetVector("_Threshold", new Vector4(bloomThreshold, bloomKnee, 4f, 0f));
            int w = Mathf.Max(1, src.width / 4), h = Mathf.Max(1, src.height / 4);
            for (int i = 0; i < _chain.Length; i++)
            {
                if (_chain[i] == null || _chain[i].width != w || _chain[i].height != h)
                {
                    if (_chain[i] != null) _chain[i].Release();
                    _chain[i] = new RenderTexture(w, h, 0, src.format) { filterMode = FilterMode.Bilinear, name = "CameraFeel bloom " + i };
                }
                w = Mathf.Max(1, w / 2); h = Mathf.Max(1, h / 2);
            }
            Graphics.Blit(src, _chain[0], _mat, 0);
            for (int i = 1; i < _chain.Length; i++) Graphics.Blit(_chain[i - 1], _chain[i], _mat, 1);
            for (int i = _chain.Length - 1; i > 0; i--) Graphics.Blit(_chain[i], _chain[i - 1], _mat, 2);
            _mat.SetTexture(BloomTex, _chain[0]);
            _mat.SetFloat("_BloomIntensity", bloomIntensity + _bloomPulse * k);
            Graphics.Blit(src, dst, _mat, 3);
        }

        static float Noise(float seed, float t) => Mathf.PerlinNoise(seed, t) * 2f - 1f;

        void ReleaseChain()
        {
            for (int i = 0; i < _chain.Length; i++) { if (_chain[i] != null) { _chain[i].Release(); Destroy(_chain[i]); } _chain[i] = null; }
            if (_mat != null) Destroy(_mat);
        }
    }
}
