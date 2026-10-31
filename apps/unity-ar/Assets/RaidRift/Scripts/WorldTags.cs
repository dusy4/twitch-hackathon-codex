using System.Collections.Generic;
using UnityEngine;

namespace RaidRift
{
    /// <summary>
    /// Name tags and banners drawn IN the 3D scene, so they are part of the broadcast (the stream excludes the
    /// HUD). Each tag billboards to the camera and keeps a constant on-screen size (≈ 22 px cap height at 720p),
    /// is occluded like any world object, and shows the viewer's last command under the name.
    /// </summary>
    public static class WorldTags
    {
        class Tag { public Transform root, backing; public TextMesh text; public string last; public float popAt = -10f; public long serial; }
        static readonly Dictionary<string, Tag> _tags = new Dictionary<string, Tag>();
        static Font _font;
        static Material _back, _tagBack, _tagText;

        // Copies of a dynamic font's material (for our own render queue) must follow the font when Unity rebuilds
        // its glyph atlas for new names/characters; otherwise TextMesh UVs point into a stale texture.
        static readonly List<(Font font, Material mat)> _fontMats = new List<(Font, Material)>();
        static bool _rebuildHooked;

        static Material FontCopy(Font font, int queue, string name)
        {
            var m = new Material(font.material) { renderQueue = queue, name = name };
            _fontMats.RemoveAll(e => e.mat == null);
            _fontMats.Add((font, m));
            if (!_rebuildHooked)
            {
                _rebuildHooked = true;
                Font.textureRebuilt += rebuilt =>
                {
                    foreach (var e in _fontMats)
                        if (e.font == rebuilt && e.mat != null) e.mat.mainTexture = rebuilt.material.mainTexture;
                };
            }
            return m;
        }

        public static void Update(Camera cam, IEnumerable<Hero> heroes, bool selfie = false) // SELFIE: default preserves world callers.
        {
            var seen = new HashSet<string>();
            foreach (var hero in heroes)
            {
                if (hero == null || !hero.Spawned) continue;
                seen.Add(hero.Id);
                if (!_tags.TryGetValue(hero.Id, out var tag) || tag.root == null) { tag = Create(hero.Id); _tags[hero.Id] = tag; }
                var msg = string.IsNullOrEmpty(hero.Message) ? "" : "\n<size=42><color=#92ffe0>" + Clean(Truncate(hero.Message, 26)) + "</color></size>";
                string content = Clean(hero.DisplayName ?? "") + msg;
                if (content != tag.last)
                {

                    tag.text.text = content;
                    tag.last = content;
                    var b = tag.text.GetComponent<Renderer>().bounds; // fit the backing to the text (local units)
                    float w = Mathf.Max(0.6f, b.size.x / Mathf.Max(1e-4f, tag.root.lossyScale.x) + 0.25f);
                    tag.backing.localScale = new Vector3(Mathf.Min(w, 3.4f), string.IsNullOrEmpty(msg) ? 0.42f : 0.78f, 1f);
                }
                // A new command (even the same "!jump" twice): pop so the viewer sees it land.
                if (hero.ActionSerial != tag.serial)
                {
                    if (tag.serial != 0 && msg.Length > 0) tag.popAt = Time.time;
                    tag.serial = hero.ActionSerial;
                }
                var top = hero.transform.position + (selfie ? cam.transform.up : Vector3.up) * (hero.DisplayHeight + (selfie ? 0.014f : 0.07f)); // SELFIE: scaled perch label.
                tag.root.position = top;
                var to = top - cam.transform.position;
                tag.root.rotation = Quaternion.LookRotation(to, cam.transform.up); // screen-aligned: no tilt with phone roll
                // Constant apparent size: scale with distance, clamped so far tags don't become billboards.
                float s = Mathf.Clamp(to.magnitude, 0.25f, 4f) * 0.06f;
                float pop = Time.time - tag.popAt;
                if (pop < 0.3f) s *= 1f + 0.3f * Mathf.Sin(pop / 0.3f * Mathf.PI); // quick bounce, back to normal at 0.3 s
                tag.root.localScale = Vector3.one * s;
                // SELFIE: compensate glyphs for provider projection reflection; never mirror the stream/HUD.
                tag.text.transform.localScale = new Vector3(selfie && cam.projectionMatrix.m00 < 0f ? -1f : 1f, 1f, 1f);
                tag.root.gameObject.SetActive(Vector3.Dot(to, cam.transform.forward) > 0.05f);
            }
            var stale = new List<string>();
            foreach (var kv in _tags) if (!seen.Contains(kv.Key)) stale.Add(kv.Key);
            foreach (var k in stale) { if (_tags[k].root != null) Object.Destroy(_tags[k].root.gameObject); _tags.Remove(k); }
        }

        static Tag Create(string id)
        {
            if (_font == null) _font = Resources.Load<Font>("Fonts/Inter-SemiBold") ?? Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            if (_back == null) _back = Resources.Load<Material>("Materials/BlobShadow");
            var root = new GameObject("Tag " + id).transform;
            var text = new GameObject("Text").AddComponent<TextMesh>();
            text.transform.SetParent(root, false);
            text.font = _font;
            // Own render order (shared, made once): plate after the rift window (else the window covers it), text last.
            if (_tagText == null) _tagText = FontCopy(_font, 3110, "Tag text");
            text.GetComponent<MeshRenderer>().sharedMaterial = _tagText;
            text.fontSize = 64;
            text.characterSize = 0.06f;
            text.anchor = TextAnchor.LowerCenter;
            text.alignment = TextAlignment.Center;
            text.richText = true;
            text.color = Color.white;
            var back = GameObject.CreatePrimitive(PrimitiveType.Quad);
            Object.Destroy(back.GetComponent<Collider>());
            back.transform.SetParent(root, false);
            back.transform.localPosition = new Vector3(0f, 0.2f, 0.01f);
            var r = back.GetComponent<Renderer>();
            if (_back != null)
            {
                if (_tagBack == null) _tagBack = new Material(_back) { renderQueue = 3100, name = "Tag plate" };
                r.sharedMaterial = _tagBack;
                var block = new MaterialPropertyBlock();
                block.SetFloat("_Strength", 0.75f);
                r.SetPropertyBlock(block);
            }
            return new Tag { root = root, text = text, backing = back.transform };
        }

        /// <summary>A big moment caption floating over the rift (raid name + count), visible on stream.</summary>
        public static void Banner(Vector3 at, Camera cam, string title, string subtitle, float seconds)
        {
            if (_font == null) _font = Resources.Load<Font>("Fonts/Inter-SemiBold") ?? Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            var go = new GameObject("Banner");
            var text = go.AddComponent<TextMesh>();
            text.font = Resources.Load<Font>("Fonts/SpaceGrotesk-Bold") ?? _font;
            // Own queue: after the rift window (else it draws over the plate) and after the plate.
            var textMat = FontCopy(text.font, 3110, "Banner text");
            Material plateMat = null;
            go.GetComponent<MeshRenderer>().sharedMaterial = textMat;
            text.fontSize = 96;
            text.characterSize = 0.011f; // PlaySmoke play-9 at full scale: 0.018 filled the frame (the fx-banner shot is the 0.6x pop-in)
            text.anchor = TextAnchor.MiddleCenter;
            text.alignment = TextAlignment.Center;
            text.richText = true;
            text.text = $"<color=#ffffff>{Clean(title)}</color>\n<size=60><color=#92ffe0>{Clean(subtitle)}</color></size>";
            go.transform.position = at;
            // Dark soft plate behind the text so it reads over the bright rift and busy rooms.
            if (_back == null) _back = Resources.Load<Material>("Materials/BlobShadow");
            var size = go.GetComponent<MeshRenderer>().bounds.size;
            var plate = GameObject.CreatePrimitive(PrimitiveType.Quad);
            Object.Destroy(plate.GetComponent<Collider>());
            plate.transform.SetParent(go.transform, false);
            plate.transform.localPosition = new Vector3(0f, 0f, 0.02f);
            plate.transform.localScale = new Vector3(Mathf.Max(size.x, 0.3f) * 1.5f + 0.12f, Mathf.Max(size.y, 0.1f) * 1.7f + 0.08f, 1f);
            if (_back != null)
            {
                var pr = plate.GetComponent<Renderer>();
                pr.sharedMaterial = plateMat = new Material(_back) { renderQueue = 3100 };
                var block = new MaterialPropertyBlock();
                block.SetFloat("_Strength", 0.85f);
                pr.SetPropertyBlock(block);
            }
            go.AddComponent<BannerLife>().Init(cam, seconds, textMat, plateMat);
        }

        class BannerLife : MonoBehaviour
        {
            Camera _cam; float _until, _born; Vector3 _base; Material[] _owned;
            public void Init(Camera cam, float seconds, params Material[] owned) { _owned = owned; _cam = cam; _born = Time.time; _until = Time.time + seconds; _base = transform.position; }
            void LateUpdate()
            {
                if (Time.time > _until || _cam == null) { Destroy(gameObject); return; }
                float age = Time.time - _born, left = _until - Time.time;
                // Pop in (overshoot), float up gently, fade by shrinking out at the end.
                float pop = age < 0.18f ? Mathf.SmoothStep(0.6f, 1.12f, age / 0.18f) : Mathf.Lerp(1.12f, 1f, Mathf.Clamp01((age - 0.18f) / 0.12f));
                float outS = Mathf.Clamp01(left / 0.25f);
                var p = _base + Vector3.up * (age * 0.04f);
                p += (_cam.transform.position - p).normalized * 0.35f; // in front of the rift window's depth
                // Portrait phone ~1.5 m from the rift: 2 m up is above the frame. Keep the banner on screen
                // (upper part of the stream's 9:16 crop), at the same depth so it still sits in the scene.
                var vp = _cam.WorldToViewportPoint(p);
                if (vp.z > 0.2f)
                {
                    vp.x = Mathf.Clamp(vp.x, 0.2f, 0.8f);
                    vp.y = Mathf.Clamp(vp.y, 0.2f, 0.74f);
                    // Phone tilted down: the point above the rift is only ~0.6 m deep and the banner filled the
                    // frame (PlaySmoke play-9). Keep it at least 1.4 m out.
                    vp.z = Mathf.Max(vp.z, 1.4f);
                    p = _cam.ViewportToWorldPoint(vp);
                }
                transform.position = p;
                transform.rotation = Quaternion.LookRotation(transform.position - _cam.transform.position, Vector3.up);
                transform.localScale = Vector3.one * pop * outS;
            }

            void OnDestroy() { if (_owned != null) foreach (var m in _owned) if (m != null) Destroy(m); } // only Banner()'s own instances
        }

        static string Clean(string s) => (s ?? "").Replace("<", "‹").Replace(">", "›");
        static string Truncate(string s, int n) => s.Length <= n ? s : s.Substring(0, n - 1) + "…";

        public static void Clear()
        {
            foreach (var t in _tags.Values) if (t.root != null) Object.Destroy(t.root.gameObject);
            _tags.Clear();
        }
    }
}
