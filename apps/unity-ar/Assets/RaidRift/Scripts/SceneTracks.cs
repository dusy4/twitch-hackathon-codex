using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.AI;
using UnityEngine.Experimental.Rendering;
using UnityEngine.Rendering;
using UnityEngine.XR.ARFoundation;

namespace RaidRift
{
    /// <summary>
    /// What the LLM planner can point at, and where those things are in the room.
    /// Publishes phone tracks to the server every 0.4 s (TTL there is 1.2 s):
    ///   "there"          — the scanned spot under the screen centre (what the streamer points at),
    ///   "streamer"       — the floor under the phone,
    ///   "portal"         — the rift window,
    ///   "furniture top"  — raised walkable surfaces from the 3D map (bed, sofa, chair seat).
    /// Sends a downscaled JPEG of the displayed camera view every ~1.5 s to the server's open-vocabulary
    /// detector; the server's boxes (with the frameId) are lifted into 3D using the camera pose stored for
    /// that frame and a ray cast onto the walkable surfaces, then re-posted so they stay fresh.
    /// Heroes resolve the planner's target id to a world point through <see cref="TryWorld"/>.
    /// </summary>
    public class SceneTracks : MonoBehaviour
    {
        public Camera arCamera;
        public ServerConnection server;
        public RoomNavigation room;
        public SurfaceLabels labels;
        public bool active;
        public Vector3? Portal { get; set; }

        struct Capture { public Matrix4x4 camToWorld, projection; public float time; }
        readonly Dictionary<string, Capture> _captures = new Dictionary<string, Capture>();
        readonly Dictionary<string, (Vector3 pos, float seen)> _world = new Dictionary<string, (Vector3, float)>();
        readonly Dictionary<string, (string cls, string frame)> _serverMeta = new Dictionary<string, (string, string)>();
        float _nextPost, _nextFrame;
        int _frameSerial;
        ARCameraBackground _background;
        RenderTexture _frameRt;
        CommandBuffer _captureCommands;
        Camera _captureCamera;
        string _queuedFrame;
        int _queuedW, _queuedH;
        float _queuedAt;
        uint _generation;
        // Textures replaced while a readback may still read them: released once their requests finish.
        readonly Dictionary<RenderTexture, int> _pendingReads = new Dictionary<RenderTexture, int>();
        readonly List<RenderTexture> _retired = new List<RenderTexture>();
        // JPEG encoding runs on a worker thread; uploads go back through the main thread.
        readonly ConcurrentQueue<(string frame, byte[] jpg, int w, int h, uint gen)> _encoded = new ConcurrentQueue<(string, byte[], int, int, uint)>();

        // Phone tracks are re-posted every 0.4 s; anything not refreshed within this is gone from the room.
        const float PhoneTtl = 2.5f, ServerTtl = 20f;

        public bool TryWorld(string id, out Vector3 p)
        {
            p = default;
            if (string.IsNullOrEmpty(id) || !_world.TryGetValue(id, out var e)) return false;
            if (Time.time - e.seen > (_serverMeta.ContainsKey(id) ? ServerTtl : PhoneTtl)) return false;
            p = e.pos;
            return true;
        }

        /// <summary>New room: forget every target, capture and in-flight frame from the previous one.</summary>
        public void ResetScene()
        {
            unchecked { _generation++; }
            _captures.Clear();
            _world.Clear();
            _serverMeta.Clear();
            while (_encoded.TryDequeue(out _)) { }
            ClearSpots();
        }

        /// <summary>Server detections from the latest world snapshot: lift new ones into the room.</summary>
        public void Ingest(WorldState world)
        {
            if (world == null) return;
            foreach (var t in world.Tracks)
            {
                if (t.Source != "server" || t.FrameId == null) continue;
                // Known detection: only re-lift when the server saw it again in a newer frame.
                if (_serverMeta.TryGetValue(t.Id, out var meta) && meta.frame == t.FrameId) continue;
                if (!_captures.TryGetValue(t.FrameId, out var cap)) continue;
                // Bottom-centre of the box = where the object meets the floor/furniture.
                var vp = new Vector2(t.Box[0] + t.Box[2] / 2f, 1f - (t.Box[1] + t.Box[3]));
                if (CastOnWalkable(RayFrom(cap, vp), out var hit))
                {
                    _world[t.Id] = (hit, Time.time);
                    _serverMeta[t.Id] = (t.Class, t.FrameId);
                }
            }
        }

        void OnEnable()
        {
            Camera.onPreRender += BeforeCameraRender;
            Camera.onPostRender += AfterCameraRender;
        }

        void OnDisable()
        {
            Camera.onPreRender -= BeforeCameraRender;
            Camera.onPostRender -= AfterCameraRender;
            RemoveCaptureCommands();
        }

        /// <summary>Seconds between camera JPEGs for the server detector. RaidRiftApp raises it while broadcasting
        /// so the uploads don't compete with the Twitch uplink on mobile data.</summary>
        public float frameInterval = 1.5f;

        void Update()
        {
            while (_encoded.TryDequeue(out var e))
                if (e.gen == _generation && server != null) server.PostFrame(e.frame, e.jpg, e.w, e.h);
            if (!active || server == null || !server.Connected || arCamera == null) return;
            if (Time.time >= _nextPost) { _nextPost = Time.time + 0.4f; PublishTracks(); }
            if (Time.time >= _nextFrame) { _nextFrame = Time.time + frameInterval; SendFrame(); }
        }

        void PublishTracks()
        {
            var list = new JArray();
            float now = Time.time;
            ExpireWorld(now);
            var cam = arCamera.transform;
            if (CastOnWalkable(arCamera.ViewportPointToRay(new Vector3(0.5f, 0.5f, 0f)), out var there)) // the middle of what viewers see
                Add(list, "ph-there-1", "there", there, now);
            if (room.FloorUnderCamera(out var me)) Add(list, "ph-streamer-1", "streamer", me, now, clampOffscreen: true);
            if (Portal.HasValue) Add(list, "ph-portal-1", "portal", Portal.Value, now);
            // Nearest raised surfaces the camera can see.
            int n = 0;
            var tops = new List<Vector3>(room.Tops);
            tops.Sort((a, b) => (a - cam.position).sqrMagnitude.CompareTo((b - cam.position).sqrMagnitude));
            foreach (var t in tops)
            {
                var v = arCamera.WorldToViewportPoint(t);
                if (v.z <= 0f || v.x < 0f || v.x > 1f || v.y < 0f || v.y > 1f) continue;
                Add(list, $"ph-furniture-top-{++n}", "furniture top", t, now);
                if (n >= 3) break;
            }
            // Recognised objects/surfaces from the on-device detector, by name ("!sit on the sofa").
            if (labels != null)
            {
                int k = 0;
                foreach (var th in labels.Things)
                    if (th.confidence >= 0.3f && k++ < 12) Add(list, $"ph-obj-{th.id}", th.label, th.pos, now);
            }
            // Numbered on-stream markers: chat can't point, so viewers say "!go to 3".
            UpdateSpots(now);
            foreach (var s in _spots) Add(list, $"ph-spot-{s.n}", $"spot {s.n}", s.pos, now);
            // Re-post server detections we have anchored, with boxes re-projected for the current view.
            foreach (var kv in _serverMeta)
                if (_world.TryGetValue(kv.Key, out var e) && now - e.seen < 20f)
                    Add(list, kv.Key, kv.Value.cls, e.pos, now, source: "server", frameId: kv.Value.frame, keepAlive: true);
            if (list.Count > 0) server.PostTracks(list);
        }

        readonly List<string> _expired = new List<string>();

        void ExpireWorld(float now)
        {
            _expired.Clear();
            foreach (var kv in _world)
                if (now - kv.Value.seen > (_serverMeta.ContainsKey(kv.Key) ? ServerTtl : PhoneTtl)) _expired.Add(kv.Key);
            foreach (var id in _expired) { _world.Remove(id); _serverMeta.Remove(id); }
        }

        void Add(JArray list, string id, string cls, Vector3 world, float now, bool clampOffscreen = false,
            string source = "phone", string frameId = null, bool keepAlive = false)
        {
            if (!keepAlive) _world[id] = (world, now);
            var v = arCamera.WorldToViewportPoint(world);
            if (v.z <= 0f && !clampOffscreen) return;
            float x = Mathf.Clamp01(v.x), yTop = Mathf.Clamp01(1f - v.y);
            // A rough 30 cm-tall box standing on the point, in screen space.
            var head = arCamera.WorldToViewportPoint(world + Vector3.up * 0.3f);
            float h = Mathf.Clamp(Mathf.Abs(head.y - v.y), 0.02f, 0.5f), w = Mathf.Clamp(h * 0.8f, 0.02f, 0.5f);
            float bx = Mathf.Clamp(x - w / 2f, 0f, 1f - w), by = Mathf.Clamp(yTop - h, 0f, 1f - h);
            var t = new JObject
            {
                ["id"] = id, ["class"] = cls, ["attributes"] = new JArray(), ["confidence"] = 0.95,
                ["box"] = new JArray(Round(bx), Round(by), Round(w), Round(h)),
                ["anchor"] = new JArray(Round(x), Round(yTop)),
                ["seenAt"] = System.DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            };
            if (source == "server") { t["source"] = "server"; if (frameId != null) t["frameId"] = frameId; }
            list.Add(t);
        }

        // ---------------- numbered spot markers ----------------
        class Spot { public int n; public Vector3 pos; public GameObject marker; public float lastSeen; public string label; public TextMesh text; }
        readonly List<Spot> _spots = new List<Spot>();
        float _nextSpotRefresh;
        public bool showSpots = true;
        static readonly Vector2[] SpotSamples =
        {
            new Vector2(0.2f, 0.22f), new Vector2(0.5f, 0.2f), new Vector2(0.8f, 0.22f),
            new Vector2(0.3f, 0.38f), new Vector2(0.7f, 0.38f), new Vector2(0.5f, 0.5f),
        };

        bool InView(Vector3 p)
        {
            var v = arCamera.WorldToViewportPoint(p);
            return v.z > 0.2f && v.x > 0.05f && v.x < 0.95f && v.y > 0.12f && v.y < 0.85f;
        }

        void UpdateSpots(float now)
        {
            // Keep numbers stable: a spot keeps its number while it stays (or briefly leaves) view.
            for (int i = _spots.Count - 1; i >= 0; i--)
            {
                var s = _spots[i];
                if (InView(s.pos)) s.lastSeen = now;
                if (now - s.lastSeen > 4f) { Destroy(s.marker); _spots.RemoveAt(i); }
            }
            foreach (var s in _spots) if (s.marker != null) s.marker.SetActive(showSpots);
            if (now < _nextSpotRefresh) return;
            _nextSpotRefresh = now + 1.5f;
            // Name spots that sit on a recognised object ("3 · sofa"), even when all markers are taken.
            if (labels != null)
                foreach (var s in _spots)
                    foreach (var th in labels.Things)
                        if (th.confidence >= 0.3f && (th.pos - s.pos).magnitude < 0.45f && s.label != th.label) { s.label = th.label; if (s.text != null) s.text.text = $"{s.n}\n<size=40>{th.label}</size>"; }
            // Full: a newly recognised object replaces the oldest unnamed floor spot, so the sofa gets a number.
            if (_spots.Count >= 6 && labels != null)
                foreach (var th in labels.Things)
                {
                    if (th.confidence < 0.3f || !InView(th.pos) || _spots.Exists(s => (s.pos - th.pos).magnitude < 0.6f)) continue;
                    var generic = _spots.Find(s => s.label == null);
                    if (generic == null) break;
                    Destroy(generic.marker);
                    _spots.Remove(generic);
                    int fresh = 1; // never hand the replaced spot's number to a different place
                    while (fresh == generic.n || _spots.Exists(s => s.n == fresh)) fresh++;
                    var m = Marker(fresh, th.pos, th.label);
                    _spots.Add(new Spot { n = fresh, pos = th.pos, lastSeen = now, marker = m, label = th.label, text = m.GetComponentInChildren<TextMesh>() });
                }
            if (_spots.Count >= 6) return;
            var candidates = new List<(Vector3 pos, string label)>();
            if (labels != null) foreach (var th in labels.Things) if (th.confidence >= 0.3f && InView(th.pos)) candidates.Add((th.pos, th.label)); // recognised first
            foreach (var t in room.Tops) if (InView(t)) candidates.Add((t, null));              // then furniture tops: jumpable
            foreach (var kv in _serverMeta) if (_world.TryGetValue(kv.Key, out var e) && InView(e.pos)) candidates.Add((e.pos, kv.Value.cls));
            foreach (var vp in SpotSamples)
                if (CastOnWalkable(arCamera.ViewportPointToRay(new Vector3(vp.x, vp.y, 0f)), out var p) && InView(p)) candidates.Add((p, null));
            foreach (var c in candidates)
            {
                if (_spots.Count >= 6) break;
                bool spaced = true;
                foreach (var s in _spots) if ((s.pos - c.pos).magnitude < 0.6f) { spaced = false; break; }
                if (!spaced) continue;
                int n = 1;
                while (_spots.Exists(s => s.n == n)) n++;
                var marker = Marker(n, c.pos, c.label);
                _spots.Add(new Spot { n = n, pos = c.pos, lastSeen = now, marker = marker, label = c.label, text = marker.GetComponentInChildren<TextMesh>() });
            }
        }

        static Font _font;

        GameObject Marker(int n, Vector3 pos, string label = null)
        {
            var root = new GameObject("Spot " + n);
            root.transform.position = pos + Vector3.up * 0.006f;
            var glow = Resources.Load<Material>("Materials/Glow");
            var ring = GameObject.CreatePrimitive(PrimitiveType.Quad);
            Destroy(ring.GetComponent<Collider>());
            ring.transform.SetParent(root.transform, false);
            ring.transform.localRotation = Quaternion.Euler(90f, 0f, 0f);
            ring.transform.localScale = Vector3.one * 0.16f;
            var r = ring.GetComponent<Renderer>();
            r.sharedMaterial = glow;
            var block = new MaterialPropertyBlock();
            block.SetColor("_Color", new Color(0.55f, 1f, 0.88f, 0.8f));
            r.SetPropertyBlock(block);
            var badge = new GameObject("Number");
            badge.transform.SetParent(root.transform, false);
            badge.transform.localPosition = new Vector3(0f, 0.17f, 0f);
            var disc = GameObject.CreatePrimitive(PrimitiveType.Quad);
            Destroy(disc.GetComponent<Collider>());
            disc.transform.SetParent(badge.transform, false);
            disc.transform.localScale = Vector3.one * 0.12f; // AR review #2: big screen-constant badges looked stuck on the lens
            disc.transform.localPosition = new Vector3(0f, 0f, 0.002f);
            var dr = disc.GetComponent<Renderer>();
            dr.sharedMaterial = Resources.Load<Material>("Materials/BlobShadow");
            var db = new MaterialPropertyBlock();
            db.SetFloat("_Strength", 0.9f);
            dr.SetPropertyBlock(db);
            if (_font == null) _font = Resources.Load<Font>("Fonts/SpaceGrotesk-Bold") ?? Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            var text = badge.AddComponent<TextMesh>();
            text.font = _font;
            text.text = label == null ? n.ToString() : $"{n}\n<size=40>{label}</size>";
            text.richText = true;
            text.fontSize = 96;
            text.characterSize = 0.0065f; // fx-spots preview: viewers must read it on a 720p stream to type "!go to 3"
            text.anchor = TextAnchor.MiddleCenter;
            text.alignment = TextAlignment.Center;
            text.fontStyle = FontStyle.Normal; // the font itself is bold
            text.color = new Color(0.75f, 1f, 0.92f);
            badge.GetComponent<MeshRenderer>().sharedMaterial = _font.material;
            root.AddComponent<SpotBillboard>().badge = badge.transform;
            return root;
        }

        /// <summary>Number badge faces the camera and bobs; the ring pulses.</summary>
        class SpotBillboard : MonoBehaviour
        {
            public Transform badge;
            float _seed;
            void Awake() => _seed = Random.value * 10f;
            void LateUpdate()
            {
                var cam = Camera.main;
                if (cam == null || badge == null) return;
                badge.rotation = Quaternion.LookRotation(badge.position - cam.transform.position, Vector3.up);
                // Far spots keep a readable size on stream (like name tags), capped so near ones stay small.
                float dist = (badge.position - cam.transform.position).magnitude;
                badge.localScale = Vector3.one * Mathf.Clamp(dist / 1.4f, 1f, 1.3f); // keep perspective so markers sit in the room
                badge.localPosition = new Vector3(0f, 0.1f + 0.1f * badge.localScale.y + Mathf.Sin(Time.time * 2f + _seed) * 0.012f, 0f);
                transform.GetChild(0).localScale = Vector3.one * (0.15f + Mathf.Sin(Time.time * 3f + _seed) * 0.015f);
            }
        }

        /// <summary>Lowest numbered spot whose marker is showing now (0 = none): the stream caption names a real one.</summary>
        public int ShownSpot
        {
            get
            {
                int best = 0;
                if (!showSpots) return 0;
                foreach (var s in _spots) if (s.marker != null && s.marker.activeInHierarchy && (best == 0 || s.n < best)) best = s.n;
                return best;
            }
        }

        public void ClearSpots()
        {
            foreach (var s in _spots) if (s.marker != null) Destroy(s.marker);
            _spots.Clear();
        }

        static double Round(float f) => System.Math.Round(Mathf.Clamp01(f), 4);

        static Ray RayFrom(Capture cap, Vector2 viewport)
        {
            var ndc = new Vector3(viewport.x * 2f - 1f, viewport.y * 2f - 1f, 1f);
            var viewPoint = cap.projection.inverse.MultiplyPoint(ndc);
            var origin = cap.camToWorld.MultiplyPoint(Vector3.zero);
            var dir = cap.camToWorld.MultiplyVector(viewPoint).normalized;
            return new Ray(origin, dir);
        }

        /// <summary>First walkable point (floor or furniture top) along the ray, within 6 m.</summary>
        bool CastOnWalkable(Ray ray, out Vector3 hit)
        {
            // Fast path: intersect the known walkable heights (~10 NavMesh queries instead of ~140).
            if (room.CastWalkable(ray, out hit)) return true;
            if (room.FloorY.HasValue) return false;
            // No floor estimate yet: coarse march.
            var filter = new NavMeshQueryFilter { agentTypeID = room.AgentTypeId, areaMask = NavMesh.AllAreas };
            for (float d = 0.3f; d < 6f; d += 0.08f)
            {
                var p = ray.GetPoint(d);
                if (NavMesh.SamplePosition(p, out var s, 0.05f, filter)) { hit = s.position; return true; }
                if (room.FloorY.HasValue && p.y < room.FloorY.Value - 0.1f)
                    return room.Sample(new Vector3(p.x, room.FloorY.Value, p.z), 0.3f, out hit);
            }
            return false;
        }

        /// <summary>Copies exactly what the screen shows of the camera (ARCameraBackground material: same crop
        /// and rotation), so the server's boxes map straight back to viewport coordinates. The copy is queued
        /// in the camera's render after ARFoundation's background pass (which waits on ARCore's frame fence),
        /// so the pixels belong to the pose recorded with them.</summary>
        void SendFrame()
        {
            if (_background == null) _background = arCamera.GetComponent<ARCameraBackground>();
            if (_queuedFrame != null && Time.time - _queuedAt < 3f) return; // still waiting for the camera to render
            if (_background == null || _background.material == null) return;
            _queuedW = 480;
            _queuedH = Mathf.Max(1, Mathf.RoundToInt(480f * Screen.height / Mathf.Max(1, Screen.width)));
            _queuedFrame = $"f-{System.DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}-{++_frameSerial}";
            _queuedAt = Time.time;
        }

        void BeforeCameraRender(Camera camera)
        {
            if (_queuedFrame == null || camera != arCamera || _captureCamera != null) return;
            if (_background == null || !_background.isActiveAndEnabled || _background.material == null) { _queuedFrame = null; return; }
            if (_frameRt == null || _frameRt.height != _queuedH)
            {
                Retire(_frameRt);
                _frameRt = new RenderTexture(_queuedW, _queuedH, 0, RenderTextureFormat.ARGB32) { name = "Scene frame" };
            }
            _captures[_queuedFrame] = new Capture { camToWorld = camera.cameraToWorldMatrix /* OpenGL view space, -Z forward, same as projectionMatrix */, projection = camera.projectionMatrix, time = Time.time };
            if (_captures.Count > 12)
            {
                string oldest = null; float t = float.MaxValue;
                foreach (var kv in _captures) if (kv.Value.time < t) { t = kv.Value.time; oldest = kv.Key; }
                if (oldest != null) _captures.Remove(oldest);
            }
            if (_captureCommands == null) _captureCommands = new CommandBuffer { name = "Scene frame capture" };
            _captureCommands.Clear();
            _captureCommands.Blit((Texture)null, _frameRt, _background.material);
            _captureCommands.SetRenderTarget(BuiltinRenderTextureType.CameraTarget);
            _captureCamera = camera;
            camera.AddCommandBuffer(CameraEvent.AfterForwardOpaque, _captureCommands);
        }

        void AfterCameraRender(Camera camera)
        {
            if (_captureCamera == null || camera != _captureCamera) return;
            RemoveCaptureCommands();
            string frameId = _queuedFrame;
            _queuedFrame = null;
            if (frameId == null || _frameRt == null) return;
            var rt = _frameRt;
            int w = rt.width, h = rt.height;
            uint gen = _generation;
            _pendingReads[rt] = (_pendingReads.TryGetValue(rt, out var n) ? n : 0) + 1;
            AsyncGPUReadback.Request(rt, 0, TextureFormat.RGBA32, req =>
            {
                FinishRead(rt);
                if (req.hasError || gen != _generation) return;
                // The readback buffer is only valid inside this callback: copy, then encode off the main thread.
                var rgba = req.GetData<byte>().ToArray();
                Task.Run(() =>
                {
                    try
                    {
                        var jpg = ImageConversion.EncodeArrayToJPG(rgba, GraphicsFormat.R8G8B8A8_UNorm, (uint)w, (uint)h, 0, 70);
                        _encoded.Enqueue((frameId, jpg, w, h, gen));
                    }
                    catch (System.Exception e) { Debug.LogWarning("[RaidRift] frame encode failed: " + e.Message); }
                });
            });
        }

        void RemoveCaptureCommands()
        {
            if (_captureCamera != null && _captureCommands != null)
                _captureCamera.RemoveCommandBuffer(CameraEvent.AfterForwardOpaque, _captureCommands);
            _captureCamera = null;
        }

        void Retire(RenderTexture rt)
        {
            if (rt == null) return;
            if (_pendingReads.ContainsKey(rt)) _retired.Add(rt);
            else { rt.Release(); Destroy(rt); }
        }

        void FinishRead(RenderTexture rt)
        {
            if (!_pendingReads.TryGetValue(rt, out var n)) return;
            if (n > 1) { _pendingReads[rt] = n - 1; return; }
            _pendingReads.Remove(rt);
            if (_retired.Remove(rt) && rt != null) { rt.Release(); Destroy(rt); }
        }

        void OnDestroy()
        {
            RemoveCaptureCommands();
            _captureCommands?.Release();
            Retire(_frameRt);
            _frameRt = null;
        }
    }
}
