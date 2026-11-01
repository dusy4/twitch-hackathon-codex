using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using UnityEngine.XR.ARFoundation;

namespace RaidRift
{
    /// <summary>Director. Room scan → NavMesh (RoomNavigation) → landing spot → raid portal → one
    /// NavMeshAgent hero per viewer, driven by the server world or the offline test room. Heroes go
    /// to their stage spot, or walk with the streamer (follow-me), always on paths the NavMesh found.</summary>
    public partial class RaidRiftApp : MonoBehaviour // SELFIE: isolated hooks in Selfie/RaidRiftApp.Selfie.cs.
    {
        public ARSession session;
        public Camera arCamera;
        public ARMeshManager meshManager;
        public RoomNavigation room;
        public ServerConnection server;
        public RiftTrail trail;
        public Hud hud;
        public StreamOutput stream;
        public RiftMoths moths;
        public SceneTracks sceneTracks;
        public SurfaceLabels surfaceLabels;
        public ObjectDetector detector;
        public LivePublisher publisher;

        // Live mode = a real Twitch channel (server reads its chat + raids) and the phone streams to Twitch.
        // Demo mode = everything else (offline test room, stub viewers, dev tools).
        bool _liveMode;
        int _quality;
        static readonly (string name, int start, int min, int max, int fps)[] Qualities =
        {
            ("HD · 4.5 Mbps", 4500, 1500, 6000, 30),
            ("Mobile data · 2.5 Mbps", 2500, 800, 3500, 30),
            ("Weak signal · 1.2 Mbps", 1200, 500, 1800, 24),
        };
        const string PrefChannel = "rr.live.channel", PrefKey = "rr.live.key", PrefQuality = "rr.live.quality";

        readonly LocalPlayground _playground = new LocalPlayground();
        readonly Dictionary<string, Hero> _heroes = new Dictionary<string, Hero>();
        readonly Dictionary<string, long> _cheerSerial = new Dictionary<string, long>();
        readonly List<ChatLine> _serverLines = new List<ChatLine>();
        Transform _heroRoot;

        bool _landed;
        Vector3 _origin, _right, _away;
        Vector3? _candidate;
        float _candidateSince;
        RiftWorld _rift;
        Material _paintMaterial;
        string _raidId;
        float _raidOpened = -100f;
        bool _follow;
        // Room view: 0 = full mesh + walkable floor, 1 = walkable floor only (default while scanning),
        bool _live;
        // Room view: 0 = full mesh + walkable floor, 1 = walkable floor only (default while scanning),
        // 2 = hidden (invisible occluder; default after landing and live). The Scan button cycles them.
        int _scanMode = 1;
        void SetScanMode(int mode) { _scanMode = mode; room.showWalkable = mode <= 1; _nextMaterialPass = 0f; }
        Material _scanMaterial, _occluderMaterial;
        float _nextMaterialPass;

        long NowMs => (long)(Time.realtimeSinceStartupAsDouble * 1000.0);

        void Start()
        {
            Application.targetFrameRate = 60;
            Screen.sleepTimeout = SleepTimeout.NeverSleep;
            _heroRoot = new GameObject("Heroes").transform;
            _scanMaterial = Resources.Load<Material>("Materials/ScanMesh");
            _occluderMaterial = Resources.Load<Material>("Materials/DepthOnly");
            hud.Build();
            hud.OnButton += Button;
            InitSelfie(); // SELFIE: generated scene supplies the controller.
            hud.OnChat += SendChat;
            hud.OnServer += (url, token) =>
            {
                server.SetServer(url);
                if (!string.IsNullOrEmpty(token)) server.SetToken(token);
            };
            server.OnNotice += (text, ok) => { hud.Toast(text); AddServerLine("Server", text, ok); };
            trail.OnEvent += TrailEvent;
            hud.OnGoLive += GoLive;
            _quality = Mathf.Clamp(PlayerPrefs.GetInt(PrefQuality, 0), 0, Qualities.Length - 1);
            hud.SetMode(false, "DEMO");
            RefreshButtons();
        }

        // ---------------- live mode ----------------
        void GoLive(string channel, string key)
        {
            if (string.IsNullOrEmpty(key)) key = PlayerPrefs.GetString(PrefKey, "");
            if (string.IsNullOrEmpty(channel)) channel = PlayerPrefs.GetString(PrefChannel, "");
            if (string.IsNullOrEmpty(key)) { hud.Toast("Paste your stream key · Twitch Creator Dashboard › Settings › Stream", 4f); return; }
            if (publisher == null) { hud.Toast("Streaming is not available in this build"); return; }
            PlayerPrefs.SetString(PrefKey, key); // on-device only; never sent to our server or shown on stream
            PlayerPrefs.SetString(PrefChannel, channel);
            PlayerPrefs.Save();
            if (stream != null && stream.Active) stream.Stop("Stream off"); // one owner of the camera texture
            if (!_live) { _live = true; server.Begin(); }
            if (!string.IsNullOrEmpty(channel))
                server.SetLiveChannel(channel, (ok, reply) =>
                {
                    hud.Toast(ok ? $"Reading #{channel} chat · viewers type !join" : "Chat link failed · " + reply, 3f);
                    AddServerLine("RaidRift", ok ? $"Connected to #{channel} chat" : "Chat link failed · " + reply, ok);
                });
            var q = Qualities[_quality];
            publisher.arCamera = arCamera;
            // Mixer sums voice + game with a hard clip: leave the streamer's voice headroom over raid stingers.
            publisher.GameVolume = 0.75f;
            publisher.StartLive(new LiveSettings
            {
                url = "rtmps://live.twitch.tv:443/app",
                key = key,
                fps = q.fps, startKbps = q.start, minKbps = q.min, maxKbps = q.max,
                adaptive = true, mic = true,
                landscape = Screen.width >= Screen.height,
            });
            _liveMode = true;
            _announced = false;
            // A clean broadcast: the scan grid becomes the invisible occluder.
            SetScanMode(2);
            hud.SetMode(true, "● LIVE");
            Sfx.Play("raid_stinger", 0.5f);
            RefreshButtons();
        }

        void EndLive()
        {
            if (publisher != null) publisher.StopLive();
            if (_live) server.StopLiveChannel();
            _liveMode = false;
            Application.targetFrameRate = 60; // undo a thermal 30 fps cap
            hud.SetBackdrop(null);
            hud.SetMode(false, "DEMO");
            hud.Toast("Stream ended · back to demo mode");
            RefreshButtons();
        }

        StreamCaption _caption;
        bool _announced; // title card shown for this broadcast
        float _endArmedAt = -10f;
        const string PrefCaption = "rr.live.caption";
        static bool StreamCaptionOn { get => PlayerPrefs.GetInt(PrefCaption, 1) == 1; set { PlayerPrefs.SetInt(PrefCaption, value ? 1 : 0); PlayerPrefs.Save(); } }

        void LiveTick(WorldState world)
        {
            if (_caption == null && arCamera != null) { _caption = StreamCaption.Create(arCamera); StreamHearts.Create(arCamera); }
            if (_caption != null) _caption.Tick(_liveMode && StreamCaptionOn, _heroes.Count); // in the broadcast, not the HUD
            string quality = Qualities[_quality].name;
            if (!_liveMode || publisher == null)
            {
                hud.SetLiveInfo("Streams the AR view (no buttons) + your mic + game sound straight to Twitch. Chat commands and raids come from your channel.", quality, PlayerPrefs.GetString(PrefChannel, ""));
                return;
            }
            hud.SetBackdrop(publisher.View); // null after a failure/stop: the camera renders to the screen again
            // Phone too hot (encoder already dropped below 30 fps): stop rendering 60 fps nobody sees on stream.
            // Capture active (also while reconnecting), not "delivering": a hot phone stays capped during a reconnect.
            Application.targetFrameRate = publisher.View != null && publisher.TargetFps > 0 && publisher.TargetFps < 30 ? 30 : 60;
            var up = System.TimeSpan.FromSeconds(publisher.UptimeSeconds);
            string chip = publisher.IsLive ? $"● LIVE {(int)up.TotalMinutes:00}:{up.Seconds:00}" : publisher.State.StartsWith("error") ? "● OFFLINE" : "● " + publisher.State.ToUpperInvariant();
            hud.SetMode(true, chip);
            hud.SetLiveStats(_heroes.Count, publisher.BitrateKbps);
            // First moment Twitch actually receives video: an in-world title card, so early viewers know what to do.
            if (publisher.IsLive && !_announced && !(selfie != null && selfie.WorldPaused))
            {
                _announced = true;
                var cam = arCamera.transform;
                WorldTags.Banner(cam.position + cam.forward * 1.6f, arCamera, "RAIDRIFT", "type !join in chat to drop in a hero", 3.5f);
                Sfx.Play("rift_open", 0.4f);
            }
            // The world can be a stale snapshot while the tailnet is down: say so instead of "chat connected".
            string chat = _live && !server.Connected ? "game server unreachable · retrying (stream continues)"
                : world?.LiveChannel != null ? (world.LiveConnected ? $"#{world.LiveChannel} chat connected" : $"#{world.LiveChannel} chat reconnecting…") : "no channel chat";
            hud.SetLiveInfo($"{publisher.State} · {publisher.BitrateKbps} kbps · {publisher.SendFps:0} fps · dropped {publisher.DroppedFrames}{(publisher.Restarts > 0 ? $" · rebuilt {publisher.Restarts}x" : "")}\n{chat} · mic {(publisher.MicMuted ? "muted" : "on")}", quality, "");
            hud.SetButton("mic", publisher.MicMuted ? "Mic off" : "Mic on", !publisher.MicMuted);
        }

        // ---------------- buttons ----------------
        void Button(string id)
        {
            if (SelfieBlocksButton(id)) return; // SELFIE: room tools wait until the rear camera returns.
            Sfx.Play("ui_tap", 0.45f);
            switch (id)
            {
                case "selfie": selfie?.Toggle(); break; // SELFIE: HUD button id.
                case "raid":
                    // Server heroes on screen but the tailnet is down: a local raid would only fight the stale snapshot.
                    if (UseServer && !server.Connected) { hud.Toast("Game server unreachable · retrying · heroes stay", 2.5f); break; }
                    if (UseServer) { server.DebugRaid((ok, text) => hud.Toast(ok ? "Server test raid sent" : "Raid failed · " + text)); break; }
                    ClearHeroes();
                    _raidId = null;
                    _playground.Raid(NowMs);
                    hud.Toast(_landed ? "Test raid incoming" : "Test raid waits for a landing spot");
                    break;
                case "follow":
                    _follow = !_follow;
                    _followTouched = true;
                    hud.Toast(_follow ? "Party walks with you" : "Party stays at the landing spot");
                    break;
                case "trail":
                    if (trail.Current == RiftTrail.Phase.Off || trail.Current == RiftTrail.Phase.Complete) { trail.Begin(); _follow = true; hud.Toast("Rift Trail · find 3 crystals"); }
                    else { trail.Clear(); hud.Toast("Rift Trail stopped"); }
                    break;
                case "scan":
                    SetScanMode((_scanMode + 1) % 3);
                    hud.Toast(_scanMode == 0 ? "Room mesh shown" : _scanMode == 1 ? "Floor only" : "Mesh hidden · clean view", 1.5f);
                    _nextMaterialPass = 0f;
                    break;
                case "chat": hud.ToggleChat(); break;
                case "end-live":
                    if (!_liveMode) break;
                    // Walking with the phone: one stray tap must not end the broadcast. Second tap within 3 s does.
                    if (Time.unscaledTime - _endArmedAt > 3f) { _endArmedAt = Time.unscaledTime; hud.Toast("Tap End again to stop the stream", 3f); hud.KeepSheetOpen(); break; }
                    _endArmedAt = -10f;
                    EndLive();
                    break;
                case "caption": StreamCaptionOn = !StreamCaptionOn; hud.Toast(StreamCaptionOn ? "Stream shows how to !join" : "No hint on stream"); break;
                case "motion": CameraFeel.ReducedMotion = !CameraFeel.ReducedMotion; hud.Toast(CameraFeel.ReducedMotion ? "Reduced motion: no screen shake" : "Full camera effects"); break;
                case "mic": if (publisher != null) { publisher.MicMuted = !publisher.MicMuted; hud.Toast(publisher.MicMuted ? "Mic muted on stream" : "Mic live"); } break;
                case "quality":
                    _quality = (_quality + 1) % Qualities.Length;
                    PlayerPrefs.SetInt(PrefQuality, _quality);
                    if (_liveMode) hud.Toast("Applies next time you go live");
                    break;
                case "setup": hud.ToggleSetup(server.Server); break;
                case "pair": _live = true; server.Begin(); break;
                case "stream":
                    if (stream == null) break;
                    // One owner of the camera texture: WebRTC would take it from the Twitch publisher mid-broadcast.
                    if (_liveMode && !stream.Active) { hud.Toast("End the Twitch stream first · PC streaming uses the same camera"); break; }
                    stream.Toggle();
                    hud.Toast(stream.Active ? "Streaming · open the receiver page on the PC" : "Stream stopped");
                    break;
                case "sound":
                    Sfx.Muted = !Sfx.Muted;
                    hud.Toast(Sfx.Muted ? "Sound off" : "Sound on");
                    if (!Sfx.Muted) Sfx.Play("pickup");
                    break;
                case "offline" when _liveMode && Time.unscaledTime - _offlineArmedAt > 3f:
                    // Broadcasting: going offline drops Twitch chat while the stream keeps running. Confirm.
                    _offlineArmedAt = Time.unscaledTime;
                    hud.Toast("Still live · tap again to disconnect chat (stream keeps running)", 3f);
                    hud.KeepSheetOpen();
                    break;
                case "offline": _offlineArmedAt = -10f; _live = false; server.Stop(); ClearHeroes(); hud.Toast("Offline test room"); break;
                case "server-raid": if (_live) server.DebugRaid((ok, text) => hud.Toast(ok ? "Server test raid sent" : "Raid failed · " + text)); else hud.Toast("Pair with the server first"); break;
                case "reset-room":
                    // Destructive mid-stream (rift + heroes go): a landed room needs a second tap within 3 s.
                    if (_landed && Time.unscaledTime - _resetArmedAt > 3f) { _resetArmedAt = Time.unscaledTime; hud.Toast("Tap again to rescan the room (the party re-lands)", 3f); hud.KeepSheetOpen(); break; }
                    _resetArmedAt = -10f;
                    ResetRoom();
                    break;
            }
            RefreshButtons();
        }

        float _resetArmedAt = -10f, _offlineArmedAt = -10f;

        /// <summary>Forget the scanned room: navigation, landing, rift, heroes, targets. Also used by selfie recovery.</summary>
        void ResetRoom()
        {
            room.ResetRoom();
            _landed = false; _candidate = null;
            SetScanMode(1);
            ClearHeroes();
            if (_rift != null) Destroy(_rift.gameObject);
            if (_marker != null) Destroy(_marker);
            if (moths != null) moths.Clear();
            // Nothing from the previous room may resolve as a target: places, labels, in-flight frames.
            if (sceneTracks != null) sceneTracks.ResetScene();
            if (surfaceLabels != null) surfaceLabels.Clear();
            if (detector != null) detector.ResetDetections();
            _roam.Clear();
            trail.Clear();
            hud.Toast("Room scan reset");
            RefreshButtons();
        }

        void RefreshButtons()
        {
            RefreshSelfieButton(); // SELFIE
            hud.SetButton("raid", "Test raid", false);
            hud.SetButton("follow", _follow ? "Following" : "Follow me", _follow);
            hud.SetButton("trail", trail.Current == RiftTrail.Phase.Off ? "Trail" : "Trail on", trail.Current != RiftTrail.Phase.Off);
            hud.SetButton("scan", _scanMode == 0 ? "Mesh" : _scanMode == 1 ? "Floor" : "Hidden", _scanMode < 2);
            hud.SetSetting("scan", _scanMode == 0 ? "Mesh" : _scanMode == 1 ? "Floor only" : "Hidden");
            hud.SetSetting("sound", Sfx.Muted ? "Off" : "On");
            hud.SetSetting("motion", CameraFeel.ReducedMotion ? "On" : "Off");
            hud.SetSetting("caption", StreamCaptionOn ? "On" : "Off");
            hud.SetButton("chat", "Chat", false);
            hud.SetButton("setup", "Setup", false);
            hud.SetButton("end-live", "End", false);
            if (publisher == null || !_liveMode) hud.SetButton("mic", "Mic", false);
        }

        void SendChat(string text)
        {
            var actor = CurrentWorld().Heroes.FirstOrDefault()?.Id;
            if (UseServer)
            {
                AddServerLine("You", text, true);
                server.Chat(text, actor, (ok, reply) => AddServerLine("RaidRift", reply, ok));
            }
            else _playground.Command(text, actor, NowMs);
        }

        void AddServerLine(string speaker, string text, bool ok)
        {
            _serverLines.Add(new ChatLine { Speaker = speaker, Text = text, System = speaker != "You", Ok = ok });
            if (_serverLines.Count > 40) _serverLines.RemoveAt(0);
        }

        void TrailEvent(string kind)
        {
            switch (kind)
            {
                case "discovered": hud.Toast("Crystal discovered!"); Sfx.Play("discovery"); break;
                case "collected": hud.Toast($"Crystal {trail.Collected}/3"); Sfx.Play("pickup"); break;
                case "restored": hud.Toast("Shrine restored · viewers, cheer!"); Sfx.Play("quest_complete"); break;
                case "completed": hud.Toast("Rift Trail complete!", 4f); Sfx.Play("quest_complete"); break;
            }
            if (!UseServer) _playground.React(kind, NowMs);
            RefreshButtons();
        }

        /// <summary>Server world when paired and reachable; otherwise the offline test room keeps running, so a stream
        /// whose phone loses the tailnet still has heroes and a working Test raid.</summary>
        bool UseServer => _live && server.World != null;
        WorldState CurrentWorld() => UseServer ? server.World : _playground.World;

        // ---------------- frame ----------------
        void Update()
        {
            if (UpdateSelfie()) return; // SELFIE: includes both transitions; world logic below is unchanged.
            bool tracking = ARSession.state == ARSessionState.SessionTracking;
            if (!_landed) UpdateLanding(tracking);
            else { AutoFollow(); RelocateRift(tracking); }
            TrackStreamerPace();
            RiftFx.FloorY = room.FloorY;
            RiftFx.SetAmbient(_rift != null ? _rift.transform : null);
            if (moths != null)
            {
                moths.FloorY = room.FloorY;
                moths.Anchor = _follow && room.FloorUnderCamera(out var me) ? me : _rift != null ? _rift.transform.position : _origin;
            }
            if (!UseServer) _playground.Tick(NowMs, tracking && _landed);
            var world = CurrentWorld();
            if (detector != null)
            {
                detector.enabled = tracking && room.HasNavMesh;
                // While broadcasting the encoder owns the GPU budget: look for objects less often (heat, FPS).
                detector.interval = _liveMode ? 1.2f : 0.5f;
            }
            if (sceneTracks != null)
            {
                sceneTracks.active = _live && _landed && tracking;
                sceneTracks.frameInterval = _liveMode ? 3f : 1.5f; // live: leave mobile uplink to the stream
                sceneTracks.Portal = _rift != null ? _rift.Foot(0) : (Vector3?)null;
                if (_live) sceneTracks.Ingest(server.World);
            }
            UpdateRaid(world);
            SyncHeroes(world);
            UpdateRoomMaterials();
            UpdateHud(world, tracking);
            LiveTick(world);
            HandleTap(tracking);
        }

        readonly List<UnityEngine.EventSystems.RaycastResult> _uiHits = new List<UnityEngine.EventSystems.RaycastResult>();

        bool OverUi(Vector2 screen)
        {
            var es = UnityEngine.EventSystems.EventSystem.current;
            if (es == null) return false;
            _uiHits.Clear();
            es.RaycastAll(new UnityEngine.EventSystems.PointerEventData(es) { position = screen }, _uiHits);
            return _uiHits.Count > 0;
        }

        void UpdateLanding(bool tracking)
        {
            if (!tracking || !room.HasNavMesh) { _candidate = null; return; }
            var cam = arCamera.transform;
            float floorY = room.FloorY ?? cam.position.y - 1.3f;
            // Aim where the camera looks at the floor (1-3 m); looking up, fall back to 1 m ahead.
            Vector3 probe;
            var dir = cam.forward;
            float t = dir.y < -0.15f ? (floorY - cam.position.y) / dir.y : -1f;
            if (t > 0.4f && t < 3.5f) probe = cam.position + dir * t;
            else
            {
                var flat = Vector3.ProjectOnPlane(dir, Vector3.up);
                if (flat.sqrMagnitude < 1e-4f) return;
                probe = cam.position + flat.normalized * 1.0f;
                probe.y = floorY;
            }
            if (!BestFloorSpot(probe, floorY, out var spot)) { _candidate = null; return; }
            if (_candidate == null || (_candidate.Value - spot).magnitude > 0.25f) { _candidate = spot; _candidateSince = Time.time; return; }
            if (Time.time - _candidateSince > 0.8f) Land(spot);
        }

        /// <summary>Clearest floor point near [probe]: the probe itself or a ring of 8 around it (40 cm).
        /// Floor = within 20 cm of the floor height (bed tops and desks are higher), ≥15 cm clear around.</summary>
        bool BestFloorSpot(Vector3 probe, float floorY, out Vector3 best)
        {
            best = default;
            float bestClear = 0.15f;
            bool found = false;
            for (int i = -1; i < 8; i++)
            {
                var p = i < 0 ? probe : probe + Quaternion.Euler(0f, i * 45f, 0f) * Vector3.forward * 0.4f;
                if (!room.Sample(p, 0.5f, out var s) || Mathf.Abs(s.y - floorY) > 0.2f) continue;
                float clear = room.Clearance(s);
                if (clear > bestClear) { bestClear = clear; best = s; found = true; }
                if (i < 0 && clear >= 0.3f) return true; // the aimed point is good enough
            }
            return found;
        }

        void HandleTap(bool tracking)
        {
            var screen = UnityEngine.InputSystem.Touchscreen.current;
            if (!tracking || hud.Typing || screen == null || !screen.primaryTouch.press.wasPressedThisFrame) return;
            var position = screen.primaryTouch.position.ReadValue();
            if (OverUi(position)) return;
            var ray = arCamera.ScreenPointToRay(position);
            float floorY = room.FloorY ?? arCamera.transform.position.y - 1.3f;
            if (Mathf.Abs(ray.direction.y) < 1e-3f) return;
            float t = (floorY - ray.origin.y) / ray.direction.y;
            if (t <= 0f || t > 8f) return;
            if (!room.Sample(ray.GetPoint(t), 0.4f, out var spot)) { hud.Toast("That floor isn't scanned yet"); return; }
            if (!_landed) { Land(spot); return; }
            // After landing a tap sends the party there (streamer "go here").
            _follow = false;
            int i = 0;
            foreach (var hero in _heroes.Values) hero.SetDestination(Slot(spot, i++), (hero.transform.position - spot).magnitude > 1.2f);
            _tapGoal = spot;
            _tapGoalUntil = Time.time + 8f;
            RefreshButtons();
        }

        Vector3? _tapGoal;
        float _tapGoalUntil;

        void Land(Vector3 spot)
        {
            _landed = true;
            _origin = spot;
            var cam = arCamera.transform.position;
            _away = Vector3.ProjectOnPlane(spot - cam, Vector3.up).normalized;
            if (_away.sqrMagnitude < 1e-4f) _away = Vector3.forward;
            _right = Vector3.Cross(Vector3.up, _away);
            // The 3D map stays visible after landing (owner: auto-hiding it looked like the map vanished).
            // "Scan off" turns it into an invisible occluder for a clean stream.
            _nextMaterialPass = 0f;
            if (_marker != null) Destroy(_marker);
            _marker = LandingMarker(spot);
            RefreshButtons();
            Sfx.Play("landing_lock", 0.8f);
            hud.Toast("Landing spot locked · tap Test raid", 3f);
        }

        GameObject _marker;

        /// <summary>A small glowing rune on the landing spot: where the raid portal will open.</summary>
        static GameObject LandingMarker(Vector3 spot)
        {
            var root = new GameObject("Landing marker");
            root.transform.position = spot + Vector3.up * 0.005f;
            // Round additive rings (Kenney CC0 textures), not a square swirl quad (great.mp4 showed its edges).
            var add = Resources.Load<Material>("Materials/FxAddTint") ?? Resources.Load<Material>("Materials/FxAdd");
            foreach (var (tex, size, color, spin) in new[] { ("Fx/Ring", 0.5f, new Color(0.65f, 0.17f, 1f, 0.9f), 1f), ("Fx/Magic", 0.34f, new Color(0.35f, 0.95f, 0.78f, 0.7f), -1.6f) })
            {
                var disc = GameObject.CreatePrimitive(PrimitiveType.Quad);
                Destroy(disc.GetComponent<Collider>());
                disc.transform.SetParent(root.transform, false);
                disc.transform.localRotation = Quaternion.Euler(90f, 0f, 0f);
                disc.transform.localScale = Vector3.one * size;
                if (add != null)
                {
                    var m = new Material(add) { mainTexture = Resources.Load<Texture2D>(tex) };
                    m.SetColor("_TintColor", color);
                    m.color = color;
                    disc.GetComponent<Renderer>().sharedMaterial = m;
                }
                disc.AddComponent<SpinLocal>().speed = 50f * spin;
            }
            var crystal = Resources.Load<Material>("Materials/Crystal");
            for (int i = 0; i < 4; i++)
            {
                var c = GameObject.CreatePrimitive(PrimitiveType.Cube);
                Destroy(c.GetComponent<Collider>());
                c.transform.SetParent(root.transform, false);
                float a = i * Mathf.PI / 2f;
                c.transform.localPosition = new Vector3(Mathf.Cos(a) * 0.2f, 0.02f, Mathf.Sin(a) * 0.2f);
                c.transform.localScale = Vector3.one * 0.03f;
                if (crystal != null) c.GetComponent<Renderer>().sharedMaterial = crystal;
            }
            root.AddComponent<Spin>();
            return root;
        }

        class SpinLocal : MonoBehaviour
        {
            public float speed;
            void Update() => transform.Rotate(0f, 0f, speed * Time.deltaTime, Space.Self);
        }

        class Spin : MonoBehaviour
        {
            void Update() => transform.Rotate(0f, 40f * Time.deltaTime, 0f, Space.World);
        }

        void UpdateRaid(WorldState world)
        {
            if (!_landed || world.Raid == null || world.Raid.Id == _raidId) return;
            _raidId = world.Raid.Id;
            if (_rift != null) Destroy(_rift.gameObject);
            if (_marker != null) Destroy(_marker);
            var banner = world.Raid.Test ? "TEST RAID" : $"RAID · {world.Raid.From} · {world.Raid.Count}";
            // The rift window stands just behind the landing spot; heroes walk out onto the spot.
            _rift = RiftWorld.Create(_origin + _away * 0.45f, arCamera.transform.position, arCamera);
            _raidOpened = Time.time;
            hud.Flash(new Color(0.75f, 0.5f, 1f), 0.8f);
            StartCoroutine(TearSequence(_rift, 1f, !world.Raid.Test));
            WorldTags.Banner(_rift.transform.position + Vector3.up * 2.15f, arCamera, world.Raid.Test ? "TEST RAID" : "RAID",
                world.Raid.Test ? "the rift is opening" : $"{world.Raid.From} · {world.Raid.Count} viewers", 2.4f); // charge 0.6 s → tear (camera hit) → shockwave, sparks, chips
            if (!world.Raid.Test) Sfx.Play("raid_stinger", 0.8f); // real raids get the trailer hit
            StreamHearts.Pop(world.Raid.Test ? 5 : 12);
            if (moths != null) moths.Burst(_rift.transform.position + Vector3.up * 1.0f, -_rift.Forward, 12);
            // The rift paints the room now: switch the scan grid to the invisible occluder + paint.
            SetScanMode(2);
            _nextMaterialPass = 0f;
            RefreshButtons();
            hud.Toast(banner + " · the rift is opening", 3f);
        }

        void SyncHeroes(WorldState world)
        {
            var alive = new HashSet<string>();
            int index = 0;
            foreach (var state in world.Heroes)
            {
                alive.Add(state.Id);
                if (!_heroes.TryGetValue(state.Id, out var hero))
                {
                    hero = Hero.Create(state.Id, HeroModels.For(state.Id), room.AgentTypeId, _heroRoot);
                    _heroes[state.Id] = hero;
                }
                hero.DisplayName = state.Name;
                hero.Message = state.Message;
                if (ReturnSelfieHero(hero, index)) { index++; continue; } // SELFIE: floor near rear camera.
                if (hero.Entering) { index++; continue; } // still walking out of the rift
                if (hero.Spawned && !hero.Placed)
                {
                    // Off the mesh after a rebake: snap to the nearest walkable point, never back to the portal.
                    if (room.Sample(hero.transform.position, 0.6f, out var near)) hero.Recover(near);
                    if (!hero.Placed) { index++; continue; }
                }
                if (!hero.Spawned)
                {
                    if (!_landed || !room.HasNavMesh) { index++; continue; }
                    // With a rift open, everyone walks out of the rift world onto the real floor.
                    if (_rift != null && room.Sample(_rift.Foot(index), 0.5f, out var exit))
                    {
                        hero.BeginEntrance(_rift, _rift.Inside(index), exit);
                        index++;
                        continue;
                    }
                    var at = StagePoint(state);
                    if (!room.Sample(at, 0.5f, out var spawn)) { index++; continue; }
                    var face = Quaternion.LookRotation(Vector3.ProjectOnPlane(arCamera.transform.position - spawn, Vector3.up).normalized + Vector3.forward * 1e-4f);
                    if (!hero.Place(spawn, face)) { index++; continue; }
                    // No rift open (a viewer !joins before any raid): still a visible arrival on stream, not a pop-in.
                    RiftFx.Arrival(spawn, face * Vector3.forward, true);
                    StreamHearts.Pop(2);
                    Fx.Sparkle(spawn + Vector3.up * 0.12f, new Color(0.35f, 0.95f, 0.78f), 18, 0.7f);
                    Sfx.PlayAt("teleport_in", spawn, 0.55f);
                }
                bool newAction = state.Serial != hero.ActionSerial;
                if (newAction && hero.ActionSerial != 0 && state.Animation != "idle") { RiftFx.Command(hero.transform.position, true); RiftFx.Emote(hero.transform.position, state.Animation); StreamHearts.Pop(); } // chat command landed
                // Planner steps with a room target ("there", the chair, the bed top) walk there, then pose.
                Vector3 targetPos = default;
                bool targeted = state.Target != null && sceneTracks != null && sceneTracks.TryWorld(state.Target, out targetPos);
                if (targeted) hero.ActAt(state.Animation, state.Serial, targetPos);
                else hero.Act(state.Animation, state.Serial);
                if (newAction && (state.Animation == "wave" || state.Animation == "dance" || state.Animation == "jump"))
                {
                    if (!_cheerSerial.TryGetValue(state.Id, out var last) || last != state.Serial) { _cheerSerial[state.Id] = state.Serial; trail.Cheer(state.Id); }
                }
                CatchUp(hero);
                if (Steer(hero, state)) { index++; continue; } // a viewer is holding WASD: they drive
                if (targeted || hero.HasPendingPose) { index++; continue; } // ActAt owns the destination
                Vector3 goal;
                bool run;
                bool commanded = Time.time - hero.LastCommand < 8f;
                bool following = _follow || trail.Current == RiftTrail.Phase.Fragments || trail.Current == RiftTrail.Phase.Shrine;
                hero.Pace = following ? Mathf.Min(_streamerPace * 1.25f, 2.2f) : 0f;
                if (_tapGoal.HasValue && Time.time < _tapGoalUntil) { goal = Slot(_tapGoal.Value, index); run = (hero.transform.position - goal).magnitude > 1.2f; }
                else if (commanded)
                {
                    goal = following ? FollowSlot(index) : StagePoint(state);
                    run = state.Animation == "run";
                    // Following a walking streamer: a recent chat command must not slow the hero to a 0.35 m/s stroll
                    // (on a busy stream someone always just typed, and the party trailed off the frame).
                    if (following && (_streamerPace > 0.45f || (hero.transform.position - goal).magnitude > 1.0f)) run = true;
                }
                else if (following)
                {
                    goal = FollowSlot(index);
                    float far = (hero.transform.position - goal).magnitude;
                    // Close to their slot: free to roam, but in front of the lens (roaming around the floor under the
                    // phone put half the party behind the streamer or filling the frame, PlaySmoke play-walk).
                    bool walking = _streamerPace > 0.45f; // streamer on the move: keep formation, don't wander off
                    if (!walking && far < 1.2f && FollowCenter(out var near)) { Roam(hero, near, 0.8f); index++; continue; }
                    run = far > 1.0f || walking;
                }
                else { Roam(hero, RoamAnchor(), 2.6f); index++; continue; }
                if (room.Sample(goal, 0.5f, out var onMesh)) hero.SetDestination(onMesh, run);
                index++;
            }
            foreach (var id in _heroes.Keys.Where(k => !alive.Contains(k)).ToList())
            {
                var gone = _heroes[id];
                if (gone.Spawned && gone.gameObject.activeInHierarchy) // a viewer left: poof, not a silent vanish
                {
                    Fx.Sparkle(gone.transform.position + Vector3.up * 0.15f, new Color(0.7f, 0.45f, 1f), 18, 0.8f);
                    Sfx.PlayAt("teleport_out", gone.transform.position, 0.5f);
                }
                Destroy(gone.gameObject);
                _heroes.Remove(id);
                _selfieReturn.Remove(id); // SELFIE: a departed viewer must not retain a floor-placement retry.
            }
        }

        // ---------------- WASD steering (Twitch Extension d-pad, !w !a !s !d) ----------------
        readonly Dictionary<string, (long until, float deadline)> _steer = new Dictionary<string, (long, float)>();

        /// <summary>Directions are in the streamer's view (W = away from the camera, D = screen right), so what a
        /// viewer presses matches what they see on stream. The server extends `until` while the key is held; we
        /// use local receipt time (phone and PC clocks differ), so a hold ends 0.7 s after updates stop.</summary>
        bool Steer(Hero hero, HeroState state)
        {
            bool held = state.SteerX != 0f || state.SteerY != 0f;
            _steer.TryGetValue(state.Id, out var s);
            if (!held) { _steer.Remove(state.Id); return false; }
            if (state.SteerUntil != s.until) s = (state.SteerUntil, Time.time + 0.7f);
            _steer[state.Id] = s;
            if (Time.time > s.deadline) return false;
            var cam = arCamera.transform;
            var fwd = Vector3.ProjectOnPlane(cam.forward, Vector3.up);
            if (fwd.sqrMagnitude < 1e-4f) fwd = Vector3.ProjectOnPlane(cam.up, Vector3.up);
            fwd.Normalize();
            var right = Vector3.Cross(Vector3.up, fwd);
            var dir = Vector3.ClampMagnitude(right * state.SteerX + fwd * state.SteerY, 1f);
            var pos = hero.transform.position;
            // Probe 0.8 m ahead; along a wall, slide instead of stopping.
            if (room.Sample(pos + dir * 0.8f, 0.35f, out var to) || room.Sample(pos + dir * 0.4f, 0.3f, out to))
                hero.SetDestination(to, dir.magnitude > 0.7f);
            return true;
        }

        // ---------------- roaming brain ("Mario jumps around everywhere") ----------------
        class RoamState { public Vector3 goal; public float until; public bool resting = true; public bool toSeat, sitting; }
        readonly Dictionary<string, RoamState> _roam = new Dictionary<string, RoamState>();
        UnityEngine.AI.NavMeshPath _roamPath;
        static readonly string[] RestEmotes = { "cheer", "jump", "pickup", "spell", "wave", "jump" };

        /// <summary>Between the landing spot and the streamer, so the party explores the room you are in.</summary>
        Vector3 RoamAnchor()
        {
            if (room.FloorUnderCamera(out var floor)) return Vector3.Lerp(_origin, floor, 0.5f);
            return _origin;
        }

        /// <summary>Uncommanded heroes explore: walk to random reachable floor spots, hop up onto furniture
        /// tops (jump links), rest, emote, wave at the streamer when they are close.</summary>
        void Roam(Hero hero, Vector3 anchor, float radius)
        {
            if (!_roam.TryGetValue(hero.Id, out var st)) { st = new RoamState { until = Time.time + Random.Range(0.5f, 2f) }; _roam[hero.Id] = st; }
            // A roam-chosen sit lasts a while, then the hero stands up and moves on.
            if (st.sitting)
            {
                if (Time.time < st.until) return;
                st.sitting = false;
                hero.Emote("stop");
                st.until = Time.time + 1f;
            }
            if (!hero.Idle) return;
            if (_roamPath == null) _roamPath = new UnityEngine.AI.NavMeshPath();
            var pos = hero.transform.position;
            if (st.resting)
            {
                if (Time.time < st.until) return;
                // Pick somewhere new: a recognised seat (sit on the sofa/chair/bed) 30%, a furniture top 45%,
                // else open floor.
                bool picked = false;
                st.toSeat = false;
                if (surfaceLabels != null && Random.value < 0.3f)
                    foreach (var th in surfaceLabels.Things)
                    {
                        if (!SurfaceLabels.IsSeat(th) || th.confidence < 0.4f) continue;
                        if ((new Vector2(th.pos.x - anchor.x, th.pos.z - anchor.z)).magnitude > radius + 1f) continue;
                        if (!room.Reachable(pos, th.pos, _roamPath)) continue;
                        st.goal = th.pos; picked = true; st.toSeat = true;
                        break;
                    }
                var tops = room.Tops;
                if (tops.Count > 0 && Random.value < 0.45f)
                    for (int tries = 0; tries < 5 && !picked; tries++)
                    {
                        var t = tops[Random.Range(0, tops.Count)];
                        if ((new Vector2(t.x - anchor.x, t.z - anchor.z)).magnitude > radius + 0.8f) continue;
                        if (room.Reachable(pos, t, _roamPath)) { st.goal = t; picked = true; }
                    }
                for (int tries = 0; tries < 6 && !picked; tries++)
                {
                    var c = Random.insideUnitCircle * radius;
                    if (!room.Sample(anchor + new Vector3(c.x, 0f, c.y), 0.4f, out var p)) continue;
                    if ((p - pos).magnitude < 0.4f || !room.Reachable(pos, p, _roamPath)) continue;
                    st.goal = p;
                    picked = true;
                }
                if (!picked) { st.until = Time.time + 1f; return; }
                st.resting = false;
                st.until = Time.time + 12f;
                hero.SetDestination(st.goal, Random.value < 0.3f);
                return;
            }
            bool arrived = !hero.Agent.pathPending && hero.Agent.remainingDistance < 0.12f;
            if (arrived || Time.time > st.until || hero.Stuck)
            {
                st.resting = true;
                st.until = Time.time + Random.Range(1.5f, 4.5f);
                var cam = arCamera.transform.position;
                bool close = (new Vector2(cam.x - pos.x, cam.z - pos.z)).magnitude < 1.9f; // the follow party waits ~1.5 m ahead: turn and wave
                if (st.toSeat && arrived)
                {
                    hero.FaceTowards(cam);
                    hero.Emote("sit");
                    st.sitting = true;
                    st.toSeat = false;
                    st.until = Time.time + Random.Range(5f, 10f);
                }
                else if (close) { hero.FaceTowards(cam); hero.Emote("wave"); }
                else if (Random.value < 0.55f) hero.Emote(RestEmotes[Random.Range(0, RestEmotes.Length)]);
            }
        }

        /// <summary>Streamer walked away from the landing spot (city IRL stream): the party comes along.</summary>
        bool _followTouched;

        void AutoFollow()
        {
            if (_follow || _followTouched || _heroes.Count == 0 || !room.FloorUnderCamera(out var floor)) return;
            if ((new Vector2(floor.x - _origin.x, floor.z - _origin.z)).magnitude < 4.5f) return;
            _follow = true;
            hud.Toast("Party follows you · tap Follow me to leave them", 3f);
            RefreshButtons();
        }

        /// <summary>VFX-PLAN portal timeline: 0–0.6 s anticipation pull-in, 0.6 s tear with the camera hit, floor
        /// shockwave, outward sparks, heavy obsidian chips and low smoke; RiftWorld's own open/boom runs underneath.</summary>
        System.Collections.IEnumerator TearSequence(RiftWorld rift, float scale, bool raid)
        {
            if (rift == null) yield break;
            var foot = rift.transform.position;
            var center = foot + Vector3.up * 0.95f * scale;
            RiftFx.Charge(center, rift.Forward, scale);
            // Rising rumble while it charges, then the tear hits.
            for (float t0 = 0f; t0 < 0.6f; t0 += Time.deltaTime) { CameraFeel.Shake(0.15f + 0.45f * (t0 / 0.6f)); yield return null; }
            if (rift == null || (selfie != null && selfie.WorldPaused)) yield break; // SELFIE: no delayed floor burst.
            RiftFx.Tear(center, rift.Forward, foot, scale, raid);
        }

        float _nextRelocate;

        /// <summary>The stage travels with an IRL streamer: once the party follows and the streamer is 8 m+ from
        /// the rift, it collapses and tears open again ~1.6 m ahead on scanned floor, so new raiders arrive where
        /// the stream is now, not back at the first room.</summary>
        void RelocateRift(bool tracking)
        {
            if (!tracking || !_follow || _rift == null || Time.time < _nextRelocate || Time.time - _raidOpened < 8f) return;
            if (!room.FloorUnderCamera(out var floor)) return;
            if (new Vector2(floor.x - _origin.x, floor.z - _origin.z).magnitude < 8f) return;
            _nextRelocate = Time.time + 2f; // retry soon if no good spot yet
            foreach (var h in _heroes.Values) if (h.Entering) return; // never strand someone mid-portal
            var flat = Vector3.ProjectOnPlane(arCamera.transform.forward, Vector3.up);
            if (flat.sqrMagnitude < 1e-4f) return;
            flat.Normalize();
            if (!room.Sample(floor + flat * 1.6f, 0.5f, out var spot) || Mathf.Abs(spot.y - floor.y) > 0.12f || room.Clearance(spot) < 0.35f) return;
            _rift.Collapse(); // squeezes shut on stream (~0.3 s, own sparkle) while the new one tears open ahead
            _origin = spot;
            _away = flat;
            _right = Vector3.Cross(Vector3.up, _away);
            _rift = RiftWorld.Create(_origin + _away * 0.45f, arCamera.transform.position, arCamera);
            _raidOpened = Time.time;
            if (moths != null) moths.Burst(_rift.transform.position + Vector3.up * 1.0f, -_rift.Forward, 8);
            Sfx.Play("rift_open", 0.7f);
            StartCoroutine(TearSequence(_rift, 0.8f, false));
            hud.Toast("The rift followed you", 2f);
            _nextRelocate = Time.time + 12f;
        }

        // Smoothed walking speed of the phone over the floor (m/s). A following party runs at least this fast (x1.25)
        // so it stays ahead of the lens on a street walk instead of trailing behind at 0.9 m/s.
        float _streamerPace;
        Vector3 _lastCamFlat;
        bool _hasLastCam;

        void TrackStreamerPace()
        {
            var p = arCamera.transform.position;
            var flat = new Vector3(p.x, 0f, p.z);
            float dt = Time.deltaTime;
            if (_hasLastCam && dt > 1e-4f)
            {
                float v = Mathf.Min((flat - _lastCamFlat).magnitude / dt, 3f); // ignore tracking jumps
                _streamerPace = Mathf.Lerp(_streamerPace, v, 1f - Mathf.Exp(-dt / 0.6f));
            }
            _lastCamFlat = flat;
            _hasLastCam = true;
        }

        /// <summary>City walking: a hero left far behind (or stuck while following) rift-hops to the streamer.</summary>
        void CatchUp(Hero hero)
        {
            if (!hero.Placed || !room.FloorUnderCamera(out var floor)) return;
            float dist = (hero.transform.position - floor).magnitude;
            bool following = _follow || trail.Current == RiftTrail.Phase.Fragments || trail.Current == RiftTrail.Phase.Shrine;
            var flat = Vector3.ProjectOnPlane(arCamera.transform.forward, Vector3.up).normalized;
            // Street walk: heroes run 0.9 m/s, a streamer walks ~1.3 m/s, so the party drifts behind the lens and
            // vanished from the stream until 6 m. While following, one that is 3.5 m+ behind the phone hops ahead.
            bool behind = following && dist > 3.5f && Vector3.Dot(hero.transform.position - floor, flat) < 0f;
            if (dist < 6f && !behind && !(following && hero.Stuck && dist > 2.5f)) return;
            var c = Random.insideUnitCircle * 0.4f;
            if (room.Sample(floor + flat * (following ? 1.5f : 1.0f) + new Vector3(c.x, 0f, c.y), 0.6f, out var to)) hero.RiftHop(to);
        }

        Vector3 StagePoint(HeroState s) => _origin + _right * ((s.X - 0.5f) * 1.4f) + _away * ((0.5f - s.Y) * 1.0f);

        /// <summary>Formation slot around [center]: rows of four, 28 cm apart, facing the camera.</summary>
        Vector3 Slot(Vector3 center, int i)
        {
            var cam = arCamera.transform.position;
            var toward = Vector3.ProjectOnPlane(cam - center, Vector3.up);
            toward = toward.sqrMagnitude > 1e-4f ? toward.normalized : -_away;
            var side = Vector3.Cross(Vector3.up, toward);
            int row = i / 4, col = i % 4;
            return center + side * ((col - 1.5f) * 0.28f) - toward * (row * 0.3f);
        }

        Vector3 FollowSlot(int i)
        {
            var cam = arCamera.transform;
            if (trail.PartyGoal(out var site) && (site - cam.position).magnitude < 3.5f) return Slot(site, i);
            FollowCenter(out var center);
            return Slot(center, i);
        }

        /// <summary>Where the following party walks: 1.5 m ahead of the phone on the floor, so on a portrait stream
        /// the heroes stay in frame (~150 px tall at 720p) instead of crowding the lens at 0.9 m.</summary>
        bool FollowCenter(out Vector3 center)
        {
            var cam = arCamera.transform;
            var flat = Vector3.ProjectOnPlane(cam.forward, Vector3.up);
            flat = flat.sqrMagnitude > 1e-4f ? flat.normalized : _away;
            float floorY = room.FloorY ?? cam.position.y - 1.3f;
            var ahead = cam.position + flat * 1.5f;
            ahead.y = floorY;
            if (room.Sample(ahead, 0.8f, out center)) return true;
            var nearer = cam.position + flat * 0.9f;
            nearer.y = floorY;
            if (room.Sample(nearer, 0.8f, out center)) return true;
            return room.Sample(new Vector3(cam.position.x, floorY, cam.position.z), 1.2f, out center);
        }

        void ClearHeroes()
        {
            _selfieReturn.Clear(); // SELFIE: demo/server resets also clear deferred return placements.
            foreach (var h in _heroes.Values) Destroy(h.gameObject);
            _heroes.Clear();
            _cheerSerial.Clear();
        }

        /// <summary>While scanning (or with Scan on) the room mesh glows so you see what the phone has
        /// measured. Otherwise it is an invisible depth-only occluder: heroes hide behind the bed.</summary>
        void UpdateRoomMaterials()
        {
            if (meshManager == null || Time.time < _nextMaterialPass) return;
            _nextMaterialPass = Time.time + 0.5f;
            if (_scanMaterial == null || _occluderMaterial == null) return;
            if (_paintMaterial == null) _paintMaterial = Resources.Load<Material>("Materials/RiftPaint");
            // Scan view: glowing grid. Otherwise the mesh is invisible depth (hides heroes behind furniture)
            // plus the Rift paint, which only shows near an open rift (a second material redraws the mesh).
            var mats = _scanMode == 0 ? new[] { _scanMaterial }
                : _paintMaterial != null ? new[] { _occluderMaterial, _paintMaterial } : new[] { _occluderMaterial };
            foreach (var filter in meshManager.meshes)
            {
                if (filter == null) continue;
                var r = filter.GetComponent<MeshRenderer>();
                if (r != null && (r.sharedMaterials.Length != mats.Length || r.sharedMaterial != mats[0])) r.sharedMaterials = mats;
            }
        }

        void UpdateHud(WorldState world, bool tracking)
        {
            string source = _live ? server.Status : "Offline test room";
            if (stream != null && stream.Active) source += " · " + stream.Status;
            string scan = room.MeshCount > 0 ? $"3D map · {room.MeshCount} pieces"
                : room.HasMeshing ? $"3D map starting · planes {room.PlaneCount}" : $"planes only {room.PlaneCount} · no 3D map";
            string floor = room.FloorY.HasValue ? $"floor {arCamera.transform.position.y - room.FloorY.Value:0.0} m below" : "floor ?";
            string seen = "";
            if (surfaceLabels != null && surfaceLabels.Things.Count > 0)
            {
                var names = new List<string>();
                foreach (var th in surfaceLabels.Things) if (th.confidence >= 0.3f && !names.Contains(th.label)) names.Add(th.label);
                if (names.Count > 0) seen = "\nsees: " + string.Join(", ", names.Take(6));
            }
            else if (detector != null && detector.Ready) seen = $"\nlooking for objects · {detector.LastInferenceMs:0} ms";
            string status = $"{source}\n{scan} · {floor} · nav {(room.HasNavMesh ? "ready" : "…")} · {_heroes.Count} heroes{seen}";
            string hint;
            if (!tracking) hint = "Move the phone slowly to start tracking";
            else if (!room.HasNavMesh) hint = "Scanning · sweep the phone over the floor and furniture";
            else if (!_landed) hint = _candidate.HasValue ? "Landing spot found · hold still" : "Point at open floor ~1 m ahead · or tap the floor";
            else if (trail.Current != RiftTrail.Phase.Off) hint = $"Rift Trail {trail.Collected}/3 · {trail.Hint}";
            else if (_heroes.Values.Any(h => h.Stuck)) hint = "A hero can't reach its spot · scan the floor between";
            else if (world.Heroes.Count == 0) hint = _liveMode ? "Live · waiting for viewers to type !join" : "Tap the orb to start a test raid"; // no orb while live
            else hint = "";
            // Short context line for the account chip; the long diagnostics go to the Setup sheet.
            string where = world.Raid != null ? (world.Raid.Test ? "Test raid" : "Raid from " + world.Raid.From) : (_live ? "Paired · demo" : "Offline demo");
            var title = $"{where} · {_heroes.Count} {(_heroes.Count == 1 ? "hero" : "heroes")}";
            hud.SetStatus(title, $"v{Application.version} · {status}", hint);
            // Mapping progress chip: tracking → mesh pieces → walkable map → landing spot.
            float progress;
            string label;
            if (_landed) { progress = 1f; label = ""; }
            else if (!tracking) { progress = 0.05f; label = "Finding your room"; }
            else if (!room.HasNavMesh) { progress = 0.1f + 0.5f * Mathf.Clamp01(room.MeshCount / 30f); label = "Scanning"; }
            else { progress = _candidate.HasValue ? 0.9f : 0.7f; label = _candidate.HasValue ? "Locking landing spot" : "Find open floor"; }
            hud.SetScan(progress, label);
            hud.SetFeed(UseServer ? _serverLines : _playground.Messages);
            WorldTags.Update(arCamera, _heroes.Values); // in the 3D scene, so names are on the broadcast too
        }
    }
}
