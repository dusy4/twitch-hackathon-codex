using System.Collections.Generic;
using System.Reflection;
using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace RaidRift.EditorTools
{
    /// <summary>Play Mode smoke test of the real scene on the PC (no AR tracking in the editor): starts the app,
    /// presses every HUD/settings button, toggles live-only paths (caption, LiveTick) and offline chat, and fails on
    /// any exception or error log. Never pairs, goes live or opens WebRTC (no server/Twitch side effects).
    /// Unity.exe -batchmode -projectPath . -executeMethod RaidRift.EditorTools.PlaySmoke.Run (without -nographics)</summary>
    [InitializeOnLoad]
    public static class PlaySmoke
    {
        const string Flag = "rr.playsmoke";
        static readonly List<string> Problems = new List<string>();
        static int _frame;

        static readonly string[] Buttons =
        {
            "raid", "follow", "follow", "trail", "trail", "scan", "scan", "scan", "chat", "chat", "setup", "setup",
            "sound", "sound", "motion", "motion", "caption", "caption", "quality", "quality", "quality",
            "selfie", "reset-room", "end-live", "mic", "raid",
        };

        static PlaySmoke()
        {
            if (!SessionState.GetBool(Flag, false)) return;
            Application.logMessageReceived += OnLog;
            EditorApplication.update += Tick;
        }

        public static void Run()
        {
            SessionState.SetBool(Flag, true);
            EditorSceneManager.OpenScene("Assets/RaidRift/Scenes/Main.unity");
            Application.logMessageReceived += OnLog;
            EditorApplication.update += Tick;
            EditorApplication.isPlaying = true;
        }

        static void OnLog(string message, string stack, LogType type)
        {
            if (type != LogType.Exception && type != LogType.Error && type != LogType.Assert) return;
            // Editor-only noise unrelated to the app (licensing, XR without a loader, GPU queries).
            if (message.Contains("Licensing") || message.Contains("d3d12") || message.Contains("XR") || message.Contains("Niantic") || message.Contains("NSDK")) return;
            if (stack != null && stack.Contains("NianticSpatial")) return; // NSDK without an XR loader in the editor
            Problems.Add($"{type}: {message}\n{stack}");
        }

        static void Tick()
        {
            if (!EditorApplication.isPlaying) return;
            _frame++;
            var app = Object.FindFirstObjectByType<RaidRiftApp>();
            if (app == null) { if (_frame > 300) Finish("RaidRiftApp not found in the scene"); return; }
            var button = typeof(RaidRiftApp).GetMethod("Button", BindingFlags.Instance | BindingFlags.NonPublic);
            int step = (_frame - 60) / 8; // one press every 8 frames after warm-up
            if (_frame >= 60 && (_frame - 60) % 8 == 0 && step < Buttons.Length)
            {
                Debug.Log("[RaidRift] playsmoke press " + Buttons[step]);
                try { button.Invoke(app, new object[] { Buttons[step] }); }
                catch (TargetInvocationException e) { Problems.Add("press " + Buttons[step] + ": " + e.InnerException); }
            }
            int after = 60 + Buttons.Length * 8;
            if (_frame == after)
            {
                // Live-only paths without a broadcast: caption + LiveTick + live hint, then back.
                typeof(RaidRiftApp).GetField("_liveMode", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(app, true);
                var send = typeof(RaidRiftApp).GetMethod("SendChat", BindingFlags.Instance | BindingFlags.NonPublic);
                try { send.Invoke(app, new object[] { "dance" }); }
                catch (TargetInvocationException e) { Problems.Add("chat: " + e.InnerException); }
            }
            // End while live needs two taps: first only arms it, second ends the broadcast.
            if (_frame == after + 30 || _frame == after + 40)
            {
                button.Invoke(app, new object[] { "end-live" });
                bool liveNow = (bool)typeof(RaidRiftApp).GetField("_liveMode", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(app);
                if (_frame == after + 30 && !liveNow) Problems.Add("end-live: a single tap ended the stream");
                if (_frame == after + 40 && liveNow) Problems.Add("end-live: a second tap did not end the stream");
            }
            if (_frame == after + 90) typeof(RaidRiftApp).GetField("_liveMode", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(app, false);
            if (_frame == after + 150) StartGameplay(app);
            if (_frame > after + 150) TickGameplay(app);
        }

        // ---------------- phase 3: street-stream style server world (no rift, viewers !join / wave / leave) ----------------
        // Injects ServerConnection.World directly; SceneTracks is disabled and no chat is sent, so nothing is posted
        // to the real server.
        static int _serverStep;
        static float _serverAt;
        static HeroState _h1, _h2;
        static Vector3 _steerFrom;
        static float _soakNext;
        static int _soakCount;
        static (int go, int mat)? _soakBase;

        static void ServerPhase(RaidRiftApp app, float t)
        {
            var button = typeof(RaidRiftApp).GetMethod("Button", BindingFlags.Instance | BindingFlags.NonPublic);
            var flags = BindingFlags.Instance | BindingFlags.NonPublic;
            var heroes = (System.Collections.IDictionary)typeof(RaidRiftApp).GetField("_heroes", flags).GetValue(app);
            bool landed = (bool)typeof(RaidRiftApp).GetField("_landed", flags).GetValue(app);
            switch (_serverStep)
            {
                case 0:
                    Debug.Log("[RaidRift] playsmoke server phase: offline + reset room (no rift)");
                    button.Invoke(app, new object[] { "offline" });
                    button.Invoke(app, new object[] { "reset-room" }); // landed: first tap only arms
                    if (!(bool)typeof(RaidRiftApp).GetField("_landed", flags).GetValue(app)) Problems.Add("reset-room: one tap reset a landed room");
                    button.Invoke(app, new object[] { "reset-room" });
                    app.room.TestBake(new List<UnityEngine.AI.NavMeshBuildSource> { new UnityEngine.AI.NavMeshBuildSource { shape = UnityEngine.AI.NavMeshBuildSourceShape.Box, size = new Vector3(8f, 0.1f, 8f), transform = Matrix4x4.Translate(new Vector3(0f, -0.05f, 1f)), area = 0 } }, new Bounds(new Vector3(0f, 0.5f, 1f), new Vector3(10f, 3f, 10f)), 0f);
                    app.arCamera.transform.SetPositionAndRotation(new Vector3(0f, 1.3f, -1f), Quaternion.Euler(35f, 0f, 0f));
                    if (app.sceneTracks != null) app.sceneTracks.enabled = false;
                    _serverStep = 1; _serverAt = t;
                    break;
                case 1:
                    if (!landed) { if (t - _serverAt > 8f) { Problems.Add("server phase: never re-landed"); Finish(null); } break; }
                    typeof(RaidRiftApp).GetField("_live", flags).SetValue(app, true);
                    _h1 = new HeroState { Id = "u-1", Name = "pixelknight", X = 0.35f, Y = 0.55f, Serial = 1, Message = "!join" };
                    _h2 = new HeroState { Id = "u-2", Name = "mothmage", X = 0.65f, Y = 0.5f, Serial = 1, Message = "!join" };
                    var world = new WorldState { Mode = "LIVE TWITCH", LiveChannel = "dusyaaaaaaaa", LiveConnected = true };
                    world.Heroes.Add(_h1); world.Heroes.Add(_h2);
                    typeof(ServerConnection).GetProperty("World").GetSetMethod(true).Invoke(app.server, new object[] { world });
                    typeof(ServerConnection).GetProperty("Connected").GetSetMethod(true).Invoke(app.server, new object[] { true });
                    Debug.Log("[RaidRift] playsmoke server phase: two viewers !join (no rift open)");
                    _serverStep = 2; _serverAt = t;
                    break;
                case 2:
                    if (t - _serverAt < 4f) break;
                    Snapshot(app.arCamera, "play-join");
                    if (heroes.Count != 2) Problems.Add("server phase: expected 2 heroes after !join, got " + heroes.Count);
                    app.server.World.Heroes.Remove(_h2);                       // mothmage leaves
                    _h1.Animation = "wave"; _h1.Serial = 2; _h1.Message = "!wave"; // pixelknight waves
                    Debug.Log("[RaidRift] playsmoke server phase: one waves, one leaves");
                    _serverStep = 3; _serverAt = t;
                    break;
                case 3:
                    if (t - _serverAt < 0.25f) break;
                    Snapshot(app.arCamera, "play-wave");
                    _serverStep = 4; _serverAt = t;
                    break;
                case 4:
                    if (t - _serverAt < 2.5f) break;
                    if (heroes.Count != 1) Problems.Add("server phase: expected 1 hero after a viewer left, got " + heroes.Count);
                    // Viewer holds D (Extension d-pad / !d): steer right in the streamer's view.
                    _steerFrom = ((Component)heroes["u-1"]).transform.position;
                    _h1.SteerX = 1f; _h1.SteerY = 0f; _h1.SteerSeq = 1; _h1.SteerUntil = 1;
                    _serverStep = 5; _serverAt = t;
                    break;
                case 5:
                    _h1.SteerUntil = 1 + (long)((t - _serverAt) * 10); // the server keeps extending while held
                    if (t - _serverAt < 2f) break;
                    var steered = ((Component)heroes["u-1"]).transform.position - _steerFrom;
                    Debug.Log("[RaidRift] playsmoke server phase: steering right moved the hero " + steered.x.ToString("0.00") + " m on x");
                    if (steered.x < 0.3f) Problems.Add("server phase: holding D did not move the hero right (" + steered + ")");
                    _h1.SteerX = 0f;
                    // Soak: a busy chat for 90 s (two viewers, a command every 0.4 s) must not leak objects/materials.
                    _h2 = new HeroState { Id = "u-2", Name = "mothmage", X = 0.65f, Y = 0.5f, Serial = 1, Message = "!join" };
                    app.server.World.Heroes.Add(_h2);
                    _serverStep = 6; _serverAt = t; _soakNext = t + 3f; _soakBase = null;
                    break;
                case 6:
                    if (_soakBase == null && t - _serverAt > 3f)
                    {
                        _soakBase = (Object.FindObjectsByType<GameObject>(FindObjectsInactive.Include, FindObjectsSortMode.None).Length, Resources.FindObjectsOfTypeAll<Material>().Length);
                        Debug.Log("[RaidRift] playsmoke soak start: objects " + _soakBase.Value.go + ", materials " + _soakBase.Value.mat);
                    }
                    if (_soakBase != null && t >= _soakNext)
                    {
                        _soakNext = t + 0.4f;
                        var h = _soakCount % 2 == 0 ? _h1 : _h2;
                        var acts = new[] { "wave", "jump", "dance", "cheer", "spell", "sit" };
                        h.Animation = acts[_soakCount % acts.Length]; h.Serial = 10 + _soakCount; h.Message = "!" + h.Animation;
                        _soakCount++;
                    }
                    if (t - _serverAt < 93f) break;
                    if (t - _serverAt < 100f) break; // let the last effects (5 s backstop) clear
                    var go = Object.FindObjectsByType<GameObject>(FindObjectsInactive.Include, FindObjectsSortMode.None).Length;
                    var mats = Resources.FindObjectsOfTypeAll<Material>().Length;
                    Debug.Log($"[RaidRift] playsmoke soak end after {_soakCount} commands: objects {_soakBase.Value.go} -> {go}, materials {_soakBase.Value.mat} -> {mats}");
                    if (go - _soakBase.Value.go > 150) Problems.Add($"soak: GameObjects grew {_soakBase.Value.go} -> {go}");
                    if (mats - _soakBase.Value.mat > 40) Problems.Add($"soak: materials grew {_soakBase.Value.mat} -> {mats}");
                    // A real Twitch raid arrives mid-stream (not a test): rift tear, fireworks, WOW, RAID banner.
                    app.server.World.Raid = new RaidState { Id = "irc:1", From = "BigStreamer", Count = 42, Started = 1, Test = false };
                    app.server.World.Heroes.Add(new HeroState { Id = "u-3", Name = "raider_one", X = 0.5f, Y = 0.4f, Serial = 1, Message = "!join" });
                    _serverStep = 7; _serverAt = t;
                    break;
                case 7:
                    if (t - _serverAt >= 0.9f && !_shots.Contains(-1f)) { _shots.Add(-1f); Snapshot(app.arCamera, "play-realraid"); }
                    if (t - _serverAt < 6f) break;
                    var rift = typeof(RaidRiftApp).GetField("_rift", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(app) as Component;
                    if (rift == null) Problems.Add("real raid: no rift opened");
                    if (heroes.Count != 3) Problems.Add("real raid: expected 3 heroes, got " + heroes.Count);
                    Snapshot(app.arCamera, "play-realraid-after");
                    Debug.Log("[RaidRift] playsmoke server phase: done, heroes " + heroes.Count);
                    typeof(ServerConnection).GetProperty("World").GetSetMethod(true).Invoke(app.server, new object[] { null });
                    typeof(ServerConnection).GetProperty("Connected").GetSetMethod(true).Invoke(app.server, new object[] { false });
                    Debug.Log("[RaidRift] playsmoke gameplay: max heroes " + _maxHeroes);
                    Finish(null);
                    break;
            }
        }

        // ---------------- phase 2: offline test raid on a synthetic floor ----------------
        static float _gameplayStart, _raidAt;
        static bool _raided, _followed, _framed, _walkChecked;
        static int _walkSamples, _walkInFrame;
        static float _walkLogAt;
        static bool _collapseShot;
        static float _collapseAt;
        static Vector3? _riftStart;
        static int _maxHeroes;
        static readonly HashSet<float> _shots = new HashSet<float>();

        /// <summary>What the stream would get: the AR camera (rift, heroes, tags, VFX, CameraFeel) at 720x1280.</summary>
        static void Snapshot(Camera cam, string name)
        {
            try
            {
                var rt = RenderTexture.GetTemporary(720, 1280, 24);
                var old = cam.targetTexture;
                cam.targetTexture = rt;
                cam.Render();
                cam.targetTexture = old;
                var prev = RenderTexture.active;
                RenderTexture.active = rt;
                var tex = new Texture2D(720, 1280, TextureFormat.RGB24, false);
                tex.ReadPixels(new Rect(0, 0, 720, 1280), 0, 0);
                tex.Apply();
                RenderTexture.active = prev;
                RenderTexture.ReleaseTemporary(rt);
                var dir = System.IO.Path.GetFullPath(System.IO.Path.Combine(Application.dataPath, "..", "Builds", "preview"));
                System.IO.File.WriteAllBytes(System.IO.Path.Combine(dir, name + ".png"), tex.EncodeToPNG());
                Object.DestroyImmediate(tex);
                Debug.Log("[RaidRift] playsmoke snapshot " + name);
            }
            catch (System.Exception e) { Debug.LogWarning("[RaidRift] playsmoke snapshot failed: " + e.Message); }
        }

        static void ForceTracking() =>
            typeof(UnityEngine.XR.ARFoundation.ARSession).GetProperty("state", BindingFlags.Static | BindingFlags.Public)
                .GetSetMethod(true).Invoke(null, new object[] { UnityEngine.XR.ARFoundation.ARSessionState.SessionTracking });

        static void StartGameplay(RaidRiftApp app)
        {
            if (app.session != null) app.session.enabled = false; // nothing else writes ARSession.state now
            ForceTracking();
            var sources = new List<UnityEngine.AI.NavMeshBuildSource>
            {
                new UnityEngine.AI.NavMeshBuildSource { shape = UnityEngine.AI.NavMeshBuildSourceShape.Box, size = new Vector3(8f, 0.1f, 26f), transform = Matrix4x4.Translate(new Vector3(0f, -0.05f, 9f)), area = 0 }, // a long "street"
                new UnityEngine.AI.NavMeshBuildSource { shape = UnityEngine.AI.NavMeshBuildSourceShape.Box, size = new Vector3(1f, 0.45f, 1.8f), transform = Matrix4x4.Translate(new Vector3(1.6f, 0.225f, 1.5f)), area = 0 },
            };
            app.room.TestBake(sources, new Bounds(new Vector3(0f, 0.5f, 9f), new Vector3(10f, 3f, 28f)), 0f);
            app.room.enabled = false; // no live rebake from the (empty) AR mesh
            var cam = app.arCamera.transform;
            cam.SetPositionAndRotation(new Vector3(0f, 1.3f, -1f), Quaternion.Euler(40f, 0f, 0f)); // looking at floor ~1.5 m ahead
            // Live-mode logic on (caption, live hint, detector cadence, thermal cap) without a real broadcast.
            typeof(RaidRiftApp).GetField("_liveMode", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(app, true);
            _gameplayStart = Time.realtimeSinceStartup;
            Debug.Log("[RaidRift] playsmoke gameplay: floor baked, nav " + app.room.HasNavMesh);
        }

        static void TickGameplay(RaidRiftApp app)
        {
            ForceTracking();
            float t = Time.realtimeSinceStartup - _gameplayStart;
            bool landed = (bool)typeof(RaidRiftApp).GetField("_landed", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(app);
            var heroes = (System.Collections.IDictionary)typeof(RaidRiftApp).GetField("_heroes", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(app);
            _maxHeroes = Mathf.Max(_maxHeroes, heroes.Count);
            var button = typeof(RaidRiftApp).GetMethod("Button", BindingFlags.Instance | BindingFlags.NonPublic);
            if (!_raided && landed)
            {
                _raided = true; _raidAt = t;
                Debug.Log("[RaidRift] playsmoke gameplay: landed at " + t.ToString("0.0") + " s, test raid");
                button.Invoke(app, new object[] { "raid" });
            }
            if (_raided && !_followed && t - _raidAt > 12f)
            {
                _followed = true;
                Debug.Log("[RaidRift] playsmoke gameplay: heroes " + heroes.Count + ", follow + chat");
                typeof(RaidRiftApp).GetField("_follow", BindingFlags.Instance | BindingFlags.NonPublic).SetValue(app, true); // explicit: earlier presses (Trail) already toggled it
                typeof(RaidRiftApp).GetMethod("SendChat", BindingFlags.Instance | BindingFlags.NonPublic).Invoke(app, new object[] { "dance" });
                app.arCamera.transform.position += new Vector3(0.6f, 0f, 0.4f); // the streamer moves
            }
            // Like a streamer: once the rift exists, frame it (camera looks at the portal, not at the floor).
            if (_raided && t - _raidAt > 0.2f && !_framed)
            {
                var rift = typeof(RaidRiftApp).GetField("_rift", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(app) as Component;
                if (rift != null) { app.arCamera.transform.LookAt(rift.transform.position + Vector3.up * 0.55f); _framed = true; }
            }
            foreach (var at in new[] { 0.9f, 2.5f, 6f, 11f, 16f })
                if (_raided && t - _raidAt >= at && !_shots.Contains(at)) { _shots.Add(at); Snapshot(app.arCamera, "play-" + Mathf.RoundToInt(at * 10)); }
            // Street walk: 10 m forward over 6 s with Follow on -> the rift should relocate (>8 m) and heroes keep up.
            if (_followed && t - _raidAt > 13f && t - _raidAt < 19f)
            {
                var cam = app.arCamera.transform;
                cam.SetPositionAndRotation(new Vector3(0f, 1.3f, -1f + (t - _raidAt - 13f) / 6f * 10f), Quaternion.Euler(30f, 0f, 0f));
                if (_riftStart == null)
                {
                    var r0 = typeof(RaidRiftApp).GetField("_rift", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(app) as Component;
                    _riftStart = r0 != null ? r0.transform.position : Vector3.zero;
                }
            }
            // The relocating rift collapses (behind the streamer): it must finish and destroy itself.
            if (_followed && !_collapseShot)
                foreach (var rw in Object.FindObjectsByType<RiftWorld>(FindObjectsSortMode.None))
                    if (rw.Closing) { _collapseShot = true; _collapseAt = t; break; }
            if (_collapseShot && _collapseAt > 0f && t - _collapseAt > 1.5f)
            {
                _collapseAt = -1f;
                int closing = 0;
                foreach (var rw in Object.FindObjectsByType<RiftWorld>(FindObjectsSortMode.None)) if (rw.Closing) closing++;
                Debug.Log("[RaidRift] playsmoke gameplay: rift collapse finished, closing rifts left " + closing);
                if (closing > 0) Problems.Add("gameplay: a collapsing rift never destroyed itself");
            }
            // While walking and after: how often each following hero is actually on the 9:16 frame (stream view).
            if (_followed && t - _raidAt > 14f && t - _raidAt < 21.5f && t - _walkLogAt > 1f)
            {
                _walkLogAt = t;
                var sb = new System.Text.StringBuilder("[RaidRift] playsmoke walk t=" + (t - _raidAt).ToString("0.0") + " cam z " + app.arCamera.transform.position.z.ToString("0.0") + " heroes:");
                foreach (var h in heroes.Values)
                {
                    var hero = h as Hero;
                    if (hero == null) continue;
                    sb.Append(" z " + hero.transform.position.z.ToString("0.0") + " v " + (hero.Agent != null && hero.Agent.enabled ? hero.Agent.velocity.magnitude.ToString("0.0") + "/" + hero.Agent.speed.ToString("0.0") : "-") + (hero.Stuck ? " stuck" : "") + ";");
                }
                Debug.Log(sb.ToString());
            }
            if (_followed && t - _raidAt > 14f && t - _raidAt < 21.5f)
                foreach (var h in heroes.Values)
                {
                    var hc = h as Component;
                    if (hc == null) continue;
                    var vp = app.arCamera.WorldToViewportPoint(hc.transform.position + Vector3.up * 0.15f);
                    _walkSamples++;
                    if (vp.z > 0.3f && vp.x > 0f && vp.x < 1f && vp.y > 0.02f && vp.y < 1f) _walkInFrame++;
                }
            if (_followed && t - _raidAt >= 21.5f && !_walkChecked)
            {
                _walkChecked = true;
                Debug.Log("[RaidRift] playsmoke gameplay: following heroes on screen " + (_walkSamples > 0 ? 100f * _walkInFrame / _walkSamples : 0f).ToString("0") + "% of the walk (" + _walkSamples + " samples)");
                var r1 = typeof(RaidRiftApp).GetField("_rift", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(app) as Component;
                float moved = r1 != null && _riftStart.HasValue ? (r1.transform.position - _riftStart.Value).magnitude : 0f;
                Debug.Log("[RaidRift] playsmoke gameplay: after a 10 m walk the rift moved " + moved.ToString("0.0") + " m, heroes " + heroes.Count);
                // How far ahead of the lens the following party walks (too close = giant heroes / out of frame).
                var camT = app.arCamera.transform;
                var dists = new List<string>();
                foreach (var h in heroes.Values)
                {
                    var hc = h as Component;
                    if (hc == null) continue;
                    var d = hc.transform.position - camT.position;
                    dists.Add(new Vector2(d.x, d.z).magnitude.ToString("0.00") + (Vector3.Dot(d, camT.forward) > 0f ? "" : " (behind)"));
                }
                Debug.Log("[RaidRift] playsmoke gameplay: party distance from the phone (m): " + string.Join(", ", dists));
                if (moved < 3f) Problems.Add("gameplay: rift did not follow a 10 m walk (moved " + moved.ToString("0.0") + " m)");
                Snapshot(app.arCamera, "play-walk");
            }
            if (_raided && t - _raidAt > 22f) { ServerPhase(app, t); return; }
            bool done = !_raided && t > 8f;
            if (!done) return;
            if (!_raided) Problems.Add("gameplay: never landed on the synthetic floor in 8 s");
            else if (_maxHeroes == 0) Problems.Add("gameplay: test raid spawned no heroes in 22 s");
            Debug.Log("[RaidRift] playsmoke gameplay: max heroes " + _maxHeroes);
            Finish(null);
        }

        static void Finish(string fatal)
        {
            EditorApplication.update -= Tick;
            Application.logMessageReceived -= OnLog;
            SessionState.SetBool(Flag, false);
            if (fatal != null) Problems.Add(fatal);
            foreach (var p in Problems) Debug.Log("[RaidRift] playsmoke PROBLEM " + p);
            Debug.Log(Problems.Count == 0 ? "[RaidRift] playsmoke PASS (" + _frame + " frames)" : "[RaidRift] playsmoke FAIL " + Problems.Count);
            EditorApplication.isPlaying = false;
            if (Application.isBatchMode) EditorApplication.Exit(Problems.Count == 0 ? 0 : 1);
        }
    }
}
