using System.Collections.Generic;
using UnityEngine;
using UnityEngine.AI;

namespace RaidRift
{
    /// <summary>
    /// Object understanding fused into the 3D map. Each on-device detection (ObjectDetector, YOLOX COCO) is
    /// lifted into the room with the camera pose of the frame it came from: a 5x5 grid of rays through the
    /// box is cast onto the walkable NavMesh. For furniture (bed, sofa, chair, table, bench) the raised hits
    /// are its top/seat — a place heroes can jump onto and sit; for everything else (person, dog, cat, bottle,
    /// plant, tv…) the floor point under the box is where it stands. Repeated sightings of the same object
    /// merge (running average, confidence grows); furniture is remembered ~60 s, moving things a few seconds.
    /// </summary>
    public class SurfaceLabels : MonoBehaviour
    {
        public class Thing
        {
            public int id;
            public string label;        // friendly: "bed", "sofa", "chair", "table", "person", "dog"…
            public Vector3 pos;         // walkable point: seat/top for furniture, floor beside it otherwise
            public bool raised;         // pos is ON the furniture (jump target), not beside it
            public float confidence;    // grows with repeated sightings, 0..1
            public float lastSeen;
            public int sightings;
        }

        public RoomNavigation room;
        public ObjectDetector detector;
        public readonly List<Thing> Things = new List<Thing>();
        public int Frames { get; private set; }
        int _nextId = 1;

        static readonly Dictionary<string, string> Friendly = new Dictionary<string, string>
        {
            { "couch", "sofa" }, { "dining table", "table" }, { "tv", "tv" }, { "tvmonitor", "tv" }, { "potted plant", "plant" },
            { "cell phone", "phone" }, { "sports ball", "ball" }, { "teddy bear", "teddy bear" },
        };
        static readonly HashSet<string> Furniture = new HashSet<string> { "bed", "sofa", "chair", "table", "bench", "toilet" };
        static readonly HashSet<string> Moving = new HashSet<string> { "person", "dog", "cat", "bird", "ball" };
        // Allow-list of things that matter in a streamer's room/street; everything else (scissors, airplane…) is noise.
        static readonly HashSet<string> Allow = new HashSet<string> { "person", "dog", "cat", "bird", "chair", "sofa", "bed", "table", "toilet", "bench", "tv", "laptop", "plant", "bottle", "cup", "teddy bear", "ball", "backpack", "suitcase", "umbrella", "car", "bicycle", "skateboard" };

        void OnEnable() { if (detector != null) detector.OnDetections += OnDetections; }
        void Update() => Expire(Time.time);

        public void Clear() { Things.Clear(); }
        void OnDisable() { if (detector != null) detector.OnDetections -= OnDetections; }

        public static string FriendlyName(string coco) => Friendly.TryGetValue(coco, out var f) ? f : coco;

        void OnDetections(IReadOnlyList<Detection> detections, Matrix4x4 camToWorld, Matrix4x4 projection)
        {
            Frames++;
            Ingest(detections, camToWorld, projection, Time.time);
        }

        /// <summary>Public for the self-test: fuse one frame of detections.</summary>
        public void Ingest(IReadOnlyList<Detection> detections, Matrix4x4 camToWorld, Matrix4x4 projection, float now)
        {
            if (room == null || !room.HasNavMesh) return;
            float floor = room.FloorY ?? (camToWorld.MultiplyPoint(Vector3.zero).y - 1.3f);
            var filter = new NavMeshQueryFilter { agentTypeID = room.AgentTypeId, areaMask = NavMesh.AllAreas };
            foreach (var d in detections)
            {
                var label = FriendlyName(d.label);
                // Furniture is big and reliable; small things need more evidence before heroes treat them as real.
                if (!Allow.Contains(label) || d.score < (Furniture.Contains(label) || label == "person" ? 0.35f : 0.45f)) continue;
                bool furniture = Furniture.Contains(label);
                Vector3? best = null;
                bool raised = false;
                if (furniture)
                {
                    // Raised walkable hits inside the box = the top/seat. Median of them, robust to strays.
                    var tops = new List<Vector3>();
                    for (int gx = 0; gx < 5; gx++)
                        for (int gy = 0; gy < 5; gy++)
                        {
                            var vp = new Vector2(d.viewport.xMin + d.viewport.width * (0.1f + 0.2f * gx), d.viewport.yMin + d.viewport.height * (0.1f + 0.2f * gy));
                            if (room.CastWalkable(Ray(camToWorld, projection, vp), out var hit) && hit.y > floor + 0.15f && hit.y < floor + 1.1f) tops.Add(hit);
                        }
                    if (tops.Count >= 2) { best = SeatPoint(tops); raised = true; }
                }
                if (!best.HasValue)
                {
                    // Where it meets the floor: bottom-centre of the box, then nearest floor point.
                    var bottom = new Vector2(d.viewport.center.x, d.viewport.yMin + d.viewport.height * 0.05f);
                    // Moving things and floor fallbacks must really be on the floor (not a sofa cushion behind them).
                    if (room.CastWalkable(Ray(camToWorld, projection, bottom), out var hit) && Mathf.Abs(hit.y - floor) < 0.08f) best = hit;
                    else if (room.CastWalkable(Ray(camToWorld, projection, bottom), out hit) && room.Sample(new Vector3(hit.x, floor, hit.z), 0.35f, out var below) && Mathf.Abs(below.y - floor) < 0.08f) best = below;
                }
                if (!best.HasValue) continue;
                Merge(label, best.Value, raised, d.score, now);
            }
            Expire(now);
        }

        void Merge(string label, Vector3 pos, bool raised, float score, float now)
        {
            Thing match = null;
            float bestDist = Moving.Contains(label) ? 1.2f : 0.6f;
            foreach (var t in Things)
            {
                if (t.label != label) continue;
                float dist = Vector3.Distance(t.pos, pos);
                if (dist < bestDist) { bestDist = dist; match = t; }
            }
            if (match == null)
            {
                Things.Add(new Thing { id = _nextId++, label = label, pos = pos, raised = raised, confidence = score * 0.5f, lastSeen = now, sightings = 1 });
                return;
            }
            // Raised (on-top) evidence beats floor-beside evidence for furniture.
            if (raised && !match.raised) { match.pos = pos; match.raised = true; }
            else if (raised == match.raised)
            {
                // Smooth, then snap back onto the walkable surface so the target is never in mid-air.
                var blended = Vector3.Lerp(match.pos, pos, Moving.Contains(label) ? 0.6f : 0.25f);
                match.pos = room.Sample(blended, 0.12f, out var onMesh) && Mathf.Abs(onMesh.y - pos.y) < 0.06f ? onMesh : pos;
            }
            match.confidence = Mathf.Min(1f, match.confidence + score * 0.25f);
            match.lastSeen = now;
            match.sightings++;
        }

        void Expire(float now)
        {
            Things.RemoveAll(t => now - t.lastSeen > (Moving.Contains(t.label) ? 4f : 60f));
        }

        /// <summary>Best match for a heard word ("sofa", "couch", "bed"), nearest to [from].</summary>
        public Thing Find(string label, Vector3 from)
        {
            Thing best = null;
            float d = float.MaxValue;
            foreach (var t in Things)
            {
                if (t.label != label || t.confidence < 0.3f) continue;
                float dd = (t.pos - from).sqrMagnitude;
                if (dd < d) { d = dd; best = t; }
            }
            return best;
        }

        public static bool IsSeat(Thing t) => t.raised && IsSeat(t.label);
        public static bool IsSeat(string label) => label == "sofa" || label == "chair" || label == "bed" || label == "bench";

        static Ray Ray(Matrix4x4 camToWorld, Matrix4x4 projection, Vector2 viewport)
        {
            var ndc = new Vector3(viewport.x * 2f - 1f, viewport.y * 2f - 1f, 1f);
            var viewPoint = projection.inverse.MultiplyPoint(ndc);
            return new Ray(camToWorld.MultiplyPoint(Vector3.zero), camToWorld.MultiplyVector(viewPoint).normalized);
        }

        static bool Cast(Ray ray, NavMeshQueryFilter filter, out Vector3 hit)
        {
            hit = default;
            for (float d = 0.25f; d < 6f; d += 0.035f)
                if (NavMesh.SamplePosition(ray.GetPoint(d), out var s, 0.045f, filter)) { hit = s.position; return true; }
            return false;
        }

        /// <summary>Largest height cluster of seat/top hits (6 cm), then the real hit nearest its centre:
        /// a chair back, armrest or background floor can't drag the target into empty space.</summary>
        static Vector3 SeatPoint(List<Vector3> pts)
        {
            List<Vector3> bestCluster = null;
            foreach (var p in pts)
            {
                var cluster = pts.FindAll(q => Mathf.Abs(q.y - p.y) < 0.06f);
                if (bestCluster == null || cluster.Count > bestCluster.Count) bestCluster = cluster;
            }
            var centre = Median(bestCluster);
            Vector3 pick = bestCluster[0];
            foreach (var p in bestCluster) if ((p - centre).sqrMagnitude < (pick - centre).sqrMagnitude) pick = p;
            return pick;
        }

        static Vector3 Median(List<Vector3> pts)
        {
            float Mid(System.Func<Vector3, float> f) { var v = pts.ConvertAll(p => f(p)); v.Sort(); return v[v.Count / 2]; }
            return new Vector3(Mid(p => p.x), Mid(p => p.y), Mid(p => p.z));
        }
    }
}
