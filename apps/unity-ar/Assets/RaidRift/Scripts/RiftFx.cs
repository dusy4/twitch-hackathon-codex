using UnityEngine;

namespace RaidRift
{
    /// <summary>
    /// Pooled, batched impact effects on Unity's ParticleSystem (one renderer per kind, manual Emit — no
    /// GameObject per spark). Timing and counts follow Unity/vfx-incoming/VFX-PLAN.md: anticipation pull-in →
    /// tear (camera hit) → floor shockwave → outward sparks + heavy obsidian chips that bounce once on the
    /// floor + low smoke. Palette: obsidian #100B1B, hot seam #A52BFF, crack #F1C8FF, energy #39E8DA (≤15%),
    /// dust #3D2A4F. Textures: Kenney Particle Pack (CC0).
    /// </summary>
    public class RiftFx : MonoBehaviour
    {
        static RiftFx _i;
        ParticleSystem _sparks, _streaks, _chips, _smoke, _rings, _flares;
        Transform _floorPlane;

        static readonly Color Seam = Hex(0xA52BFF), Crack = Hex(0xF1C8FF), Energy = Hex(0x39E8DA), Dust = Hex(0x3D2A4F), Obsidian = Hex(0x100B1B);

        public static float? FloorY { get; set; }

        void Awake()
        {
            _i = this;
            _floorPlane = new GameObject("Fx floor").transform;
            _floorPlane.SetParent(transform, false);
            var add = Resources.Load<Material>("Materials/FxAdd");
            var alpha = Resources.Load<Material>("Materials/FxAlpha");
            _sparks = Make("Sparks", add, "Fx/Spark", 400, 0.35f);
            _streaks = Make("Streaks", add, "Fx/Streak", 160, 0.3f);
            _streaks.GetComponent<ParticleSystemRenderer>().renderMode = ParticleSystemRenderMode.Stretch;
            var sr = _streaks.GetComponent<ParticleSystemRenderer>(); sr.velocityScale = 0.06f; sr.lengthScale = 1.2f;
            _flares = Make("Flares", add, "Fx/Flare", 16, 0f);
            _smoke = Make("Smoke", alpha, "Fx/Smoke", 48, 0.12f, grow: 2.2f);
            _rings = Make("Rings", add, "Fx/Ring", 12, 0f, grow: 10f);
            _rings.GetComponent<ParticleSystemRenderer>().renderMode = ParticleSystemRenderMode.HorizontalBillboard;
            _chips = Make("Chips", Resources.Load<Material>("Materials/Obsidian"), null, 64, 1f, shrinkOut: true);
            var cr = _chips.GetComponent<ParticleSystemRenderer>();
            cr.renderMode = ParticleSystemRenderMode.Mesh;
            cr.mesh = Resources.GetBuiltinResource<Mesh>("Cube.fbx");
            var main = _chips.main;
            main.startRotation3D = true;
            main.gravityModifier = 0.26f; // ≈ -2.5 m/s²
            var col = _chips.collision;
            col.enabled = true;
            col.type = ParticleSystemCollisionType.Planes;
            col.SetPlane(0, _floorPlane);
            col.bounce = 0.2f;
            col.dampen = 0.5f;
            col.lifetimeLoss = 0f;
            var rot = _chips.rotationOverLifetime;
            rot.enabled = true; rot.separateAxes = true;
            rot.x = new ParticleSystem.MinMaxCurve(-6f, 6f); rot.y = new ParticleSystem.MinMaxCurve(-6f, 6f); rot.z = new ParticleSystem.MinMaxCurve(-6f, 6f);
        }

        void Update()
        {
            if (FloorY.HasValue) _floorPlane.position = new Vector3(0f, FloorY.Value + 0.004f, 0f);
        }

        ParticleSystem Make(string name, Material baseMat, string texture, int max, float gravity, float grow = 1f, bool shrinkOut = false)
        {
            var go = new GameObject(name);
            go.transform.SetParent(transform, false);
            var ps = go.AddComponent<ParticleSystem>();
            ps.Stop(true, ParticleSystemStopBehavior.StopEmittingAndClear);
            var main = ps.main;
            main.loop = false; main.playOnAwake = false;
            main.simulationSpace = ParticleSystemSimulationSpace.World;
            main.maxParticles = max;
            main.gravityModifier = gravity;
            main.scalingMode = ParticleSystemScalingMode.Shape;
            var em = ps.emission; em.enabled = false;
            var sh = ps.shape; sh.enabled = false;
            var col = ps.colorOverLifetime;
            col.enabled = true;
            var g = new Gradient();
            g.SetKeys(new[] { new GradientColorKey(Color.white, 0f), new GradientColorKey(Color.white, 1f) },
                      new[] { new GradientAlphaKey(1f, 0f), new GradientAlphaKey(0.9f, 0.55f), new GradientAlphaKey(0f, 1f) });
            col.color = g;
            var size = ps.sizeOverLifetime;
            size.enabled = true;
            size.size = shrinkOut
                ? new ParticleSystem.MinMaxCurve(1f, new AnimationCurve(new Keyframe(0f, 1f), new Keyframe(0.75f, 1f), new Keyframe(1f, 0f)))
                : new ParticleSystem.MinMaxCurve(1f, AnimationCurve.EaseInOut(0f, 1f, 1f, grow));
            var r = go.GetComponent<ParticleSystemRenderer>();
            if (baseMat != null)
            {
                var m = new Material(baseMat);
                if (texture != null) m.mainTexture = Resources.Load<Texture2D>(texture);
                r.sharedMaterial = m;
            }
            r.sortingFudge = name == "Smoke" ? 2f : 0f;
            ps.Play();
            return ps;
        }

        static void Emit(ParticleSystem ps, Vector3 pos, Vector3 vel, float size, float life, Color color, float rotation = 0f)
        {
            var p = new ParticleSystem.EmitParams
            {
                position = pos, velocity = vel, startSize = size, startLifetime = life,
                startColor = color, rotation = rotation, applyShapeToPosition = false,
            };
            ps.Emit(p, 1);
        }

        static Color Pick() => Random.value < 0.15f ? Energy : Color.Lerp(Seam, Crack, Random.value * 0.45f);

        // ---------------- events ----------------
        /// <summary>0–0.6 s before a tear: sparks and slivers pulled toward the opening.</summary>
        public static void Charge(Vector3 center, Vector3 facing, float scale = 1f)
        {
            if (_i == null) return;
            for (int n = 0; n < 24; n++)
            {
                var from = center + Random.onUnitSphere * Random.Range(0.35f, 0.8f) * scale;
                float life = Random.Range(0.3f, 0.6f);
                Emit(_i._streaks, from, (center - from) / life, Random.Range(0.012f, 0.026f) * scale, life, Pick());
            }
            Emit(_i._flares, center, Vector3.zero, 0.5f * scale, 0.6f, new Color(Seam.r, Seam.g, Seam.b, 0.55f));
            Sfx.PlayAt("charge", center, 0.45f, 0.05f);
        }

        /// <summary>The tear: one camera hit, floor shockwave, sparks, chips, smoke. scale 1 = 1.3 m world rift.</summary>
        public static void Tear(Vector3 center, Vector3 facing, Vector3 floor, float scale = 1f, bool raid = false)
        {
            if (_i == null) return;
            CameraFeel.Impact(raid ? 1f : 0.72f);
            Emit(_i._flares, center, Vector3.zero, 1.2f * scale, 0.18f, Crack);
            // Shockwave: thin ring 0.08 → 0.8 m over 0.36 s (+ delayed echo for raids).
            Emit(_i._rings, floor + Vector3.up * 0.008f, Vector3.zero, 0.16f * scale, 0.36f, new Color(Seam.r, Seam.g, Seam.b, 0.65f));
            if (raid) _i.StartCoroutine(Echo(floor, scale));
            Sfx.PlayAt("crunch", center, raid ? 0.75f : 0.55f, 0.06f);
            _i.StartCoroutine(Clatter(floor));
            int sparks = raid ? 72 : 48, chips = raid ? 24 : 16, smoke = raid ? 8 : 6;
            var side = Vector3.Cross(Vector3.up, facing).normalized;
            for (int n = 0; n < sparks; n++)
            {
                // Mostly out of the opening (toward the viewer), fanned sideways and up.
                var dir = (-facing * Random.Range(0.4f, 1f) + side * Random.Range(-1f, 1f) + Vector3.up * Random.Range(-0.1f, 0.9f)).normalized;
                var ps = n % 3 == 0 ? _i._streaks : _i._sparks;
                Emit(ps, center + Random.insideUnitSphere * 0.15f * scale, dir * Random.Range(0.5f, 1.8f) * scale, Random.Range(0.015f, 0.04f) * scale, Random.Range(0.25f, 0.55f), Pick());
            }
            for (int n = 0; n < chips; n++)
            {
                var dir = (-facing * Random.Range(0.2f, 1f) + side * Random.Range(-1f, 1f) + Vector3.up * Random.Range(0.2f, 1f)).normalized;
                var p = center + side * Random.Range(-0.5f, 0.5f) * scale + Vector3.up * Random.Range(-0.6f, 0.6f) * scale;
                Emit(_i._chips, p, dir * Random.Range(0.3f, 0.8f), Random.Range(0.015f, 0.045f) * scale, Random.Range(0.8f, 1.1f), Obsidian, Random.Range(0f, 360f));
            }
            for (int n = 0; n < smoke; n++)
            {
                var p = floor + side * Random.Range(-0.5f, 0.5f) * scale + Vector3.up * Random.Range(0.02f, 0.25f);
                Emit(_i._smoke, p, (-facing * 0.15f + side * Random.Range(-0.2f, 0.2f) + Vector3.up * 0.05f), Random.Range(0.18f, 0.35f) * scale, Random.Range(0.7f, 1.1f), new Color(Dust.r, Dust.g, Dust.b, 0.55f), Random.Range(0f, 360f));
            }
        }

        static System.Collections.IEnumerator Echo(Vector3 floor, float scale)
        {
            yield return new WaitForSeconds(0.08f);
            Emit(_i._rings, floor + Vector3.up * 0.009f, Vector3.zero, 0.1f * scale, 0.3f, new Color(Crack.r, Crack.g, Crack.b, 0.45f));
        }

        static System.Collections.IEnumerator Clatter(Vector3 floor)
        {
            yield return new WaitForSeconds(0.38f); // chips hit the floor
            Sfx.PlayAt("debris", floor, 0.4f);
            yield return new WaitForSeconds(0.17f);
            Sfx.PlayAt("debris", floor, 0.25f);
        }

        /// <summary>Close: short inward pull, snap, embers. At most 0.25 trauma.</summary>
        public static void Collapse(Vector3 center, float scale = 1f)
        {
            if (_i == null) return;
            CameraFeel.Shake(0.25f);
            for (int n = 0; n < 20; n++)
            {
                var from = center + Random.onUnitSphere * 0.5f * scale;
                Emit(_i._streaks, from, (center - from) / 0.18f, 0.02f * scale, 0.18f, Pick());
            }
            for (int n = 0; n < 10; n++)
                Emit(_i._sparks, center, Random.onUnitSphere * 0.4f, 0.02f, Random.Range(0.3f, 0.5f), Pick());
        }

        /// <summary>A hero bursts out of the rift.</summary>
        public static void Arrival(Vector3 pos, Vector3 outward, bool first)
        {
            if (_i == null) return;
            if (first) CameraFeel.Shake(0.25f);
            for (int n = 0; n < 12; n++)
                Emit(_i._sparks, pos + Vector3.up * 0.06f, (outward * 0.6f + Random.insideUnitSphere * 0.6f + Vector3.up * 0.3f), Random.Range(0.012f, 0.025f), Random.Range(0.25f, 0.45f), Pick());
            for (int n = 0; n < 2; n++)
                Emit(_i._chips, pos + Vector3.up * 0.1f, outward * 0.4f + Random.insideUnitSphere * 0.3f + Vector3.up * 0.4f, Random.Range(0.012f, 0.022f), 0.8f, Obsidian, Random.Range(0f, 360f));
        }

        /// <summary>Landing after a jump: dust ring + a few sparks; heavy landings add a small hit.</summary>
        public static void Land(Vector3 pos, bool heavy)
        {
            if (_i == null) return;
            if (heavy) CameraFeel.Shake(0.35f);
            Emit(_i._rings, pos + Vector3.up * 0.006f, Vector3.zero, 0.05f, 0.22f, new Color(Crack.r, Crack.g, Crack.b, 0.5f));
            for (int n = 0; n < 8; n++)
            {
                var d = Random.insideUnitCircle.normalized;
                Emit(_i._smoke, pos + Vector3.up * 0.01f, new Vector3(d.x, 0.08f, d.y) * Random.Range(0.15f, 0.35f), Random.Range(0.025f, 0.06f), Random.Range(0.22f, 0.4f), new Color(Dust.r * 1.6f, Dust.g * 1.6f, Dust.b * 1.6f, 0.5f), Random.Range(0f, 360f));
            }
            for (int n = 0; n < 6; n++)
                Emit(_i._sparks, pos + Vector3.up * 0.02f, Random.insideUnitSphere * 0.5f + Vector3.up * 0.4f, 0.012f, 0.3f, Pick());
        }

        /// <summary>Chat command accepted (mint) or refused (red): local ring + a few sparks, never a screen effect.</summary>
        public static void Command(Vector3 pos, bool accepted)
        {
            if (_i == null) return;
            var c = accepted ? Hex(0x59F1C8) : Hex(0xFF6A83);
            Emit(_i._rings, pos + Vector3.up * 0.007f, Vector3.zero, 0.04f, 0.18f, new Color(c.r, c.g, c.b, 0.7f));
            for (int n = 0; n < 4; n++)
                Emit(_i._sparks, pos + Vector3.up * 0.12f, Random.insideUnitSphere * 0.35f + Vector3.up * 0.3f, 0.014f, 0.3f, c);
        }

        static Color Hex(int rgb) => new Color(((rgb >> 16) & 255) / 255f, ((rgb >> 8) & 255) / 255f, (rgb & 255) / 255f, 1f);
    }
}
