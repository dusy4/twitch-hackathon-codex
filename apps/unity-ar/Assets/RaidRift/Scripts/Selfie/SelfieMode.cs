using System;
using System.Collections.Generic;
using Unity.Collections;
using Unity.XR.CoreUtils;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;

namespace RaidRift
{
    /// <summary>Front-camera lifecycle. Keeps the same camera/background/stream texture and never resets XR.</summary>
    public sealed class SelfieMode : MonoBehaviour
    {
        public ARSession session;
        public Camera arCamera;
        public ARCameraManager cameraManager;
        public ARFaceManager faceManager;
        public Behaviour poseDriver;
        public ARMeshManager meshManager;
        public ARPlaneManager planeManager;
        public RoomNavigation room;
        public Behaviour[] worldConsumers = Array.Empty<Behaviour>();

        public bool IsSelfie { get; private set; }
        // World logic stays suspended through BOTH camera transitions, including an unsuccessful return.
        public bool WorldPaused => _saved;
        public bool IsSwitching { get; private set; }
        public bool HasFace => IsSelfie && _face != null;
        public float HeroScale { get; private set; } = 0.22f;
        public event Action<bool> Changed;
        public event Action<string> Notice;
        /// <summary>The AR session had to be restarted: the app must drop its room (tracking origin changed).</summary>
        public event Action RoomLost;
        /// <summary>Rear-camera pose (XR-origin local) just before the flip: the app compares it after returning.</summary>
        public Vector3 SavedCameraPosition => _worldCameraPosition;
        public Quaternion SavedCameraRotation => _worldCameraRotation;

        readonly Dictionary<Behaviour, bool> _behaviours = new Dictionary<Behaviour, bool>();
        readonly Dictionary<Renderer, bool> _renderers = new Dictionary<Renderer, bool>();
        readonly List<Renderer> _newRenderers = new List<Renderer>();
        readonly List<Renderer> _rendererScratch = new List<Renderer>();
        readonly List<ISubsystem> _nsdkPaused = new List<ISubsystem>();
        ConfigurationChooser _worldChooser;
        XRSessionSubsystem _sessionSubsystem;
        TrackingMode _worldTracking;
        LightEstimation _worldLight;
        bool _saved, _targetSelfie;
        float _deadline, _switchStarted;
        int _goodFrames, _rearFrames;
        ARFace _face;
        GameObject _glow, _mask;
        Mesh _faceMesh;
        Vector3[] _vertices;
        int[] _indices;
        float _faceWidth = 0.15f;
        Vector3 _worldCameraPosition;
        Quaternion _worldCameraRotation;
        Transform _selfieSpace;

        void OnEnable()
        {
            if (cameraManager != null) cameraManager.frameReceived += CameraFrame;
            if (_saved) RequestWorld(); // Re-enable after suspension still needs confirmed rear frames.
        }

        public void Toggle()
        {
            if (IsSwitching) return;
            if (_saved) { RequestWorld(); return; }
            if (session == null || !session.isActiveAndEnabled || session.subsystem == null ||
                cameraManager == null || !cameraManager.isActiveAndEnabled || cameraManager.subsystem == null ||
                arCamera == null || faceManager == null)
            { Notice?.Invoke("Camera is not ready for selfie mode"); return; }

            // Do not touch the working world if this loader has no user-camera configuration.
            using (var descriptors = session.subsystem.GetConfigurationDescriptors(Allocator.Temp))
            {
                bool supported = false;
                foreach (var d in descriptors)
                    if ((d.capabilities & Feature.UserFacingCamera) != 0) supported = true;
                if (!supported) { Notice?.Invoke("This AR loader has no selfie camera"); return; }
            }

            _sessionSubsystem = session.subsystem;
            _worldChooser = _sessionSubsystem.configurationChooser;
            _worldTracking = session.requestedTrackingMode;
            _worldLight = cameraManager.requestedLightEstimation;
            _worldCameraPosition = arCamera.transform.localPosition;
            _worldCameraRotation = arCamera.transform.localRotation;
            var origin = faceManager.GetComponent<XROrigin>();
            _selfieSpace = origin != null ? origin.TrackablesParent : faceManager.transform;
            _saved = true;
            if (room != null) room.SetSelfieViewHidden(true);
            Pause(room);
            Pause(poseDriver); // ARCore front camera has an identity pose; don't keep a stale rear input pose.
            foreach (var consumer in worldConsumers) Pause(consumer);
            Pause(planeManager);
            Pause(meshManager); // ARMeshManager.OnDisable actually stops the NSDK XRMeshSubsystem.
            // NSDK settings also create depth/segmentation/scanning/VPS/mapping subsystems. Stop only
            // those that are running; leave ARCore session/camera/input alive. No optional NSDK type dependency.
            var subsystems = new List<ISubsystem>();
            SubsystemManager.GetSubsystems(subsystems);
            foreach (var subsystem in subsystems)
            {
                string ns = subsystem.GetType().Namespace;
                if (!subsystem.running || ns == null || !ns.StartsWith("NianticSpatial.NSDK", StringComparison.Ordinal)) continue;
                _nsdkPaused.Add(subsystem);
                subsystem.Stop();
            }
            RememberRoomRenderers();
            foreach (var r in _renderers.Keys) if (r != null) r.enabled = false;
            session.requestedTrackingMode = TrackingMode.RotationOnly;
            cameraManager.requestedLightEstimation = LightEstimation.None;
            _sessionSubsystem.configurationChooser = new FacingChooser(Feature.UserFacingCamera, _worldChooser);
            cameraManager.requestedFacingDirection = CameraFacingDirection.User;
            faceManager.enabled = true; // Null prefab gives pose + vertices, with no visible face material.
            _targetSelfie = true;
            BeginSwitch();
            Notice?.Invoke("Switching to selfie camera · hold still");
        }

        void Pause(Behaviour component)
        {
            if (component == null || _behaviours.ContainsKey(component)) return;
            _behaviours.Add(component, component.enabled);
            component.enabled = false;
        }

        void Remember(Renderer r)
        {
            if (r != null && !_renderers.ContainsKey(r)) _renderers.Add(r, r.enabled);
        }

        void RememberRoomRenderers()
        {
            if (meshManager != null)
                foreach (var m in meshManager.meshes)
                    if (m != null) RememberChildren(m);
            if (planeManager != null)
                foreach (var p in planeManager.trackables)
                    if (p != null) RememberChildren(p);
            if (room != null) RememberChildren(room);
        }

        void RememberChildren(Component root)
        {
            _rendererScratch.Clear();
            root.GetComponentsInChildren(true, _rendererScratch);
            foreach (var r in _rendererScratch) Remember(r);
        }

        void BeginSwitch()
        {
            IsSwitching = true;
            _goodFrames = _rearFrames = 0;
            _switchStarted = Time.realtimeSinceStartup;
            _deadline = _switchStarted + 10f;
        }

        void RequestWorld(string message = "Returning to room camera · hold still")
        {
            if (IsSelfie) { IsSelfie = false; Changed?.Invoke(false); }
            faceManager.enabled = false;
            _face = null;
            HideVisuals();
            session.requestedTrackingMode = _worldTracking;
            cameraManager.requestedLightEstimation = _worldLight;
            // Keep world-only features stopped until rear camera frames AND positional tracking return.
            _sessionSubsystem.configurationChooser = new FacingChooser(Feature.WorldFacingCamera, _worldChooser);
            cameraManager.requestedFacingDirection = CameraFacingDirection.World;
            _targetSelfie = false;
            BeginSwitch();
            Notice?.Invoke(message);
        }

        void CameraFrame(ARCameraFrameEventArgs args)
        {
            if (_saved && _targetSelfie && cameraManager.currentFacingDirection == CameraFacingDirection.User && _selfieSpace != null)
                arCamera.transform.SetPositionAndRotation(_selfieSpace.position, _selfieSpace.rotation);
            if (!IsSwitching && (!_saved || _targetSelfie)) return;
            var expected = _targetSelfie ? CameraFacingDirection.User : CameraFacingDirection.World;
            bool ready = cameraManager.currentFacingDirection == expected && args.projectionMatrix.HasValue;
            _rearFrames = !_targetSelfie && ready ? _rearFrames + 1 : 0;
            if (!_targetSelfie)
                ready &= ARSession.state == ARSessionState.SessionTracking && session.currentTrackingMode == TrackingMode.PositionAndRotation;
            _goodFrames = ready ? _goodFrames + 1 : 0;
            // Street safety: rear frames for 4 s but no positional tracking yet -> give the room back anyway; the
            // normal world loop already waits for tracking ("Move the phone slowly") instead of staying paused.
            bool rearAnyway = !_targetSelfie && _rearFrames >= 3 && Time.realtimeSinceStartup - _switchStarted > 4f;
            if (_goodFrames < 3 && !rearAnyway) return;
            IsSwitching = false;
            if (_targetSelfie)
            {
                IsSelfie = true;
                Changed?.Invoke(true);
                Notice?.Invoke("Selfie party - heroes follow your face");
            }
            else
            {
                RestoreWorld();
                IsSelfie = false;
                Notice?.Invoke("Room camera restored");
            }
        }

        void RestoreWorld()
        {
            if (_sessionSubsystem != null) _sessionSubsystem.configurationChooser = _worldChooser;
            if (arCamera != null) arCamera.transform.SetLocalPositionAndRotation(_worldCameraPosition, _worldCameraRotation);
            foreach (var subsystem in _nsdkPaused) subsystem.Start();
            _nsdkPaused.Clear();
            foreach (var pair in _behaviours) if (pair.Key != null) pair.Key.enabled = pair.Value;
            foreach (var pair in _renderers) if (pair.Key != null) pair.Key.enabled = pair.Value;
            if (room != null) room.SetSelfieViewHidden(false);
            _behaviours.Clear();
            _renderers.Clear();
            _saved = false;
        }

        void Update()
        {
            if (IsSwitching && Time.realtimeSinceStartup > _deadline)
            {
                if (_targetSelfie)
                {
                    RequestWorld("Selfie camera unavailable - restoring room camera");
                }
                else
                {
                    IsSwitching = false; // Permit retry while frame confirmation continues in the background.
                    Notice?.Invoke("Waiting for room tracking - point at the room and tap selfie to retry");
                }
            }
            // Last resort, never a stuck world: 12 s after asking for the rear camera, restore everything; if the
            // camera itself is still not facing the room, restart the AR session (the room is re-scanned).
            if (_saved && !_targetSelfie && Time.realtimeSinceStartup - _switchStarted > 12f)
            {
                bool rear = cameraManager != null && cameraManager.currentFacingDirection == CameraFacingDirection.World;
                IsSwitching = false;
                IsSelfie = false;
                RestoreWorld();
                if (!rear && session != null) { session.Reset(); RoomLost?.Invoke(); Notice?.Invoke("Room camera restarted · scan the floor again"); }
                else Notice?.Invoke("Room camera restored");
                return;
            }
            if (!_saved) return;
            // An already queued mesh job can finish after OnDisable. Hide its renderer too.
            RememberRoomRenderers();
            _newRenderers.Clear();
            foreach (var pair in _renderers) if (pair.Key != null && pair.Key.enabled) _newRenderers.Add(pair.Key);
            foreach (var r in _newRenderers) r.enabled = false;
            _face = null;
            if (!IsSelfie || IsSwitching) { HideVisuals(); return; }
            foreach (var face in faceManager.trackables)
            {
                if (face.trackingState != TrackingState.Tracking) continue;
                var vp = arCamera.WorldToViewportPoint(face.transform.position);
                if (vp.z < 0.15f || vp.z > 2f || vp.x < 0f || vp.x > 1f || vp.y < 0f || vp.y > 1f) continue;
                _face = face;
                _faceWidth = FaceWidth();
                break;
            }
            UpdateFaceVisuals();
        }

        // Shoulder positions are a face-relative approximation, not body/shoulder tracking.
        float FaceWidth()
        {
            if (_face == null || !_face.vertices.IsCreated || _face.vertices.Length == 0) return 0.15f;
            float min = float.MaxValue, max = float.MinValue;
            foreach (var v in _face.vertices) { min = Mathf.Min(min, v.x); max = Mathf.Max(max, v.x); }
            return Mathf.Clamp((max - min) * Mathf.Abs(_face.transform.lossyScale.x), 0.11f, 0.21f);
        }

        public bool TryGetPerch(int index, out Vector3 position, out Quaternion rotation)
        {
            position = default;
            rotation = Quaternion.identity;
            if (!IsSelfie || IsSwitching || arCamera == null || index < 0) return false;
            if (_face != null)
            {
                float w = _faceWidth;
                HeroScale = w / Hero.Height * 0.44f;
                int slot = index % 8;
                float side = (slot % 2 == 0 ? -1f : 1f);
                // Two on shoulders, two peeking, two beside the head, two cheering above it.
                Vector3 offset;
                switch (slot / 2)
                {
                    case 0: offset = new Vector3(side * 1.05f, -1.05f, -0.15f); break;
                    case 1: offset = new Vector3(side * 0.77f, -0.68f, 0.12f); break;
                    case 2: offset = new Vector3(side * 0.78f, -0.12f, -0.08f); break;
                    default: offset = new Vector3(side * 0.40f, 0.65f, 0.08f); break;
                }
                offset.x += side * (index / 8) * 0.22f;
                position = _face.transform.position + _face.transform.rotation * (offset * w);
                // Keep edge-of-frame faces and larger parties within the stream's safe area.
                var vp = arCamera.WorldToViewportPoint(position);
                vp.x = Mathf.Clamp(vp.x, 0.08f, 0.92f);
                vp.y = Mathf.Clamp(vp.y, 0.06f, 0.78f);
                position = arCamera.ViewportToWorldPoint(vp);
            }
            else
            {
                HeroScale = 0.16f;
                // Viewport placement works in portrait/landscape and with ARCore's mirrored projection.
                int col = index % 6, row = index / 6;
                position = arCamera.ViewportToWorldPoint(new Vector3(0.12f + col * 0.152f, 0.10f + (row % 4) * 0.14f, 0.4f + (row / 4) * 0.06f));
            }
            var toward = arCamera.transform.position - position;
            rotation = Quaternion.LookRotation(toward.normalized, arCamera.transform.up);
            return true;
        }

        void UpdateFaceVisuals()
        {
            HideVisuals(); return; // owner 2026-11-01: no rift halo on the streamer's face
            if (_face == null) { HideVisuals(); return; }
            if (_glow == null)
            {
                _glow = GameObject.CreatePrimitive(PrimitiveType.Quad);
                _glow.name = "Selfie rift halo";
                Destroy(_glow.GetComponent<Collider>());
                _glow.GetComponent<Renderer>().sharedMaterial = Resources.Load<Material>("Materials/PortalSwirl");
                _glow.GetComponent<Renderer>().shadowCastingMode = ShadowCastingMode.Off;
                _mask = new GameObject("Selfie face occluder", typeof(MeshFilter), typeof(MeshRenderer));
                _faceMesh = new Mesh { name = "Selfie face depth" };
                _faceMesh.MarkDynamic();
                _mask.GetComponent<MeshFilter>().sharedMesh = _faceMesh;
                _mask.GetComponent<Renderer>().sharedMaterial = Resources.Load<Material>("Materials/DepthOnly");
                _mask.GetComponent<Renderer>().shadowCastingMode = ShadowCastingMode.Off;
            }
            float w = _faceWidth;
            var t = _face.transform;
            _glow.SetActive(true);
            _glow.transform.SetPositionAndRotation(t.position + t.rotation * new Vector3(0f, 0.025f, w * 0.55f), t.rotation);
            _glow.transform.localScale = new Vector3(w * 2.5f, w * 3.0f, 1f);
            bool mesh = _face.vertices.IsCreated && _face.indices.IsCreated && _face.vertices.Length > 0 && _face.indices.Length > 0;
            _mask.SetActive(mesh);
            if (!mesh) return;
            bool topologyChanged = _vertices == null || _vertices.Length != _face.vertices.Length || _indices.Length != _face.indices.Length;
            if (topologyChanged)
            {
                _faceMesh.Clear();
                _vertices = new Vector3[_face.vertices.Length];
                _indices = new int[_face.indices.Length];
            }
            _face.vertices.CopyTo(_vertices);
            _faceMesh.vertices = _vertices;
            if (topologyChanged) // ARCore face topology is fixed; only vertices change each frame.
            {
                _face.indices.CopyTo(_indices);
                _faceMesh.triangles = _indices;
            }
            _faceMesh.RecalculateBounds();
            _mask.transform.SetPositionAndRotation(t.position, t.rotation);
            _mask.transform.localScale = t.lossyScale;
        }

        void HideVisuals()
        {
            if (_glow != null) _glow.SetActive(false);
            if (_mask != null) _mask.SetActive(false);
        }

        void OnDisable()
        {
            if (cameraManager != null) cameraManager.frameReceived -= CameraFrame;
            HideVisuals();
            if (!_saved) return;
            // Never restart meshing from OnDisable while front frames could still be arriving.
            // Keep the saved suspension until OnEnable can confirm the return. During scene teardown
            // the existing managers/loaders own native destruction; do not restart them here.
            if (session != null && cameraManager != null && faceManager != null) RequestWorld();
        }

        void OnDestroy()
        {
            if (_glow != null) Destroy(_glow);
            if (_mask != null) Destroy(_mask);
            if (_faceMesh != null) Destroy(_faceMesh);
        }

        // Only installed during a flip. The exact original chooser is restored for normal world mode.
        sealed class FacingChooser : ConfigurationChooser
        {
            readonly Feature _camera;
            readonly ConfigurationChooser _fallback;
            public FacingChooser(Feature camera, ConfigurationChooser fallback) { _camera = camera; _fallback = fallback; }
            public override Configuration ChooseConfiguration(NativeSlice<ConfigurationDescriptor> descriptors, Feature requestedFeatures)
            {
                int best = -1, score = -1, rank = int.MinValue;
                for (int i = 0; i < descriptors.Length; i++)
                {
                    var d = descriptors[i];
                    if ((d.capabilities & _camera) == 0) continue;
                    int count = (d.capabilities & requestedFeatures).Count();
                    if (count > score || (count == score && d.rank > rank)) { best = i; score = count; rank = d.rank; }
                }
                return best < 0 ? _fallback.ChooseConfiguration(descriptors, requestedFeatures)
                    : new Configuration(descriptors[best], descriptors[best].capabilities & requestedFeatures);
            }
        }
    }
}
