using System.Collections.Generic;
using UnityEngine;
using UnityEngine.AI;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;

namespace RaidRift
{
    /// <summary>
    /// The room as characters see it, the Phanto way: the live scanned room mesh (Niantic Spatial
    /// meshing through ARMeshManager) is baked into a Unity NavMesh around the phone, again and again
    /// as the scan grows. Bed sides and furniture are walls because they are too steep or too tall to
    /// climb; a bed top is its own walkable island. Without meshing (no NSDK) the ARCore planes are
    /// used instead, which is weaker but never invents floor.
    /// </summary>
    public class RoomNavigation : MonoBehaviour
    {
        public ARMeshManager meshManager;
        public ARPlaneManager planeManager;
        public Transform cameraTransform;

        [Tooltip("Half-size of the baked area around the phone, metres.")]
        public Vector3 bakeExtents = new Vector3(7f, 2.5f, 7f);
        [Tooltip("Room-mesh chunks farther than this from the phone are left out of the bake (walking a city).")]
        public float meshRange = 20f;
        public float rebakeInterval = 0.8f;

        public int AgentTypeId => _settings.agentTypeID;
        public bool HasMeshing => meshManager != null && meshManager.enabled && meshManager.subsystem != null && meshManager.subsystem.running;
        public int MeshCount { get; private set; }
        public int PlaneCount { get; private set; }
        public float LastBakeMs { get; private set; }
        public bool HasNavMesh { get; private set; }
        /// <summary>Lowest walkable height seen, metres, world space: the floor.</summary>
        public float? FloorY { get; private set; }

        NavMeshData _data;
        NavMeshDataInstance _instance;
        NavMeshBuildSettings _settings;
        AsyncOperation _pending;
        float _pendingStarted;
        float _nextBake;
        readonly List<NavMeshBuildSource> _sources = new List<NavMeshBuildSource>();
        readonly Dictionary<TrackableId, Mesh> _planeMeshes = new Dictionary<TrackableId, Mesh>();

        void Awake() => Init();

        // SELFIE: the walkable renderer lives outside this hierarchy; retain its mesh while paused.
        public void SetSelfieViewHidden(bool hidden)
        {
            if (_walkableView != null) _walkableView.SetActive(!hidden && showWalkable && HasNavMesh);
        }

        /// <summary>Synchronous bake from explicit sources, for the editor self-test (RoomSelfTest.cs).</summary>
        public int TestBake(List<NavMeshBuildSource> sources, Bounds bounds, float floorY)
        {
            Init();
            FloorY = floorY;
            NavMeshBuilder.UpdateNavMeshData(_data, _settings, sources, bounds);
            var tri = NavMesh.CalculateTriangulation();
            HasNavMesh = tri.indices != null && tri.indices.Length >= 3;
            RebuildJumpLinks(tri);
            RebuildHeights();
            return _links.Count;
        }

        void Init()
        {
            if (_data != null) return;
            // Characters are ~26 cm tall: a doll-sized agent. Climb 5 cm (rug, threshold), never a bed side.
            _settings = NavMesh.CreateSettings();
            _settings.agentRadius = 0.07f;
            _settings.agentHeight = 0.30f;
            // Tuned on the owner's room (newmr2.mp4): the phone mesh has ~3-6 cm floor noise, which at
            // 2.5 cm voxels / 5 cm climb shattered the floor into specks. A bed side (~45 cm) stays a wall.
            _settings.agentClimb = 0.08f;
            _settings.agentSlope = 40f;
            _settings.overrideVoxelSize = true;
            _settings.voxelSize = 0.04f;
            _settings.overrideTileSize = true;
            _settings.tileSize = 64;
            _settings.minRegionArea = 0.08f; // keeps chair seats / ottomans (≥ ~0.45 m), drops scan specks
            _data = new NavMeshData(_settings.agentTypeID);
            _instance = NavMesh.AddNavMeshData(_data);
        }

        void OnDestroy()
        {
            _instance.Remove();
            foreach (var m in _planeMeshes.Values) Destroy(m);
        }

        public void ResetRoom()
        {
            if (meshManager != null) meshManager.DestroyAllMeshes();
            _instance.Remove();
            _data = new NavMeshData(_settings.agentTypeID);
            _instance = NavMesh.AddNavMeshData(_data);
            HasNavMesh = false;
            FloorY = null;
            _planeFloor = _meshFloor = _published = null;
            _floorCandidate = null; _floorVotes = 0;
            foreach (var l in _links) NavMesh.RemoveLink(l);
            _links.Clear();
            _tops.Clear();
            _heights.Clear();
            _pending = null; // an in-flight async bake writes into the old NavMeshData, which is no longer added
        }

        void Update()
        {
            if (_pending != null)
            {
                if (!_pending.isDone) return;
                LastBakeMs = (Time.realtimeSinceStartup - _pendingStarted) * 1000f;
                _pending = null;
                // One triangulation copy per bake, shared by every consumer.
                var tri = NavMesh.CalculateTriangulation();
                HasNavMesh = tri.indices != null && tri.indices.Length >= 3;
                UpdateMeshFloor(tri);
                if (showWalkable) RebuildWalkableView(tri);
                RebuildJumpLinks(tri);
                RebuildHeights();
            }
            if (_walkableView != null) _walkableView.SetActive(showWalkable && HasNavMesh);
            if (Time.time < _nextBake || cameraTransform == null) return;
            _nextBake = Time.time + rebakeInterval;
            CollectSources();
            if (_sources.Count == 0) return;
            var center = cameraTransform.position;
            if (FloorY.HasValue) center.y = FloorY.Value + 0.6f;
            var bounds = new Bounds(center, bakeExtents * 2f);
            _pendingStarted = Time.realtimeSinceStartup;
            _pending = NavMeshBuilder.UpdateNavMeshDataAsync(_data, _settings, _sources, bounds);
        }

        void CollectSources()
        {
            _sources.Clear();
            MeshCount = 0;
            PlaneCount = 0;
            // The floor is the lowest horizontal plane of at least 0.25 m² well below the phone: tiny stray
            // low planes used to drag the floor estimate down and block landing forever (newmr2.mp4).
            float floor = float.MaxValue, floorArea = 0f;
            if (meshManager != null && meshManager.meshes != null)
            {
                foreach (var filter in meshManager.meshes)
                {
                    if (filter == null || filter.sharedMesh == null || filter.sharedMesh.vertexCount < 3) continue;
                    if (cameraTransform != null && (filter.transform.TransformPoint(filter.sharedMesh.bounds.center) - cameraTransform.position).sqrMagnitude > meshRange * meshRange) continue;
                    _sources.Add(new NavMeshBuildSource
                    {
                        shape = NavMeshBuildSourceShape.Mesh,
                        sourceObject = filter.sharedMesh,
                        transform = filter.transform.localToWorldMatrix,
                        area = 0
                    });
                    MeshCount++;
                }
            }
            // Mesh-first (owner 2026-10-31: "the entire app can just be the 3D map"): once the room mesh
            // exists it is the only geometry. ARCore planes are only a fallback when meshing is unavailable;
            // mixing both doubled surfaces a few cm apart.
            if (planeManager != null)
            {
                foreach (var plane in planeManager.trackables)
                {
                    if (plane.alignment != PlaneAlignment.HorizontalUp || plane.trackingState != TrackingState.Tracking) continue;
                    var mesh = PlaneMesh(plane);
                    if (mesh == null) continue;
                    float area = plane.size.x * plane.size.y;
                    float y = plane.transform.position.y;
                    if (cameraTransform != null && cameraTransform.position.y - y > 0.6f && area > 0.25f && y < floor)
                    {
                        floorArea = area;
                        floor = y;
                    }
                    // Planes always measure the floor height (precise), but are walkable geometry only without a mesh.
                    if (MeshCount > 0) continue;
                    _sources.Add(new NavMeshBuildSource
                    {
                        shape = NavMeshBuildSourceShape.Mesh,
                        sourceObject = mesh,
                        transform = plane.transform.localToWorldMatrix,
                        area = 0
                    });
                    PlaneCount++;
                }
            }
            if (floor < float.MaxValue && floorArea > 0.25f)
            {
                _planeFloor = _planeFloor.HasValue ? Mathf.Lerp(_planeFloor.Value, floor, 0.3f) : floor;
                _planeSeen = Time.time;
            }
            else if (Time.time - _planeSeen > 5f) _planeFloor = null; // stale plane estimates expire
            FloorY = CurrentFloor();
        }

        /// <summary>With a room mesh the floor comes from the mesh's own walkable surfaces; planes only otherwise.</summary>
        float _planeSeen = -100f;

        float? _published;

        float? CurrentFloor()
        {
            // ARCore's floor plane is precise when it agrees with the mesh's floor band; otherwise trust the mesh.
            float? target;
            if (_meshFloor.HasValue && _planeFloor.HasValue && Mathf.Abs(_meshFloor.Value - _planeFloor.Value) < 0.03f) target = _planeFloor;
            else target = MeshCount > 0 ? (_meshFloor ?? _planeFloor) : (_planeFloor ?? _meshFloor);
            // Never jump between the plane and mesh values (0.18.0 flicker): glide ≤ 1 cm per update, snap only on a
            // real change of floor (> 15 cm, e.g. walked downstairs).
            if (!target.HasValue) return _published;
            if (!_published.HasValue || Mathf.Abs(target.Value - _published.Value) > 0.15f) _published = target;
            else _published = Mathf.MoveTowards(_published.Value, target.Value, 0.01f);
            return _published;
        }

        Mesh PlaneMesh(ARPlane plane)
        {
            var boundary = plane.boundary;
            if (boundary.Length < 3) return null;
            if (!_planeMeshes.TryGetValue(plane.trackableId, out var mesh))
            {
                mesh = new Mesh { name = "plane-" + plane.trackableId };
                _planeMeshes[plane.trackableId] = mesh;
            }
            // ARCore plane boundaries are convex: a triangle fan is exact.
            var vertices = new Vector3[boundary.Length];
            for (int i = 0; i < boundary.Length; i++) vertices[i] = new Vector3(boundary[i].x, 0f, boundary[i].y);
            var triangles = new int[(boundary.Length - 2) * 3];
            for (int i = 0; i < boundary.Length - 2; i++)
            {
                triangles[i * 3] = 0;
                triangles[i * 3 + 1] = i + 1;
                triangles[i * 3 + 2] = i + 2;
            }
            mesh.Clear();
            mesh.vertices = vertices;
            mesh.triangles = triangles;
            // Winding must face up for the NavMesh builder; flip if the fan came out facing down.
            mesh.RecalculateNormals();
            if (mesh.normals.Length > 0 && mesh.normals[0].y < 0f)
            {
                for (int i = 0; i < triangles.Length; i += 3) (triangles[i + 1], triangles[i + 2]) = (triangles[i + 2], triangles[i + 1]);
                mesh.triangles = triangles;
                mesh.RecalculateNormals();
            }
            mesh.RecalculateBounds();
            return mesh;
        }

        // ---------------- jump links: floor <-> furniture tops ----------------
        // Unity's runtime NavMeshBuilder cannot generate off-mesh links, so (like Phanto's furniture hops)
        // we find raised walkable surfaces in the 3D map (bed, sofa, chair seat, low table) and connect their
        // edges to the floor beside them. Agents traverse these as jumps (Hero.cs).
        readonly List<NavMeshLinkInstance> _links = new List<NavMeshLinkInstance>();
        readonly List<Vector3> _tops = new List<Vector3>();
        /// <summary>Raised walkable spots (furniture tops) near the phone, refreshed every bake.</summary>
        public IReadOnlyList<Vector3> Tops => _tops;
        public int LinkCount => _links.Count;
        static readonly Vector3[] Dirs =
        {
            new Vector3(1, 0, 0), new Vector3(-1, 0, 0), new Vector3(0, 0, 1), new Vector3(0, 0, -1),
            new Vector3(0.707f, 0, 0.707f), new Vector3(-0.707f, 0, 0.707f), new Vector3(0.707f, 0, -0.707f), new Vector3(-0.707f, 0, -0.707f)
        };

        void RebuildJumpLinks(NavMeshTriangulation tri)
        {
            foreach (var l in _links) NavMesh.RemoveLink(l);
            _links.Clear();
            _tops.Clear();
            if (!FloorY.HasValue || cameraTransform == null || tri.indices == null) return;
            float floor = FloorY.Value;
            var cam = cameraTransform.position;
            var seen = new HashSet<Vector2Int>();
            var filter = new NavMeshQueryFilter { agentTypeID = _settings.agentTypeID, areaMask = NavMesh.AllAreas };
            for (int i = 0; i + 2 < tri.indices.Length && _tops.Count < 48; i += 3)
            {
                var c = (tri.vertices[tri.indices[i]] + tri.vertices[tri.indices[i + 1]] + tri.vertices[tri.indices[i + 2]]) / 3f;
                float rise = c.y - floor;
                if (rise < 0.15f || rise > 1.0f) continue;
                if ((new Vector2(c.x - cam.x, c.z - cam.z)).sqrMagnitude > 25f) continue;
                var key = new Vector2Int(Mathf.FloorToInt(c.x / 0.35f), Mathf.FloorToInt(c.z / 0.35f));
                if (!seen.Add(key)) continue;
                _tops.Add(c);
                if (_links.Count >= 28) continue;
                foreach (var dir in Dirs)
                {
                    // Edge of the raised surface in this direction...
                    if (!NavMesh.Raycast(c, c + dir * 1.2f, out var edge, filter)) continue;
                    var start = edge.position - dir * 0.05f;
                    // ...and floor just beyond it.
                    var probe = new Vector3(edge.position.x, floor, edge.position.z) + dir * 0.3f;
                    if (!NavMesh.SamplePosition(probe, out var land, 0.25f, filter)) continue;
                    float drop = start.y - land.position.y;
                    float gap = new Vector2(land.position.x - start.x, land.position.z - start.z).magnitude;
                    if (drop < 0.12f || drop > 1.0f || gap < 0.08f || gap > 0.75f) continue;
                    if (Mathf.Abs(land.position.y - floor) > 0.12f) continue;
                    var link = NavMesh.AddLink(new NavMeshLinkData
                    {
                        startPosition = start,
                        endPosition = land.position,
                        width = 0f,
                        costModifier = 2f,
                        bidirectional = true,
                        area = 0,
                        agentTypeID = _settings.agentTypeID
                    });
                    if (NavMesh.IsLinkValid(link)) _links.Add(link);
                    break; // one link per top cell is enough
                }
            }
        }

        float? _planeFloor, _meshFloor;
        readonly List<float> _heights = new List<float>();

        /// <summary>Floor from the walkable mesh near the phone: a low percentile of walkable heights at
        /// least 0.5 m below the camera (robust to a few noisy low triangles). Used when ARCore has no
        /// horizontal plane yet, e.g. the room mesh found the floor first.</summary>
        // Floor = the LOWEST height band that holds a substantial share of the walkable AREA near the phone
        // (area-weighted 3 cm histogram of NavMesh triangles). Noise specks below the floor carry little area;
        // a bed top is higher than the floor band. Hysteresis: a different band must win 3 bakes in a row
        // before the floor moves (newmr 0.16.0 showed the old percentile jumping 1.2 -> 2.4 m below).
        const float FloorBin = 0.03f;
        readonly Dictionary<int, float> _floorBins = new Dictionary<int, float>();
        float? _floorCandidate;
        int _floorVotes;

        void UpdateMeshFloor(NavMeshTriangulation tri)
        {
            if (cameraTransform == null || tri.vertices == null || tri.indices == null) return;
            var cam = cameraTransform.position;
            _floorBins.Clear();
            float best = 0f;
            for (int i = 0; i + 2 < tri.indices.Length; i += 3)
            {
                Vector3 a = tri.vertices[tri.indices[i]], b = tri.vertices[tri.indices[i + 1]], c = tri.vertices[tri.indices[i + 2]];
                var center = (a + b + c) / 3f;
                float dx = center.x - cam.x, dz = center.z - cam.z;
                if (dx * dx + dz * dz > 16f || cam.y - center.y < 0.4f) continue;
                float area = Vector3.Cross(b - a, c - a).magnitude * 0.5f;
                int bin = Mathf.FloorToInt(center.y / FloorBin);
                _floorBins.TryGetValue(bin, out var sum);
                sum += area;
                // Merge into neighbours too, so a floor split across two bins still counts as one band.
                _floorBins[bin] = sum;
                if (sum > best) best = sum;
            }
            if (best < 0.25f) return; // not enough walkable floor seen yet
            int lowest = int.MaxValue;
            foreach (var kv in _floorBins)
            {
                _floorBins.TryGetValue(kv.Key - 1, out var below);
                _floorBins.TryGetValue(kv.Key + 1, out var above);
                // Absolute support (>= 0.2 m2) and >= 10% of the biggest band: a little visible floor beside a big
                // bed still wins; noise specks (a few cm2) never do.
                float support = kv.Value + 0.5f * (below + above);
                if (support >= 0.2f && support >= 0.1f * best && kv.Key < lowest) lowest = kv.Key;
            }
            if (lowest == int.MaxValue) return;
            float estimate = (lowest + 0.5f) * FloorBin;
            if (!_meshFloor.HasValue) { _meshFloor = estimate; }
            else if (Mathf.Abs(estimate - _meshFloor.Value) <= 0.04f) { _meshFloor = Mathf.Lerp(_meshFloor.Value, estimate, 0.2f); _floorVotes = 0; }
            else
            {
                if (_floorCandidate.HasValue && Mathf.Abs(_floorCandidate.Value - estimate) <= 0.04f) _floorVotes++;
                else { _floorCandidate = estimate; _floorVotes = 1; }
                if (_floorVotes >= 3) { _meshFloor = estimate; _floorVotes = 0; _floorCandidate = null; }
            }
            FloorY = CurrentFloor();
        }

        /// <summary>For the self-test: feed a triangulation directly.</summary>
        public float? TestFloor(NavMeshTriangulation tri) { UpdateMeshFloor(tri); return _meshFloor; }

        [Tooltip("Draw where characters can walk (mint), for scanning feedback.")]
        public bool showWalkable = true;
        GameObject _walkableView;
        Mesh _walkableMesh;

        void RebuildWalkableView(NavMeshTriangulation tri)
        {
            if (_walkableView == null)
            {
                _walkableView = new GameObject("Walkable");
                _walkableMesh = new Mesh { name = "walkable", indexFormat = UnityEngine.Rendering.IndexFormat.UInt32 };
                _walkableView.AddComponent<MeshFilter>().sharedMesh = _walkableMesh;
                var r = _walkableView.AddComponent<MeshRenderer>();
                r.sharedMaterial = Resources.Load<Material>("Materials/Walkable");
                r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                r.receiveShadows = false;
            }
            var v = tri.vertices;
            for (int i = 0; i < v.Length; i++) v[i].y += 0.01f;
            _walkableMesh.Clear();
            _walkableMesh.vertices = v;
            _walkableMesh.triangles = tri.indices;
            _walkableMesh.RecalculateBounds();
        }

        /// <summary>Nearest walkable point within [radius] of [p], on this agent type's mesh.</summary>
        public bool Sample(Vector3 p, float radius, out Vector3 result)
        {
            var filter = new NavMeshQueryFilter { agentTypeID = _settings.agentTypeID, areaMask = NavMesh.AllAreas };
            if (NavMesh.SamplePosition(p, out var hit, radius, filter))
            {
                // Mesh noise under the floor (reflections, holes, scan spikes) is walkable to the baker but never a
                // place to stand: retry on the floor itself, or refuse — heroes must never spawn underground.
                if (FloorY.HasValue && hit.position.y < FloorY.Value - 0.06f)
                {
                    var onFloor = new Vector3(hit.position.x, FloorY.Value, hit.position.z);
                    if (NavMesh.SamplePosition(onFloor, out var up, 0.12f, filter) && up.position.y >= FloorY.Value - 0.06f) { result = up.position; return true; }
                    result = p;
                    return false;
                }
                result = hit.position;
                return true;
            }
            result = p;
            return false;
        }

        /// <summary>Walkable heights in view: the floor plus each furniture-top level (5 cm bins).</summary>
        void RebuildHeights()
        {
            _heights.Clear();
            if (FloorY.HasValue) _heights.Add(FloorY.Value);
            foreach (var t in _tops)
            {
                bool known = false;
                foreach (var h in _heights) if (Mathf.Abs(h - t.y) < 0.05f) { known = true; break; }
                if (!known && _heights.Count < 12) _heights.Add(t.y);
            }
        }

        /// <summary>First walkable surface along a camera ray: intersect the ray with each known walkable height
        /// (floor, furniture tops) and keep the nearest hit that is really on the NavMesh there. ~10 queries per ray
        /// instead of marching 170 points (review finding: thousands of queries per detection on the main thread).</summary>
        public bool CastWalkable(Ray ray, out Vector3 hit, float maxDistance = 6f)
        {
            hit = default;
            if (_heights.Count == 0) RebuildHeights();
            var filter = new NavMeshQueryFilter { agentTypeID = _settings.agentTypeID, areaMask = NavMesh.AllAreas };
            float best = float.MaxValue;
            if (Mathf.Abs(ray.direction.y) < 1e-3f) return false;
            foreach (var h in _heights)
            {
                float t = (h - ray.origin.y) / ray.direction.y;
                if (t < 0.2f || t > maxDistance || t >= best) continue;
                var p = ray.origin + ray.direction * t;
                if (!NavMesh.SamplePosition(p, out var s, 0.07f, filter)) continue;
                if (Mathf.Abs(s.position.y - h) > 0.05f || new Vector2(s.position.x - p.x, s.position.z - p.z).magnitude > 0.07f) continue;
                best = t;
                hit = s.position;
            }
            return best < float.MaxValue;
        }

        /// <summary>Distance from [p] to the nearest walkable edge (wall, furniture, unscanned floor).</summary>
        public float Clearance(Vector3 p)
        {
            var filter = new NavMeshQueryFilter { agentTypeID = _settings.agentTypeID, areaMask = NavMesh.AllAreas };
            return NavMesh.FindClosestEdge(p, out var hit, filter) ? hit.distance : 0f;
        }

        /// <summary>True when the floor point [p] is reachable from [from] by a complete path.</summary>
        public bool Reachable(Vector3 from, Vector3 to, NavMeshPath path)
        {
            var filter = new NavMeshQueryFilter { agentTypeID = _settings.agentTypeID, areaMask = NavMesh.AllAreas };
            return NavMesh.CalculatePath(from, to, filter, path) && path.status == NavMeshPathStatus.PathComplete;
        }

        /// <summary>Floor point under the phone, or near it, when the floor is scanned there.</summary>
        public bool FloorUnderCamera(out Vector3 point)
        {
            point = default;
            if (cameraTransform == null) return false;
            var p = cameraTransform.position;
            float y = FloorY ?? (p.y - 1.3f);
            return Sample(new Vector3(p.x, y, p.z), 1.2f, out point) && Mathf.Abs(point.y - y) < 0.15f;
        }
    }
}
