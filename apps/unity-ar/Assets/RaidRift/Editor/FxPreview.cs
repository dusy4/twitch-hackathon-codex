using System;
using System.Collections.Generic;
using System.IO;
using System.Reflection;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.SceneManagement;
using Object = UnityEngine.Object;
using Random = UnityEngine.Random;

namespace RaidRift.EditorTools
{
    /// <summary>
    /// GPU preview: Unity.exe -batchmode -projectPath . -executeMethod RaidRift.EditorTools.FxPreview.Render
    /// Use a graphics device (omit -nographics). Writes Builds/preview/fx-*.png; does not enter Play mode.
    /// The room, fully open window and front pose match RiftPreview, including its camera/rift coordinates.
    /// Echo/Clatter coroutines, hero animation and runtime shader clocks are not advanced in this preview.
    /// </summary>
    public static class FxPreview
    {
        const int Width = 720, Height = 1280;
        const float Dt = 1f / 30f;
        const BindingFlags Private = BindingFlags.Instance | BindingFlags.NonPublic;
        const BindingFlags StaticPrivate = BindingFlags.Static | BindingFlags.NonPublic;
        static readonly int[] Times = { 300, 650, 750, 900, 1200, 1600, 2200 };
        static readonly string[] Emotes = { "cheer", "dance", "jump", "spell", "wave" };

        public static void Render()
        {
            bool failed = false;
            Preview preview = null;
            var random = Random.state;
            float fixedDelta = Time.fixedDeltaTime;
            var riftCenter = Shader.GetGlobalVector("_RiftCenter");
            float riftRadius = Shader.GetGlobalFloat("_RiftRadius");
            float? floor = RiftFx.FloorY;
            object oldFx = null, oldFeel = null, oldSfx = null;
            FieldInfo fxInstance = null, feelInstance = null, sfxInstance = null;

            bool Stage(string name, Action action)
            {
                try { action(); return true; }
                catch (Exception e)
                {
                    failed = true;
                    Debug.LogError("[RaidRift] fx preview " + name + " failed: " +
                        (e is TargetInvocationException && e.InnerException != null ? e.InnerException : e));
                    return false;
                }
            }

            try
            {
                bool ready = Stage("setup", () =>
                {
                    if (Application.isPlaying) throw new InvalidOperationException("Run FxPreview in edit mode.");
                    if (SystemInfo.graphicsDeviceType == UnityEngine.Rendering.GraphicsDeviceType.Null)
                        throw new InvalidOperationException("GPU rendering needs batchmode without -nographics.");
                    fxInstance = Field(typeof(RiftFx), "_i", StaticPrivate);
                    feelInstance = Field(typeof(CameraFeel), "_instance", StaticPrivate);
                    sfxInstance = Field(typeof(Sfx), "_instance", StaticPrivate);
                    oldFx = fxInstance.GetValue(null);
                    oldFeel = feelInstance.GetValue(null);
                    oldSfx = sfxInstance.GetValue(null);
                    // Sfx.Play/PlayAt/Loop explicitly tolerate a null instance. No audio pool or prefs needed.
                    sfxInstance.SetValue(null, null);
                    Time.fixedDeltaTime = Dt;
                    Random.InitState(7043);
                    preview = new Preview();
                    preview.Build();
                });

                if (ready)
                {
                    for (int i = 0; i < Times.Length; i++)
                    {
                        int tile = i, ms = Times[i];
                        Stage("fx-" + ms + ".png", () =>
                        {
                            preview.ResetEffects();
                            preview.Event("charge", () => RiftFx.Charge(preview.Center, preview.Rift.Forward));
                            preview.Advance(ms / 1000f, true);
                            var frame = preview.Capture();
                            try
                            {
                                preview.Save(frame, "fx-" + ms + ".png");
                                preview.PutTile(frame, preview.Sheet, tile);
                            }
                            finally { Object.DestroyImmediate(frame); }
                        });
                    }
                    Stage("fx-sheet.png", () => preview.Save(preview.Sheet, "fx-sheet.png"));
                    for (int i = 0; i < Emotes.Length; i++)
                    {
                        int tile = i;
                        Stage("emote " + Emotes[i], () =>
                        {
                            preview.ResetEffects();
                            preview.Event(Emotes[tile], () => RiftFx.Emote(preview.HeroPosition, Emotes[tile]));
                            preview.Advance(0.3f, false);

                            var frame = preview.Capture();
                            try { preview.PutTile(frame, preview.EmoteSheet, tile); }
                            finally { Object.DestroyImmediate(frame); }
                        });
                    }
                    Stage("fx-emotes.png", () => preview.Save(preview.EmoteSheet, "fx-emotes.png"));
                    // Idle rift after 3 s: rune aura + embers + seam surges (what the stream shows most of the time).
                    Stage("fx-ambient.png", () =>
                    {
                        preview.ResetEffects();
                        RiftFx.SetAmbient(preview.Rift.transform);
                        preview.Advance(3f, false);
                        var frame = preview.Capture();
                        try { preview.Save(frame, "fx-ambient.png"); }
                        finally { Object.DestroyImmediate(frame); RiftFx.SetAmbient(null); }
                    });
                    // In-stream "!join" caption (StreamCaption): drawn by the AR camera, so it is in the broadcast.
                    Stage("fx-caption.png", () =>
                    {
                        preview.ResetEffects();
                        var caption = StreamCaption.Create(preview.camera);
                        caption.Tick(true, 0);
                        caption.GetComponent<CanvasGroup>().alpha = 1f;
                        caption.GetComponent<Canvas>().enabled = true;
                        var hearts = StreamHearts.Create(preview.camera); // concept-style hearts up the right edge
                        hearts.PreviewNow(6);
                        Canvas.ForceUpdateCanvases();
                        var frame = preview.Capture();
                        try { preview.Save(frame, "fx-caption.png"); }
                        finally { Object.DestroyImmediate(frame); Object.DestroyImmediate(caption.gameObject); Object.DestroyImmediate(hearts.gameObject); }
                    });
                    // Numbered "!rift go to N" spots near and far (SceneTracks.Marker + its billboard), as viewers see them.
                    Stage("fx-spots.png", () =>
                    {
                        preview.ResetEffects();
                        string tag = preview.camera.tag;
                        preview.camera.tag = "MainCamera";
                        var host = new GameObject("Spots host").AddComponent<SceneTracks>();
                        var marker = typeof(SceneTracks).GetMethod("Marker", BindingFlags.Instance | BindingFlags.NonPublic);
                        var spots = new List<GameObject>();
                        var at = new[] { new Vector3(-0.5f, 0f, 0.4f), new Vector3(0.45f, 0f, 0.6f), new Vector3(-0.9f, 0f, 2.6f), new Vector3(1.1f, 0f, 3.4f) };
                        for (int i = 0; i < at.Length; i++)
                            spots.Add((GameObject)marker.Invoke(host, new object[] { i + 1, at[i], i == 1 ? "chair" : null }));
                        foreach (var s in spots)
                            foreach (var mb in s.GetComponents<MonoBehaviour>())
                                mb.GetType().GetMethod("LateUpdate", BindingFlags.Instance | BindingFlags.NonPublic)?.Invoke(mb, null);
                        var frame = preview.Capture();
                        try { preview.Save(frame, "fx-spots.png"); }
                        finally
                        {
                            Object.DestroyImmediate(frame);
                            foreach (var s in spots) Object.DestroyImmediate(s);
                            Object.DestroyImmediate(host.gameObject);
                            preview.camera.tag = tag;
                        }
                    });
                    // Viewer name tags (WorldTags) over real Hero objects, one with a fresh command line.
                    Stage("fx-tags.png", () =>
                    {
                        preview.ResetEffects();
                        var heroes = new List<Hero>();
                        var spots = new[] { (new Vector3(-0.35f, 0f, 0.55f), "pixelknight", ""), (new Vector3(0.3f, 0f, 0.8f), "mothmage", "jump on 3"), (new Vector3(0.05f, 0f, 1.9f), "lunarfox_the_long_name", "") };
                        foreach (var (pos, name, msg) in spots)
                        {
                            var h = Hero.Create(name, HeroModels.For(name), 0, null);
                            h.transform.position = pos;
                            h.transform.rotation = Quaternion.LookRotation(Vector3.back);
                            typeof(Hero).GetProperty("Spawned").GetSetMethod(true).Invoke(h, new object[] { true });
                            h.DisplayName = name; h.Message = msg;
                            heroes.Add(h);
                        }
                        WorldTags.Update(preview.camera, heroes);
                        var frame = preview.Capture();
                        try { preview.Save(frame, "fx-tags.png"); }
                        finally
                        {
                            Object.DestroyImmediate(frame);
                            WorldTags.Clear();
                            foreach (var h in heroes) if (h != null) Object.DestroyImmediate(h.gameObject);
                        }
                    });
                    // Raid banner as the app places it (2.15 m over the rift): must stay inside the 9:16 frame.
                    Stage("fx-banner.png", () =>
                    {
                        preview.ResetEffects();
                        WorldTags.Banner(preview.Rift.transform.position + Vector3.up * 2.15f, preview.camera, "RAID", "Streamer · 42 viewers", 2.4f);
                        foreach (var mb in Object.FindObjectsByType<MonoBehaviour>(FindObjectsSortMode.None))
                            if (mb.GetType().Name == "BannerLife")
                                mb.GetType().GetMethod("LateUpdate", BindingFlags.Instance | BindingFlags.NonPublic)?.Invoke(mb, null);
                        var frame = preview.Capture();
                        try { preview.Save(frame, "fx-banner.png"); }
                        finally { Object.DestroyImmediate(frame); }
                    });
                }
            }
            catch (Exception e) { failed = true; Debug.LogError("[RaidRift] fx preview failed: " + e); }
            finally
            {
                Stage("cleanup", () => { if (preview != null) preview.Dispose(); });
                Stage("restore state", () =>
                {
                    if (fxInstance != null) fxInstance.SetValue(null, oldFx);
                    if (feelInstance != null) feelInstance.SetValue(null, oldFeel);
                    if (sfxInstance != null) sfxInstance.SetValue(null, oldSfx);
                    RiftFx.FloorY = floor;
                    Time.fixedDeltaTime = fixedDelta;
                    Random.state = random;
                    Shader.SetGlobalVector("_RiftCenter", riftCenter);
                    Shader.SetGlobalFloat("_RiftRadius", riftRadius);
                });
                if (Application.isBatchMode) EditorApplication.Exit(failed ? 2 : 0);
            }
        }

        static FieldInfo Field(Type type, string name, BindingFlags flags = Private)
        {
            return type.GetField(name, flags) ?? throw new MissingFieldException(type.FullName, name);
        }

        static void Invoke(object instance, string name, params object[] args)
        {
            var method = instance.GetType().GetMethod(name, Private);
            if (method == null) throw new MissingMethodException(instance.GetType().FullName, name);
            method.Invoke(instance, args);
        }

        sealed class Preview : IDisposable
        {
            public RiftWorld Rift;
            public Texture2D Sheet, EmoteSheet;
            public readonly Vector3 HeroPosition = new Vector3(-0.2f, 0f, 0.75f);
            public Vector3 Center => Rift.transform.position + Vector3.up * 0.95f;
            readonly List<Object> owned = new List<Object>();
            readonly HashSet<int> knownParticles = new HashSet<int>();
            readonly HashSet<GameObject> environment = new HashSet<GameObject>();
            Scene scene, previousScene;
            public Camera camera, riftCamera;
            CameraFeel feel;
            RiftFx fx;
            RenderTexture raw, result;
            string directory;
            bool feelAvailable;
            readonly Dictionary<string, FieldInfo> feelFields = new Dictionary<string, FieldInfo>();

            T Own<T>(T item) where T : Object { owned.Add(item); return item; }

            public void Build()
            {
                directory = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "Builds", "preview"));
                Directory.CreateDirectory(directory);
                previousScene = SceneManager.GetActiveScene();
                // A temporary additive scene preserves the user's open scenes. camera.scene confines Render().
                scene = Application.isBatchMode
                    ? EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single) // batch: nothing to preserve
                    : EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Additive);
                SceneManager.SetActiveScene(scene);
                var shader = Shader.Find("Unlit/Color");
                if (shader == null) throw new InvalidOperationException("Unlit/Color shader is missing.");
                var plain = Own(new Material(shader) { color = System.Environment.GetEnvironmentVariable("FX_DAYLIGHT") == "1" ? new Color(0.84f, 0.83f, 0.8f) : new Color(0.55f, 0.52f, 0.48f) });
                var bed = Own(new Material(shader) { color = new Color(0.78f, 0.8f, 0.85f) });
                var paint = AssetDatabase.LoadAssetAtPath<Material>("Assets/RaidRift/Resources/Materials/RiftPaint.mat");
                void Room(Vector3 position, Vector3 scale, Material material)
                {
                    var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
                    go.transform.position = position;
                    go.transform.localScale = scale;
                    go.GetComponent<Renderer>().sharedMaterials = paint == null
                        ? new[] { material } : new[] { material, paint };
                }
                Room(new Vector3(0, -0.05f, 0), new Vector3(8, 0.1f, 8), plain);
                Room(new Vector3(1.6f, 0.25f, 0.3f), new Vector3(1, 0.5f, 2), bed);
                Room(new Vector3(0, 1.3f, 2.6f), new Vector3(8, 2.6f, 0.1f), plain);

                camera = new GameObject("FX Preview Phone").AddComponent<Camera>();
                camera.tag = "MainCamera";
                camera.enabled = false;
                camera.scene = scene;
                camera.fieldOfView = 62f;
                camera.nearClipPlane = 0.03f;
                camera.farClipPlane = 30f;
                camera.aspect = (float)Width / Height;
                camera.clearFlags = CameraClearFlags.SolidColor;
                camera.backgroundColor = Color.gray;
                camera.cullingMask = ~(1 << RiftWorld.Layer);
                camera.transform.position = new Vector3(0, 1.25f, -1.6f);
                camera.transform.LookAt(new Vector3(0, 0.35f, 1.2f));

                Rift = RiftWorld.Create(new Vector3(0, 0, 1.2f), camera.transform.position, camera);
                foreach (var filter in Rift.GetComponentsInChildren<MeshFilter>(true))
                    if (filter.name == "Terrain" || filter.name.StartsWith("Island ", StringComparison.Ordinal)) Own(filter.sharedMesh);
                // RiftWorld's edit-mode Destroy calls are deferred: remove its primitive colliders now.
                foreach (var collider in Rift.GetComponentsInChildren<Collider>(true)) Object.DestroyImmediate(collider);
                Rift.transform.Find("Rift Window").localScale = new Vector3(RiftWorld.WindowWidth, RiftWorld.WindowHeight, 1f);
                Shader.SetGlobalVector("_RiftCenter", Rift.transform.position);
                Shader.SetGlobalFloat("_RiftRadius", 1.25f);
                riftCamera = camera.transform.Find("Rift Camera").GetComponent<Camera>();
                riftCamera.enabled = false;
                riftCamera.scene = scene;
                // Match RiftWorld's half-resolution phone render, independent of batchmode Screen dimensions.
                var view = riftCamera.targetTexture;
                view.Release();
                view.width = Width / 2;
                view.height = Height / 2;
                if (!view.Create()) throw new InvalidOperationException("Cannot create rift render target.");

                var hero = AssetDatabase.LoadAssetAtPath<GameObject>("Assets/RaidRift/Resources/Characters/Mage.glb");
                if (hero != null)
                {
                    var go = Object.Instantiate(hero);
                    go.transform.position = HeroPosition;
                    go.transform.rotation = Quaternion.LookRotation(Vector3.back);
                    go.transform.localScale = Vector3.one * (Hero.Height / 2.19f);
                }
                else Debug.LogWarning("[RaidRift] fx preview: Mage.glb missing; capturing VFX without the hero.");

                raw = Own(new RenderTexture(Width, Height, 24, RenderTextureFormat.ARGB32));
                result = Own(new RenderTexture(Width, Height, 0, RenderTextureFormat.ARGB32));
                if (!raw.Create() || !result.Create()) throw new InvalidOperationException("Cannot create phone render targets.");
                camera.targetTexture = raw;
                Sheet = Own(BlankSheet(Times.Length));
                EmoteSheet = Own(BlankSheet(Emotes.Length));

                // CameraFeel can run its real shader in edit mode. Disable automatic callbacks and drive them
                // explicitly: its Update and noise phase otherwise depend on frozen editor runtime clocks.
                var asset = Resources.Load<Material>("Materials/CameraFeel");
                var postShader = asset != null ? asset.shader : Shader.Find("RaidRift/CameraFeel");
                feelAvailable = postShader != null && postShader.isSupported;
                if (feelAvailable)
                {
                    feel = camera.gameObject.AddComponent<CameraFeel>();
                    feel.enabled = false;
                    foreach (string name in new[] { "_trauma", "_punch", "_flash", "_chroma", "_vignette", "_bloomPulse", "_seed", "_mat" })
                        feelFields.Add(name, Field(typeof(CameraFeel), name));
                    Invoke(feel, "OnEnable");
                    feelFields["_seed"].SetValue(feel, 37f);
                }
                else Debug.LogWarning("[RaidRift] fx preview: CameraFeel shader unavailable; skipping post effect.");
                foreach (var root in scene.GetRootGameObjects()) environment.Add(root);
            }

            public void ResetEffects()
            {
                clock = 0f;
                foreach (var root in scene.GetRootGameObjects())
                    if (!environment.Contains(root)) Object.DestroyImmediate(root);
                knownParticles.Clear();
                Random.InitState(7043);
                if (feelAvailable)
                    foreach (string name in new[] { "_trauma", "_punch", "_flash", "_chroma", "_vignette", "_bloomPulse" })
                        feelFields[name].SetValue(feel, 0f);
                fx = new GameObject("FX Preview Pool").AddComponent<RiftFx>();
                // AddComponent doesn't normally dispatch Awake in edit mode; do not build the pool twice.
                if (Field(typeof(RiftFx), "_sparks").GetValue(fx) == null) Invoke(fx, "Awake");
                foreach (var renderer in fx.GetComponentsInChildren<ParticleSystemRenderer>(true))
                    if (renderer.sharedMaterial != null && !EditorUtility.IsPersistent(renderer.sharedMaterial)) Own(renderer.sharedMaterial);
                Field(typeof(RiftFx), "_i", StaticPrivate).SetValue(null, fx);
                GameObject Cfxr(string p) => AssetDatabase.LoadAssetAtPath<GameObject>("Assets/JMO Assets/Cartoon FX Remaster/CFXR Prefabs/" + p + ".prefab");
                fx.impactGlow = Cfxr("Impacts/CFXR Impact Glowing HDR (Blue)");
                fx.groundHit = Cfxr("Impacts/CFXR2 Ground Hit");
                fx.magicPoof = Cfxr("Misc/CFXR Magic Poof");
                fx.hitLight = Cfxr("Light/CFXR3 Hit Light B (Air)");
                fx.comicWow = Cfxr("Texts/CFXR3 _WOW_");
                fx.firework = Cfxr("Explosions/CFXR4 Firework 1 Cyan-Purple (HDR)");
                fx.runeAura = Cfxr("Magic Misc/CFXR3 Magic Aura A (Runic)");
                fx.souls = Cfxr("Eerie/CFXR2 Souls Escape");
                fx.fallingStars = Cfxr("Magic Misc/CFXR4 Falling Stars");
                if (fx.impactGlow == null) Debug.LogWarning("[RaidRift] Cartoon FX Remaster not imported; RiftFx uses its own particles only");
                RiftFx.FloorY = 0f;
                // FX_DAYLIGHT=1: bright floor + a sunny light estimate (daylight particle/bloom paths).
                typeof(LightMatch).GetProperty("Brightness01").GetSetMethod(true)
                    .Invoke(null, new object[] { System.Environment.GetEnvironmentVariable("FX_DAYLIGHT") == "1" ? 1f : 0f });
                Invoke(fx, "Update"); // Align the collision plane; no ambient rift means no Time.deltaTime dependency.
                PrepareParticles(); // Seed pools before Charge manually emits particles.
                // The first Simulate on a never-simulated system restarts it, wiping Emit()s made before it
                // (Charge and emotes fire at t=0). Prime every pool once so later steps only advance.
                foreach (var ps in fx.GetComponentsInChildren<ParticleSystem>(true)) { ps.Simulate(0.001f, true, false, true); ps.Play(false); }
            }

            public void Event(string name, Action action)
            {
                var otherCameras = new List<Camera>();
                bool enabled = camera.enabled;
                try
                {
                    // Tear uses Camera.main to face the comic text. Make that lookup use this preview even
                    // when an existing editor scene contains another tagged camera, then restore every flag.
                    foreach (var candidate in Object.FindObjectsByType<Camera>(FindObjectsSortMode.None))
                        if (candidate != camera && candidate.enabled) { otherCameras.Add(candidate); candidate.enabled = false; }
                    camera.enabled = true;
                    action();
                }
                catch (Exception e) { throw new InvalidOperationException("VFX event " + name + " failed.", e); }
                finally
                {
                    camera.enabled = enabled;
                    foreach (var candidate in otherCameras) if (candidate != null) candidate.enabled = true;
                    if (fx != null) fx.StopAllCoroutines(); // Echo/Clatter are deliberately omitted.
                }
            }

            public void Advance(float target, bool timeline)
            {
                int wholeSteps = Mathf.FloorToInt(target / Dt + 0.0001f);
                for (int step = 1; step <= wholeSteps; step++)
                {
                    if (timeline && step <= 18) CameraFeel.Shake(0.15f + 0.45f * ((step - 1) * Dt / 0.6f));
                    Step(Dt);
                    if (timeline && step == 18)
                        Event("tear", () => RiftFx.Tear(Center, Rift.Forward, Rift.transform.position, 1f, true));
                    if (timeline && step == 42)
                        Event("arrival", () => RiftFx.Arrival(HeroPosition, -Rift.Forward, true));
                }
                // 650/750 ms are halfway between 30 Hz ticks. Each shot is replayed independently, so a
                // final half-speed tick samples the requested instant without changing later fixed steps/events.
                float remainder = target - wholeSteps * Dt;
                if (remainder > 0.00001f) Step(remainder);
            }

            List<ParticleSystem> PrepareParticles()
            {
                var systems = new List<ParticleSystem>();
                foreach (var root in scene.GetRootGameObjects()) systems.AddRange(root.GetComponentsInChildren<ParticleSystem>(true));
                foreach (var ps in systems)
                {
                    if (!knownParticles.Add(ps.GetInstanceID())) continue;
                    var main = ps.main;
                    main.cullingMode = ParticleSystemCullingMode.AlwaysSimulate;
                    main.stopAction = ParticleSystemStopAction.None;
                    // Changing the seed resets a system: never on RiftFx's pools, which already hold manual Emit()s.
                    if (!ps.transform.IsChildOf(fx.transform))
                    {
                        ps.useAutoRandomSeed = false;
                        ps.randomSeed = (uint)(7043 + knownParticles.Count);
                    }
                    // CFXR playOnAwake is not guaranteed to run in edit mode. Don't restart manual pool emits.
                    if (!ps.transform.IsChildOf(fx.transform) && main.playOnAwake)
                    {
                        ps.Simulate(0f, false, true, true);
                        ps.Play(false);
                    }
                }
                return systems;
            }

            void Step(float dt)
            {
                Invoke(fx, "Update");
                var systems = PrepareParticles();
                // Keep Simulate's step fixed at 1/30 even for an off-grid capture. A temporary speed multiplier
                // samples the half-tick, and the next shot is replayed from scratch. Preserve prefab speeds.
                var speeds = new float[systems.Count];
                for (int i = 0; i < systems.Count; i++)
                {
                    var main = systems[i].main;
                    speeds[i] = main.simulationSpeed;
                    main.simulationSpeed = speeds[i] * (dt / Dt);
                }
                try
                {
                    foreach (var ps in systems)
                    {
                        if (!ps.gameObject.activeInHierarchy) continue;
                        // Simulate(true) includes descendants. Only simulate hierarchy roots to avoid advancing
                        // nested CFXR systems twice; systems on intermediate non-particle objects are included.
                        bool child = false;
                        for (var parent = ps.transform.parent; parent != null; parent = parent.parent)
                            if (parent.GetComponent<ParticleSystem>() != null) { child = true; break; }
                        if (!child) ps.Simulate(Dt, true, false, true);
                    }
                }
                finally
                {
                    for (int i = 0; i < systems.Count; i++)
                        if (systems[i] != null) { var main = systems[i].main; main.simulationSpeed = speeds[i]; }
                }
                if (!feelAvailable) return;
                // Same decay equations as CameraFeel.Update, using simulation time instead of unscaledDeltaTime.
                Decay("_trauma", dt, feel.traumaDecay);
                Decay("_flash", dt, 1.8f);
                Decay("_bloomPulse", dt, 2f);
                Decay("_vignette", dt, 0.9f);
                feelFields["_punch"].SetValue(feel, Value("_punch") * Mathf.Exp(-12f * dt));
                feelFields["_chroma"].SetValue(feel, Value("_chroma") * Mathf.Exp(-6f * dt));
                clock += dt;
            }

            float clock;
            float Value(string name) => (float)feelFields[name].GetValue(feel);
            void Decay(string name, float dt, float rate) => feelFields[name].SetValue(feel, Mathf.MoveTowards(Value(name), 0f, rate * dt));

            public Texture2D Capture()
            {
                var active = RenderTexture.active;
                Texture2D frame = null;
                try
                {
                    riftCamera.aspect = camera.aspect;
                    riftCamera.fieldOfView = camera.fieldOfView;
                    riftCamera.projectionMatrix = camera.projectionMatrix;
                    riftCamera.Render();
                    camera.Render();
                    var source = raw;
                    if (feelAvailable)
                    {
                        // Run the existing bloom/composite implementation, then correct only its runtime noise
                        // clock and repeat the final pass. No camera transform or AR registration is disturbed.
                        Invoke(feel, "OnRenderImage", raw, result);
                        var material = (Material)feelFields["_mat"].GetValue(feel);
                        if (material != null)
                        {
                            float m = CameraFeel.ReducedMotion ? 0f : Mathf.Clamp01(feel.intensity);
                            float shake = Value("_trauma") * Value("_trauma") * m;
                            float t = clock * feel.frequency, seed = Value("_seed");
                            float Noise(float s) => Mathf.PerlinNoise(s, t) * 2f - 1f;
                            var offset = new Vector2(Noise(seed), Noise(seed + 17.3f)) * (feel.maxOffset * shake);
                            float angle = Noise(seed + 41.7f) * feel.maxAngle * shake * Mathf.Deg2Rad;
                            float zoom = 1f + Value("_punch") * m + feel.maxOffset * 2.2f * shake + Mathf.Abs(angle) * 0.6f;
                            material.SetVector("_Shake", new Vector4(offset.x, offset.y, angle, zoom));
                            Graphics.Blit(raw, result, material, 3);
                        }
                        source = result;
                    }
                    RenderTexture.active = source;
                    frame = new Texture2D(Width, Height, TextureFormat.RGB24, false);
                    frame.ReadPixels(new Rect(0, 0, Width, Height), 0, 0);
                    frame.Apply();
                    return frame;
                }
                catch { if (frame != null) Object.DestroyImmediate(frame); throw; }
                finally { RenderTexture.active = active; }
            }

            static Texture2D BlankSheet(int tiles)
            {
                var sheet = new Texture2D(Width / 2 * tiles, Height / 2, TextureFormat.RGB24, false);
                sheet.SetPixels32(new Color32[sheet.width * sheet.height]);
                sheet.Apply();
                return sheet;
            }

            public void PutTile(Texture2D frame, Texture2D sheet, int index)
            {
                // Average each 2x2 block, keeping the same 720p post effect footprint in 360x640 tiles.
                var pixels = frame.GetPixels32();
                var tile = new Color32[Width / 2 * (Height / 2)];
                for (int y = 0; y < Height / 2; y++)
                    for (int x = 0; x < Width / 2; x++)
                    {
                        int p = y * 2 * Width + x * 2;
                        var a = pixels[p]; var b = pixels[p + 1]; var c = pixels[p + Width]; var d = pixels[p + Width + 1];
                        tile[y * (Width / 2) + x] = new Color32((byte)((a.r + b.r + c.r + d.r) / 4),
                            (byte)((a.g + b.g + c.g + d.g) / 4), (byte)((a.b + b.b + c.b + d.b) / 4), 255);
                    }
                sheet.SetPixels32(index * (Width / 2), 0, Width / 2, Height / 2, tile);
                sheet.Apply();
            }

            public void Save(Texture2D image, string name)
            {
                File.WriteAllBytes(Path.Combine(directory, name), image.EncodeToPNG());
                Debug.Log("[RaidRift] fx preview " + name);
            }

            public void Dispose()
            {
                if (camera != null) camera.targetTexture = null;
                if (feel != null) Invoke(feel, "OnDisable");
                // RiftWorld.OnDestroy uses runtime Destroy; detach its owned GPU objects for edit-mode cleanup.
                if (Rift != null)
                {
                    var view = (RenderTexture)Field(typeof(RiftWorld), "_view").GetValue(Rift);
                    var window = (Material)Field(typeof(RiftWorld), "_windowMat").GetValue(Rift);
                    Field(typeof(RiftWorld), "_riftCamera").SetValue(Rift, null);
                    Field(typeof(RiftWorld), "_view").SetValue(Rift, null);
                    Field(typeof(RiftWorld), "_windowMat").SetValue(Rift, null);
                    if (view != null) { view.Release(); Object.DestroyImmediate(view); }
                    if (window != null) Object.DestroyImmediate(window);
                }
                if (!Application.isBatchMode && scene.IsValid() && scene.isLoaded) EditorSceneManager.CloseScene(scene, true);
                if (previousScene.IsValid() && previousScene.isLoaded) SceneManager.SetActiveScene(previousScene);
                foreach (var item in owned)
                {
                    if (item == null) continue;
                    if (item is RenderTexture rt) rt.Release();
                    Object.DestroyImmediate(item);
                }
            }
        }
    }
}
