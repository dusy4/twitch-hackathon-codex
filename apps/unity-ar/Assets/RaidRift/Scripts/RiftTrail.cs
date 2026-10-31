using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.AI;

namespace RaidRift
{
    /// <summary>Rift Trail, local only: find 3 crystals on scanned floor, restore the shrine, then two
    /// heroes cheer. Sites are only placed on NavMesh floor the party can actually walk to, so the
    /// party walks there with the streamer instead of waiting for a "measured route".</summary>
    public class RiftTrail : MonoBehaviour
    {
        public enum Phase { Off, Fragments, Shrine, Party, Complete }

        public RoomNavigation room;
        public Transform cameraTransform;
        public Phase Current { get; private set; } = Phase.Off;
        public int Collected { get; private set; }
        public string Hint { get; private set; } = "";
        public Transform Site { get; private set; }
        public event Action<string> OnEvent;

        readonly List<Vector3> _used = new List<Vector3>();
        readonly HashSet<string> _cheered = new HashSet<string>();
        NavMeshPath _path; // Unity forbids creating it in a field initializer

        void Awake() => _path = new NavMeshPath();
        Vector3 _lastSiteCamera;
        float _dwell;
        float _nextSearch;

        public void Begin()
        {
            Clear();
            Current = Phase.Fragments;
            Hint = "Walk around · crystals appear on open floor";
            if (cameraTransform != null) _lastSiteCamera = cameraTransform.position + Vector3.one * 100f;
        }

        public void Clear()
        {
            if (Site != null) Destroy(Site.gameObject);
            Site = null;
            _used.Clear();
            _cheered.Clear();
            Collected = 0;
            Current = Phase.Off;
            Hint = "";
        }

        void Update()
        {
            if (Current == Phase.Off || Current == Phase.Complete || cameraTransform == null) return;
            if (Current == Phase.Party) return;
            if (Site == null)
            {
                if (Time.time < _nextSearch) return;
                _nextSearch = Time.time + 0.5f;
                TryPlace();
                return;
            }
            Site.Rotate(0f, 90f * Time.deltaTime, 0f, Space.World);
            var cam = cameraTransform.position;
            var flat = new Vector3(Site.position.x - cam.x, 0f, Site.position.z - cam.z);
            var forward = cameraTransform.forward;
            bool inView = Vector3.Angle(forward, Site.position - cam) < 35f;
            if (flat.magnitude < 1.05f && inView)
            {
                _dwell += Time.deltaTime;
                Hint = Current == Phase.Shrine ? "Hold the shrine in view…" : "Hold the crystal in view…";
                if (_dwell >= 0.75f) Collect();
            }
            else
            {
                _dwell = 0f;
                Hint = Current == Phase.Shrine ? "Bring the party to the shrine" : $"Crystal spotted · walk to it ({flat.magnitude:0.0} m)";
            }
        }

        void TryPlace()
        {
            if (!room.HasNavMesh) { Hint = "Scanning the floor…"; return; }
            var cam = cameraTransform.position;
            if (Current == Phase.Fragments && Collected > 0 && (cam - _lastSiteCamera).magnitude < 1.25f)
            {
                Hint = "Explore further · walk somewhere new";
                return;
            }
            if (!room.FloorUnderCamera(out var start)) { Hint = "Point the camera at the floor"; return; }
            var flatForward = Vector3.ProjectOnPlane(cameraTransform.forward, Vector3.up);
            if (flatForward.sqrMagnitude < 1e-4f) return;
            flatForward.Normalize();
            for (int i = 0; i < 12; i++)
            {
                float yaw = UnityEngine.Random.Range(-40f, 40f);
                float dist = UnityEngine.Random.Range(1.15f, 2.8f);
                var probe = start + Quaternion.Euler(0f, yaw, 0f) * flatForward * dist;
                if (!room.Sample(probe, 0.4f, out var spot)) continue;
                if (Mathf.Abs(spot.y - start.y) > 0.08f) continue; // floor only, not the bed top
                if (room.Clearance(spot) < 0.18f) continue;
                bool spaced = true;
                foreach (var u in _used) if ((u - spot).magnitude < 1.2f) spaced = false;
                if (!spaced) continue;
                if (!room.Reachable(start, spot, _path)) continue;
                Spawn(spot);
                return;
            }
            Hint = "Measured floor too small · scan a wider open floor";
        }

        void Spawn(Vector3 spot)
        {
            bool shrine = Current == Phase.Shrine;
            var go = new GameObject(shrine ? "Shrine" : "Crystal");
            go.transform.position = spot;
            var mat = Resources.Load<Material>(shrine ? "Materials/Gold" : "Materials/Crystal");
            if (shrine)
            {
                for (int i = 0; i < 4; i++)
                {
                    var p = GameObject.CreatePrimitive(PrimitiveType.Cube);
                    Destroy(p.GetComponent<Collider>());
                    p.transform.SetParent(go.transform, false);
                    p.transform.localScale = new Vector3(.05f, .14f + i * .02f, .05f);
                    float a = i * Mathf.PI / 2f;
                    p.transform.localPosition = new Vector3(Mathf.Cos(a) * .09f, .07f + i * .01f, Mathf.Sin(a) * .09f);
                    if (mat != null) p.GetComponent<Renderer>().sharedMaterial = mat;
                }
            }
            else
            {
                var c = GameObject.CreatePrimitive(PrimitiveType.Cube);
                Destroy(c.GetComponent<Collider>());
                c.transform.SetParent(go.transform, false);
                c.transform.localScale = new Vector3(.06f, .11f, .06f);
                c.transform.localPosition = new Vector3(0f, .12f, 0f);
                c.transform.localRotation = Quaternion.Euler(0f, 0f, 45f);
                if (mat != null) c.GetComponent<Renderer>().sharedMaterial = mat;
            }
            Site = go.transform;
            _used.Add(spot);
            _dwell = 0f;
            OnEvent?.Invoke("discovered");
        }

        void Collect()
        {
            Destroy(Site.gameObject);
            Site = null;
            _lastSiteCamera = cameraTransform.position;
            if (Current == Phase.Fragments)
            {
                Collected++;
                OnEvent?.Invoke("collected");
                if (Collected >= 3) { Current = Phase.Shrine; Hint = "All 3 crystals · find the shrine"; }
            }
            else if (Current == Phase.Shrine)
            {
                Current = Phase.Party;
                Hint = "Shrine restored · two viewers must cheer (wave, dance or jump)";
                OnEvent?.Invoke("restored");
            }
        }

        /// <summary>Heroes report new wave/dance/jump actions; two distinct ones complete the party.</summary>
        public void Cheer(string heroId)
        {
            if (Current != Phase.Party) return;
            _cheered.Add(heroId);
            if (_cheered.Count >= 2)
            {
                Current = Phase.Complete;
                Hint = "Rift Trail complete!";
                OnEvent?.Invoke("completed");
            }
        }

        /// <summary>Where the party should head: the current site when one is out, else nowhere.</summary>
        public bool PartyGoal(out Vector3 goal)
        {
            goal = Site != null ? Site.position : default;
            return Site != null;
        }
    }
}
