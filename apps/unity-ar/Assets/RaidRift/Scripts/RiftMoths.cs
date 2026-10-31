using System.Collections.Generic;
using UnityEngine;

namespace RaidRift
{
    /// <summary>Flying life in the room: glowing Rift moths with light trails. They burst out of the rift
    /// window when it opens, then wander (Perlin flight) around an anchor (the rift, or the streamer when
    /// the party follows), between knee and head height, never flying into the phone.</summary>
    public class RiftMoths : MonoBehaviour
    {
        class Moth
        {
            public Transform t, wingL, wingR;
            public Vector3 vel;
            public float seed, speed;
        }

        readonly List<Moth> _moths = new List<Moth>();
        Material _glow;
        Camera _cam;
        public Vector3 Anchor { get; set; }
        public float? FloorY { get; set; }
        const int Max = 8; // VFX plan: 4–6 visible, 8 max, so the streamer stays the subject

        void Awake() => _glow = Resources.Load<Material>("Materials/Glow");

        /// <summary>Release [count] moths from [origin], flying along [forward] (out of the rift).</summary>
        public void Burst(Vector3 origin, Vector3 forward, int count)
        {
            for (int i = 0; i < count && _moths.Count < Max; i++)
            {
                var m = Create(i % 3 == 0 ? new Color(0.55f, 1f, 0.88f, 1f) : new Color(0.85f, 0.6f, 1f, 1f));
                m.t.position = origin + Random.insideUnitSphere * 0.2f;
                m.vel = (forward + Random.insideUnitSphere * 0.6f + Vector3.up * 0.3f).normalized * Random.Range(0.8f, 1.4f);
                _moths.Add(m);
                if (_moths.Count <= 2) Sfx.Loop("moth_flutter", m.t, 0.25f, 3f);
            }
        }

        Moth Create(Color color)
        {
            var root = new GameObject("Moth").transform;
            root.SetParent(transform, false);
            var body = Quad(root, color, 0.035f);
            body.localRotation = Quaternion.identity;
            var wingL = Quad(root, color * 0.8f, 0.05f);
            var wingR = Quad(root, color * 0.8f, 0.05f);
            var trail = root.gameObject.AddComponent<TrailRenderer>();
            trail.sharedMaterial = _glow;
            trail.time = 0.22f; // short taper (plan 0.18–0.25 s)
            trail.startWidth = 0.018f;
            trail.endWidth = 0f;
            trail.startColor = new Color(color.r, color.g, color.b, 0.6f);
            trail.endColor = new Color(color.r, color.g, color.b, 0f);
            trail.minVertexDistance = 0.02f;
            trail.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            return new Moth { t = root, wingL = wingL, wingR = wingR, seed = Random.value * 100f, speed = Random.Range(0.25f, 0.5f) };
        }

        Transform Quad(Transform parent, Color color, float size)
        {
            var q = GameObject.CreatePrimitive(PrimitiveType.Quad);
            Destroy(q.GetComponent<Collider>());
            q.transform.SetParent(parent, false);
            q.transform.localScale = Vector3.one * size;
            var r = q.GetComponent<Renderer>();
            r.sharedMaterial = _glow;
            var block = new MaterialPropertyBlock();
            block.SetColor("_Color", color);
            r.SetPropertyBlock(block);
            r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            return q.transform;
        }

        void Update()
        {
            if (_cam == null) _cam = Camera.main;
            if (_cam == null) return;
            float dt = Time.deltaTime, time = Time.time;
            float floor = FloorY ?? _cam.transform.position.y - 1.3f;
            foreach (var m in _moths)
            {
                var p = m.t.position;
                // Wander: Perlin steering + pull toward the anchor + height band + keep off the phone.
                var wander = new Vector3(Mathf.PerlinNoise(m.seed, time * 0.4f) - 0.5f, Mathf.PerlinNoise(m.seed + 7f, time * 0.35f) - 0.5f, Mathf.PerlinNoise(m.seed + 13f, time * 0.4f) - 0.5f) * 2.4f;
                var toAnchor = Anchor - p;
                toAnchor.y = 0f;
                var steer = wander + toAnchor * (toAnchor.magnitude > 2.2f ? 0.9f : 0.12f);
                float h = p.y - floor;
                if (h < 0.35f) steer.y += 1.5f;
                if (h > 1.9f) steer.y -= 1.5f;
                var fromCam = p - _cam.transform.position;
                if (fromCam.magnitude < 0.6f) steer += fromCam.normalized * 3f; // keep 0.6 m off the lens
                m.vel = Vector3.Lerp(m.vel, steer.normalized * m.speed, 1f - Mathf.Exp(-1.6f * dt));
                m.t.position = p + m.vel * dt;
                if (m.vel.sqrMagnitude > 1e-4f) m.t.rotation = Quaternion.LookRotation(m.vel.normalized);
                // Flapping: wings rotate about the body's forward axis.
                float flap = Mathf.Sin(time * 22f + m.seed) * 55f;
                m.wingL.localPosition = new Vector3(-0.022f, 0f, 0f);
                m.wingR.localPosition = new Vector3(0.022f, 0f, 0f);
                m.wingL.localRotation = Quaternion.Euler(90f, 0f, flap);
                m.wingR.localRotation = Quaternion.Euler(90f, 0f, -flap);
            }
        }

        public void Clear()
        {
            foreach (var m in _moths) Destroy(m.t.gameObject);
            _moths.Clear();
        }
    }
}
