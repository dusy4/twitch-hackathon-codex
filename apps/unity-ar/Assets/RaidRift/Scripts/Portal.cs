using System.Collections.Generic;
using UnityEngine;

namespace RaidRift
{
    /// <summary>Original voxel raid portal, doll-house scale (~0.5 m tall) so it never fills the screen:
    /// obsidian-like cube frame, swirling purple membrane, orbiting shards. Opens in 0.75 s,
    /// closes by itself after [lifetime] seconds.</summary>
    public class Portal : MonoBehaviour
    {
        public float lifetime = 10f;
        public string Banner { get; private set; }
        public bool Closed => _age > lifetime + 0.6f;

        const float Block = 0.055f;
        const int Width = 6, Tall = 9; // blocks
        float _age;
        Transform _membrane;
        readonly List<Transform> _shards = new List<Transform>();

        public static Portal Spawn(Vector3 foot, Vector3 faceTowards, string banner, Transform parent)
        {
            var go = new GameObject("Portal");
            go.transform.SetParent(parent, false);
            var look = faceTowards - foot;
            look.y = 0f;
            go.transform.SetPositionAndRotation(foot, look.sqrMagnitude > 1e-4f ? Quaternion.LookRotation(look.normalized) : Quaternion.identity);
            var portal = go.AddComponent<Portal>();
            portal.Banner = banner;
            portal.Build();
            return portal;
        }

        void Build()
        {
            var obsidian = Resources.Load<Material>("Materials/Obsidian");
            var glow = Resources.Load<Material>("Materials/PortalSwirl");
            var shard = Resources.Load<Material>("Materials/Crystal");
            float half = Width * Block / 2f;
            for (int x = 0; x < Width; x++)
            for (int y = 0; y < Tall; y++)
            {
                bool edge = x == 0 || x == Width - 1 || y == 0 || y == Tall - 1;
                if (!edge) continue;
                var cube = Cube(obsidian, Block * 0.96f);
                cube.localPosition = new Vector3(-half + (x + .5f) * Block, (y + .5f) * Block, 0f);
            }
            var quad = GameObject.CreatePrimitive(PrimitiveType.Quad);
            Destroy(quad.GetComponent<Collider>());
            quad.transform.SetParent(transform, false);
            quad.transform.localPosition = new Vector3(0f, Tall * Block / 2f, 0f);
            quad.transform.localScale = new Vector3((Width - 2) * Block, (Tall - 2) * Block, 1f);
            if (glow != null) quad.GetComponent<Renderer>().sharedMaterial = glow;
            _membrane = quad.transform;
            for (int i = 0; i < 10; i++)
            {
                var s = Cube(shard != null ? shard : obsidian, 0.018f);
                _shards.Add(s);
            }
            transform.localScale = Vector3.one * 0.01f;
        }

        Transform Cube(Material m, float size)
        {
            var c = GameObject.CreatePrimitive(PrimitiveType.Cube);
            Destroy(c.GetComponent<Collider>());
            c.transform.SetParent(transform, false);
            c.transform.localScale = Vector3.one * size;
            var r = c.GetComponent<Renderer>();
            if (m != null) r.sharedMaterial = m;
            r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            return c.transform;
        }

        bool _openCue, _closeCue;

        void Update()
        {
            if (!_openCue) { _openCue = true; Sfx.Play("portal_open"); }
            _age += Time.deltaTime;
            if (!_closeCue && _age > lifetime) { _closeCue = true; Sfx.Play("portal_close"); }
            float open = Mathf.SmoothStep(0f, 1f, Mathf.Clamp01(_age / 0.75f));
            float close = Mathf.SmoothStep(1f, 0f, Mathf.Clamp01((_age - lifetime) / 0.6f));
            transform.localScale = Vector3.one * Mathf.Max(0.01f, open * close);
            if (_membrane != null) _membrane.localRotation = Quaternion.Euler(0f, 0f, Mathf.Sin(_age * 1.3f) * 4f);
            float h = Tall * Block / 2f;
            for (int i = 0; i < _shards.Count; i++)
            {
                float a = _age * (1.2f + i * 0.07f) + i * 0.628f;
                float r = Width * Block * 0.75f + Mathf.Sin(_age * 2f + i) * 0.02f;
                _shards[i].localPosition = new Vector3(Mathf.Cos(a) * r, h + Mathf.Sin(a * 0.7f + i) * h * 0.8f, Mathf.Sin(a) * r * 0.35f);
                _shards[i].localRotation = Quaternion.Euler(_age * 90f + i * 20f, _age * 60f, 45f);
            }
            if (Closed) Destroy(gameObject);
        }

        /// <summary>Where arriving heroes appear: just in front of the membrane.</summary>
        public Vector3 Foot => transform.position + transform.forward * 0.08f;
    }
}
