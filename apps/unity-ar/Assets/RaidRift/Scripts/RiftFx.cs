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

        // Cartoon FX Remaster Free (owner's Asset Store license), assigned by BuildTools. Scaled to 30 cm heroes.
        public GameObject impactGlow, groundHit, magicPoof, hitLight, comicWow, firework, runeAura, souls, fallingStars;

        static GameObject Spawn(GameObject prefab, Vector3 pos, float scale, Vector3? face = null, Color? rootTint = null)
        {
            if (prefab == null) return null;
            var rot = face.HasValue && face.Value.sqrMagnitude > 1e-4f ? Quaternion.LookRotation(face.Value) : Quaternion.identity;
            var go = Instantiate(prefab, pos, rot);
            foreach (var ps in go.GetComponentsInChildren<ParticleSystem>(true)) { var m = ps.main; m.scalingMode = ParticleSystemScalingMode.Hierarchy; FrameRateFreeDamping(ps); }
            // Tints only the root system (e.g. the poof's cloud), so coloured children like its stars keep their colours.
            if (rootTint.HasValue && go.TryGetComponent<ParticleSystem>(out var root)) { var m = root.main; m.startColor = new ParticleSystem.MinMaxGradient(rootTint.Value); }
            go.transform.localScale = Vector3.one * scale;
            NoCameraShake(go);
            Destroy(go, 5f); // CFXR clears itself too; this is the backstop
            return go;
        }

        /// <summary>CFXR bursts (firework: 20 m/s rays) brake with Limit Velocity "dampen", a fraction removed per FRAME:
        /// rays that stop at 0.3 m in a fast editor preview fly ~1.5 m at 60 fps and ~3 m at a hot phone's 30 fps,
        /// i.e. through the lens as screen-long streaks (FxPreview fx-900). Same braking as at 60 fps, but in time.</summary>
        static void FrameRateFreeDamping(ParticleSystem ps)
        {
            var lv = ps.limitVelocityOverLifetime;
            if (!lv.enabled || lv.dampen <= 0f || lv.separateAxes) return;
            if (lv.limit.mode != ParticleSystemCurveMode.Constant || lv.limit.constant * lv.limitMultiplier > 0.05f) return; // only "brake everything" setups
            float drag = -Mathf.Log(1f - Mathf.Min(lv.dampen, 0.95f)) * 60f;
            lv.dampen = 0f;
            lv.drag = new ParticleSystem.MinMaxCurve(drag);
            lv.multiplyDragByParticleSize = false;
            lv.multiplyDragByParticleVelocity = false;
        }

        /// <summary>Firework rays launch at 20 m/s and brake 20% per frame down to a 1 m/s drift for 1.7 s: at a hot
        /// phone's 30 fps they reach ~3 m, through the lens as a screen-long beam (FxPreview fx-900, which steps at
        /// 1/30 s). Slower launch + slower drift keeps the burst ~1 m around the rift.</summary>
        static void TameBurst(GameObject go, float speed = 0.35f, float drift = 0.3f)
        {
            if (go == null) return;
            foreach (var ps in go.GetComponentsInChildren<ParticleSystem>(true))
            {
                var lv = ps.limitVelocityOverLifetime;
                if (!lv.enabled) continue; // only the per-frame-braked systems overshoot on a phone
                var m = ps.main; m.startSpeedMultiplier *= speed;
                lv.limitMultiplier *= drift;
            }
        }

        /// <summary>CFXR's own shake moves the tracked AR camera (breaks registration). Turn it off on every spawn,
        /// even after a fresh pack import resets CFXR_Effect.cs; CameraFeel provides the shake instead.</summary>
        static void NoCameraShake(GameObject go)
        {
            // CFXR lights (hit light, impact glow, firework, rune aura) next to the window flooded the lit voxel world
            // behind it white for a frame (PlaySmoke play-36): they only light the real-room layer.
            foreach (var l in go.GetComponentsInChildren<Light>(true)) l.cullingMask &= ~(1 << RiftWorld.Layer);
            foreach (var mb in go.GetComponentsInChildren<MonoBehaviour>(true))
            {
                if (mb == null || mb.GetType().FullName != "CartoonFX.CFXR_Effect") continue;
                var shake = mb.GetType().GetField("cameraShake")?.GetValue(mb);
                shake?.GetType().GetField("enabled")?.SetValue(shake, false);
            }
        }

        void Awake()
        {
            _i = this;
            _floorPlane = new GameObject("Fx floor").transform;
            _floorPlane.SetParent(transform, false);
            var add = Resources.Load<Material>("Materials/FxAdd");
            var alpha = Resources.Load<Material>("Materials/FxAlpha");
            // Kenney Spark/Streak are faint clouds with a 2-px core at spark sizes (fx-emotes preview showed nothing):
            // a solid hot dot reads on a phone and at 720p; stretched along velocity it is the streak too.
            _sparks = Make("Sparks", add, "dot", 400, 0.35f);
            _streaks = Make("Streaks", add, "dot", 160, 0.3f);
            // Daylight twin: additive light vanishes on a sunny pavement; alpha-blended dots stay visible there.
            _dayDots = alpha != null ? new Material(alpha) { mainTexture = Dot(), name = "Fx dot day" } : null;
            _nightDots = new[] { _sparks.GetComponent<ParticleSystemRenderer>().sharedMaterial, _streaks.GetComponent<ParticleSystemRenderer>().sharedMaterial };
            _streaks.GetComponent<ParticleSystemRenderer>().renderMode = ParticleSystemRenderMode.Stretch;
            var sr = _streaks.GetComponent<ParticleSystemRenderer>(); sr.velocityScale = 0.06f; sr.lengthScale = 1.2f;
            _flares = Make("Flares", add, "Fx/Flare", 16, 0f);
            _smoke = Make("Smoke", alpha, "Fx/Smoke", 48, 0.12f, grow: 2.2f);
            _rings = Make("Rings", add, "Fx/Ring", 24, 0f, grow: 10f);
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

        // ---------------- ambient life on an open rift ----------------
        Transform _ambient;
        GameObject _aura;
        float _emberClock, _seamClock;

        /// <summary>Set by the app to the open rift's transform (null when closed): a rune circle glows under it and
        /// embers drift up from the opening, so the portal stays alive after the opening burst.</summary>
        public static void SetAmbient(Transform rift)
        {
            if (_i == null || _i._ambient == rift) return;
            _i._ambient = rift;
            if (_i._aura != null) Destroy(_i._aura);
            if (rift != null && _i.runeAura != null)
            {
                _i._aura = Instantiate(_i.runeAura, rift.position + Vector3.up * 0.01f, Quaternion.identity, rift);
                // fx-ambient preview: the stock white runes + light pillars washed out heroes on the landing spot.
                // Rift violet, translucent, a bit smaller.
                var tint = new Color(Seam.r, Seam.g, Seam.b, 0.5f);
                foreach (var ps in _i._aura.GetComponentsInChildren<ParticleSystem>(true))
                {
                    var m = ps.main; m.scalingMode = ParticleSystemScalingMode.Hierarchy; m.loop = true;
                    m.startColor = new ParticleSystem.MinMaxGradient(tint);
                }
                _i._aura.transform.localScale = Vector3.one * 0.75f;
                NoCameraShake(_i._aura);
            }
        }

        Material _dayDots;
        Material[] _nightDots;
        bool _daylight;

        void Update()
        {
            if (FloorY.HasValue) _floorPlane.position = new Vector3(0f, FloorY.Value + 0.004f, 0f);
            // Hysteresis so a cloud doesn't flip the look back and forth.
            bool day = _daylight ? LightMatch.Brightness01 > 0.45f : LightMatch.Brightness01 > 0.65f;
            if (day != _daylight && _dayDots != null)
            {
                _daylight = day;
                _sparks.GetComponent<ParticleSystemRenderer>().sharedMaterial = day ? _dayDots : _nightDots[0];
                _streaks.GetComponent<ParticleSystemRenderer>().sharedMaterial = day ? _dayDots : _nightDots[1];
            }
            if (_ambient == null) return;
            var side = _ambient.right;
            _emberClock += Time.deltaTime * 14f; // ~14 embers/s
            while (_emberClock >= 1f)
            {
                _emberClock -= 1f;
                var p = _ambient.position + side * Random.Range(-0.6f, 0.6f) + Vector3.up * Random.Range(0.05f, 1.7f);
                Emit(_sparks, p, Vector3.up * Random.Range(0.15f, 0.45f) - _ambient.forward * Random.Range(0.05f, 0.25f), Random.Range(0.012f, 0.03f), Random.Range(0.8f, 1.6f), Pick());
            }
            _seamClock -= Time.deltaTime;
            if (_seamClock <= 0f)
            {
                _seamClock = Random.Range(2.5f, 4f);
                // Seam surge: a quick flare and a puff of streaks out of the opening.
                var c = _ambient.position + Vector3.up * 0.95f;
                Emit(_flares, c, Vector3.zero, 0.9f, 0.35f, new Color(Seam.r, Seam.g, Seam.b, 0.45f));
                for (int n = 0; n < 10; n++)
                    Emit(_streaks, c + Random.insideUnitSphere * 0.3f, (-_ambient.forward + Random.insideUnitSphere * 0.6f) * Random.Range(0.4f, 1f), 0.02f, 0.4f, Pick());
            }
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
                if (texture == "dot") m.mainTexture = Dot();
                else if (texture != null) m.mainTexture = Resources.Load<Texture2D>(texture);
                r.sharedMaterial = m;
            }
            r.sortingFudge = name == "Smoke" ? 2f : 0f;
            ps.Play();
            return ps;
        }

        /// <summary>Sparks/streaks sized in metres are 2–5 px at 720p from 1.5 m (fx-sheet preview): scale them up
        /// so the stream sees them. Chips, smoke, rings and flares keep their physical sizes.</summary>
        const float StreamReadable = 2.0f;

        static void Emit(ParticleSystem ps, Vector3 pos, Vector3 vel, float size, float life, Color color, float rotation = 0f)
        {
            if (_i != null && (ps == _i._sparks || ps == _i._streaks)) size *= StreamReadable;
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
            // In front of the window (-facing = toward the viewer): at the portal plane its depth hid all of this.
            center -= facing.normalized * 0.25f * scale;
            // Reads at 720p: a dense inward pull of streaks + motes and a seam glow that swells into the tear.
            for (int n = 0; n < 48; n++)
            {
                var from = center + Random.onUnitSphere * Random.Range(0.4f, 1.0f) * scale;
                float life = Random.Range(0.3f, 0.6f);
                Emit(n % 3 == 0 ? _i._sparks : _i._streaks, from, (center - from) / life, Random.Range(0.02f, 0.045f) * scale, life, Pick());
            }
            Emit(_i._flares, center, Vector3.zero, 0.6f * scale, 0.6f, new Color(Seam.r, Seam.g, Seam.b, 0.6f));
            Emit(_i._flares, center, Vector3.zero, 0.3f * scale, 0.6f, new Color(Crack.r, Crack.g, Crack.b, 0.5f));
            var ground = FloorY.HasValue ? new Vector3(center.x, FloorY.Value + 0.01f, center.z) : center - Vector3.up * 0.95f * scale;
            Emit(_i._rings, ground, Vector3.zero, 0.55f * scale, 0.6f, new Color(Seam.r, Seam.g, Seam.b, 0.35f));
            Sfx.PlayAt("charge", center, 0.45f, 0.05f);
        }

        /// <summary>The tear: one camera hit, floor shockwave, sparks, chips, smoke. scale 1 = 1.3 m world rift.</summary>
        public static void Tear(Vector3 center, Vector3 facing, Vector3 floor, float scale = 1f, bool raid = false)
        {
            if (_i == null) return;
            CameraFeel.Impact(raid ? 1f : 0.72f);
            Emit(_i._flares, center - facing.normalized * 0.25f * scale, Vector3.zero, 1.2f * scale, 0.18f, Crack);
            // Shockwave: thin ring 0.08 → 0.8 m over 0.36 s (+ delayed echo for raids).
            Emit(_i._rings, floor + Vector3.up * 0.008f, Vector3.zero, 0.16f * scale, 0.36f, new Color(Seam.r, Seam.g, Seam.b, 0.65f));
            if (raid) _i.StartCoroutine(Echo(floor, scale));
            Sfx.PlayAt("crunch", center, raid ? 0.75f : 0.55f, 0.06f);
            Spawn(_i.impactGlow, center, 1.0f * scale); // hits hard but leaves the opening visible (fx-sheet)
            Spawn(_i.groundHit, floor + Vector3.up * 0.01f, 1.2f * scale);
            if (raid)
            {
                TameBurst(Spawn(_i.firework, center + Vector3.up * 0.9f * scale, 1.0f * scale));
                var cam = Camera.main;
                Spawn(_i.comicWow, center + Vector3.up * 0.75f * scale, 0.55f * scale, cam != null ? cam.transform.position - center : (Vector3?)null);
            }
            _i.StartCoroutine(Clatter(floor));
            int sparks = raid ? 72 : 48, chips = raid ? 24 : 16, smoke = raid ? 8 : 6;
            var side = Vector3.Cross(Vector3.up, facing).normalized;
            for (int n = 0; n < sparks; n++)
            {
                // Mostly out of the opening (toward the viewer), fanned sideways and up.
                // Streaks fan sideways/up: one flying straight at the lens stretches into a full-screen line.
                var ps = n % 3 == 0 ? _i._streaks : _i._sparks;
                var dir = (-facing * (ps == _i._streaks ? Random.Range(0.1f, 0.4f) : Random.Range(0.4f, 1f)) + side * Random.Range(-1f, 1f) + Vector3.up * Random.Range(-0.1f, 0.9f)).normalized;
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
            // PlaySmoke play-60: three in a row filled the frame; the stock grey-white cloud read as dirty smoke: rift lavender.
            TameBurst(Spawn(_i.magicPoof, pos + Vector3.up * 0.1f, first ? 0.45f : 0.32f, null, new Color(0.8f, 0.62f, 1f, 0.75f)), 0.6f, 0.5f); // its rays reached the frame edges at 30 fps
            for (int n = 0; n < 12; n++)
                Emit(_i._sparks, pos + Vector3.up * 0.06f, (outward * 0.6f + Random.insideUnitSphere * 0.6f + Vector3.up * 0.3f), Random.Range(0.012f, 0.025f), Random.Range(0.25f, 0.45f), Pick());
            for (int n = 0; n < 2; n++)
                Emit(_i._chips, pos + Vector3.up * 0.1f, outward * 0.4f + Random.insideUnitSphere * 0.3f + Vector3.up * 0.4f, Random.Range(0.012f, 0.022f), 0.8f, Obsidian, Random.Range(0f, 360f));
        }

        /// <summary>Landing after a jump: dust ring + a few sparks; heavy landings add a small hit.</summary>
        public static void Land(Vector3 pos, bool heavy)
        {
            if (_i == null) return;
            if (heavy) { CameraFeel.Shake(0.35f); Spawn(_i.groundHit, pos + Vector3.up * 0.005f, 0.4f); }
            Emit(_i._rings, pos + Vector3.up * 0.006f, Vector3.zero, 0.05f, 0.22f, new Color(Crack.r, Crack.g, Crack.b, 0.5f));
            for (int n = 0; n < 8; n++)
            {
                var d = Random.insideUnitCircle.normalized;
                Emit(_i._smoke, pos + Vector3.up * 0.01f, new Vector3(d.x, 0.08f, d.y) * Random.Range(0.15f, 0.35f), Random.Range(0.025f, 0.06f), Random.Range(0.22f, 0.4f), new Color(Dust.r * 1.6f, Dust.g * 1.6f, Dust.b * 1.6f, 0.5f), Random.Range(0f, 360f));
            }
            for (int n = 0; n < 6; n++)
                Emit(_i._sparks, pos + Vector3.up * 0.02f, Random.insideUnitSphere * 0.5f + Vector3.up * 0.4f, 0.012f, 0.3f, Pick());
        }

        /// <summary>A viewer's emote lands: a distinct, readable burst per action above the hero (stream-visible).</summary>
        public static void Emote(Vector3 pos, string action)
        {
            if (_i == null) return;
            var head = pos + Vector3.up * 0.38f;
            float k = NearLens(head); // chat emotes are local: a hero near the phone must not fill the stream
            // Every emote gets a floor pop so even small ones read at 720p; then its own signature.
            var pop = EmoteColor(action);
            Emit(_i._rings, pos + Vector3.up * 0.008f, Vector3.zero, 0.12f, 0.45f, new Color(pop.r, pop.g, pop.b, 0.7f));
            switch (action)
            {
                case "cheer":
                    TameBurst(Spawn(_i.firework, head + Vector3.up * 0.15f, 0.4f * k));
                    break;
                case "dance":
                    Spawn(_i.fallingStars, head + Vector3.up * 0.2f, 0.5f * k);
                    for (int n = 0; n < 18; n++) Emit(_i._sparks, head, Random.insideUnitSphere * 0.5f + Vector3.up * 0.4f, 0.045f, 0.9f, Bright(pop));
                    break;
                case "jump":
                    for (int n = 0; n < 18; n++) Emit(_i._streaks, pos + Vector3.up * 0.02f, new Vector3(Random.Range(-0.4f, 0.4f), Random.Range(0.6f, 1.2f), Random.Range(-0.4f, 0.4f)), 0.04f, 0.55f, Bright(pop));
                    Spawn(_i.groundHit, pos + Vector3.up * 0.005f, 0.3f * k);
                    break;
                case "spell":
                    // 0.6 was a near-full-screen white burst + screen-wide streak per !spell (PlaySmoke play-washout).
                    TameBurst(Spawn(_i.impactGlow, head, 0.3f * k), 0.6f, 0.5f);
                    for (int n = 0; n < 16; n++)
                    {
                        float a = n * Mathf.PI / 8f;
                        var o = new Vector3(Mathf.Cos(a), 0f, Mathf.Sin(a)) * 0.12f;
                        Emit(_i._sparks, pos + o + Vector3.up * 0.05f, Vector3.up * Random.Range(0.4f, 0.9f) + o * 2f, 0.04f, 0.8f, Bright(pop));
                    }
                    break;
                case "wave":
                case "greet":
                    TameBurst(Spawn(_i.hitLight, head, 0.3f * k), 0.6f, 0.5f); // Command() already flashes one: PlaySmoke play-wave was a big white halo
                    for (int n = 0; n < 8; n++) Emit(_i._sparks, head, Random.insideUnitSphere * 0.35f + Vector3.up * 0.3f, 0.035f, 0.7f, Bright(pop));
                    break;
                default:
                    for (int n = 0; n < 8; n++) Emit(_i._sparks, head, Random.insideUnitSphere * 0.35f + Vector3.up * 0.3f, 0.035f, 0.6f, Bright(pop));
                    break;
            }
        }

        /// <summary>1 at 1.5 m+ from the lens, shrinking linearly closer (min 0.25): local effects keep a bounded size on screen.</summary>
        static float NearLens(Vector3 p)
        {
            var cam = Camera.main;
            return cam == null ? 1f : Mathf.Clamp(Vector3.Distance(cam.transform.position, p) / 1.5f, 0.25f, 1f);
        }

        /// <summary>Chat command accepted (mint) or refused (red): local ring + a few sparks, never a screen effect.</summary>
        public static void Command(Vector3 pos, bool accepted)
        {
            if (_i == null) return;
            var c = accepted ? Hex(0x59F1C8) : Hex(0xFF6A83);
            if (accepted) TameBurst(Spawn(_i.hitLight, pos + Vector3.up * 0.15f, 0.35f * NearLens(pos)), 0.6f, 0.5f);
            Emit(_i._rings, pos + Vector3.up * 0.007f, Vector3.zero, 0.04f, 0.18f, new Color(c.r, c.g, c.b, 0.7f));
            for (int n = 0; n < 4; n++)
                Emit(_i._sparks, pos + Vector3.up * 0.12f, Random.insideUnitSphere * 0.35f + Vector3.up * 0.3f, 0.014f, 0.3f, c);
        }

        /// <summary>Emote sparks contrast with the violet rift: the emote colour, white-hot cores, a little cyan.</summary>
        static Color Bright(Color pop) { float v = Random.value; return v < 0.3f ? Color.white : v < 0.45f ? Energy : Color.Lerp(pop, Color.white, 0.25f); }

        static Texture2D _dot;

        /// <summary>64 px white dot: solid hot core, short soft edge (alpha carries the shape for additive blending).</summary>
        static Texture2D Dot()
        {
            if (_dot != null) return _dot;
            const int n = 64;
            _dot = new Texture2D(n, n, TextureFormat.RGBA32, true) { name = "Fx dot", wrapMode = TextureWrapMode.Clamp };
            var px = new Color32[n * n];
            for (int y = 0; y < n; y++)
                for (int x = 0; x < n; x++)
                {
                    float r = new Vector2(x - (n - 1) * 0.5f, y - (n - 1) * 0.5f).magnitude / (n * 0.5f);
                    float a = Mathf.Pow(Mathf.Clamp01(1.25f - r * 1.45f), 1.5f);
                    px[y * n + x] = new Color32(255, 255, 255, (byte)Mathf.RoundToInt(a * 255f));
                }
            _dot.SetPixels32(px);
            _dot.Apply(true, true);
            return _dot;
        }

        static Color EmoteColor(string action) => action == "wave" || action == "greet" ? Hex(0x59F1C8) : action == "cheer" ? Hex(0xFFD45C)
            : action == "dance" ? Hex(0xFF5CD6) : action == "jump" ? Energy : Seam;

        static Color Hex(int rgb) => new Color(((rgb >> 16) & 255) / 255f, ((rgb >> 8) & 255) / 255f, (rgb & 255) / 255f, 1f);
    }
}
