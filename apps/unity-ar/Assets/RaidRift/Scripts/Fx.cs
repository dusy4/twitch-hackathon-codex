using System.Collections.Generic;
using UnityEngine;

namespace RaidRift
{
    /// <summary>Pooled particle "juice": landing dust, sparkle bursts, rift-hop flashes. Camera-facing glow
    /// quads, no ParticleSystem (no stripped default shaders). One update loop for every live particle.</summary>
    public class Fx : MonoBehaviour
    {
        class Particle { public Transform t; public Renderer r; public MaterialPropertyBlock block; public Vector3 vel; public float age, life, size; public Color color; public float gravity; }

        static Fx _instance;
        readonly List<Particle> _live = new List<Particle>();
        readonly Stack<Particle> _free = new Stack<Particle>();
        Material _glow;
        Camera _cam;
        static readonly int ColorId = Shader.PropertyToID("_Color");

        void Awake()
        {
            _instance = this;
            _glow = Resources.Load<Material>("Materials/Glow");
        }

        Particle Take()
        {
            if (_free.Count > 0) { var p = _free.Pop(); p.t.gameObject.SetActive(true); return p; }
            var q = GameObject.CreatePrimitive(PrimitiveType.Quad);
            Destroy(q.GetComponent<Collider>());
            q.transform.SetParent(transform, false);
            var r = q.GetComponent<Renderer>();
            r.sharedMaterial = _glow;
            r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            return new Particle { t = q.transform, r = r, block = new MaterialPropertyBlock() };
        }

        void Emit(Vector3 pos, Vector3 vel, Color color, float size, float life, float gravity)
        {
            if (_live.Count > 400) return;
            var p = Take();
            p.t.position = pos;
            p.vel = vel; p.color = color; p.size = size; p.life = life; p.age = 0f; p.gravity = gravity;
            // Ready to draw now: a fresh primitive is a 1 m quad with the material's own colour, and an emit after this
            // LateUpdate (coroutines, other LateUpdates) drew that slab for a frame (PlaySmoke play-36/37).
            p.t.localScale = Vector3.one * size;
            if (_cam != null) p.t.rotation = _cam.transform.rotation;
            p.block.SetColor(ColorId, color);
            p.r.SetPropertyBlock(p.block);
            _live.Add(p);
        }

        /// <summary>Soft ring of dust where a hero lands.</summary>
        public static void Dust(Vector3 pos, float strength = 1f)
        {
            if (_instance == null) return;
            int n = Mathf.RoundToInt(10 * strength);
            for (int i = 0; i < n; i++)
            {
                float a = i * Mathf.PI * 2f / n + Random.value * 0.4f;
                var dir = new Vector3(Mathf.Cos(a), 0f, Mathf.Sin(a));
                _instance.Emit(pos + dir * 0.03f + Vector3.up * 0.01f, dir * Random.Range(0.25f, 0.45f) * strength + Vector3.up * 0.08f,
                    new Color(0.85f, 0.8f, 0.95f, 0.5f), 0.05f, 0.45f, 0f);
            }
        }

        /// <summary>Upward sparkle burst (spawns, rift hops, cheers, pickups).</summary>
        public static void Sparkle(Vector3 pos, Color color, int count = 16, float speed = 0.6f)
        {
            if (_instance == null) return;
            for (int i = 0; i < count; i++)
            {
                var dir = Random.onUnitSphere;
                dir.y = Mathf.Abs(dir.y) + 0.3f;
                _instance.Emit(pos, dir.normalized * Random.Range(0.4f, 1f) * speed, color, Random.Range(0.025f, 0.05f), Random.Range(0.5f, 0.9f), -1.2f);
            }
        }

        /// <summary>A single drifting mote (trails behind running heroes).</summary>
        public static void Mote(Vector3 pos, Color color)
        {
            if (_instance == null) return;
            _instance.Emit(pos, Random.insideUnitSphere * 0.05f + Vector3.up * 0.06f, color, 0.025f, 0.6f, 0f);
        }

        void LateUpdate()
        {
            if (_cam == null) _cam = Camera.main;
            float dt = Time.deltaTime;
            for (int i = _live.Count - 1; i >= 0; i--)
            {
                var p = _live[i];
                p.age += dt;
                if (p.age >= p.life)
                {
                    p.t.gameObject.SetActive(false);
                    _free.Push(p);
                    _live.RemoveAt(i);
                    continue;
                }
                p.vel += Vector3.up * p.gravity * dt;
                p.vel *= 1f - 2.5f * dt;
                p.t.position += p.vel * dt;
                float k = p.age / p.life;
                p.t.localScale = Vector3.one * p.size * (1f + k * 0.8f);
                if (_cam != null) p.t.rotation = _cam.transform.rotation;
                var c = p.color;
                c.a *= 1f - k * k;
                p.block.SetColor(ColorId, c);
                p.r.SetPropertyBlock(p.block);
            }
        }
    }
}
