using System.Collections.Generic;
using UnityEngine;
using UnityEngine.AI;

namespace RaidRift
{
    /// <summary>One viewer's character: a KayKit hero walking the scanned room on Unity's NavMesh.
    /// The director gives it a destination (stage spot or follow-me slot); the agent finds the path
    /// around furniture. Chat actions (jump, sit, dance…) play on top. Never teleports once placed.</summary>
    [RequireComponent(typeof(NavMeshAgent))]
    public partial class Hero : MonoBehaviour // SELFIE: perch support lives in Selfie/Hero.Selfie.cs.
    {
        public const float Height = 0.30f;
        const float ModelHeight = 2.19f; // KayKit rig, same constant as the Kotlin client
        public const float WalkSpeed = 0.35f;
        public const float RunSpeed = 0.9f;

        static readonly HashSet<string> Accessories = new HashSet<string>
        {
            "1H_Sword_Offhand", "Badge_Shield", "Rectangle_Shield", "Round_Shield", "Spike_Shield", "1H_Sword", "2H_Sword",
            "Spellbook", "Spellbook_open", "1H_Wand", "2H_Staff", "Knife_Offhand", "1H_Crossbow", "2H_Crossbow", "Knife",
            "Throwable", "1H_Axe_Offhand", "Barbarian_Round_Shield", "1H_Axe", "2H_Axe", "Mug"
        };

        public string Id { get; private set; }
        public string DisplayName { get; set; }
        public string Message { get; set; }
        public NavMeshAgent Agent { get; private set; }
        public bool Placed => Agent != null && Agent.enabled && Agent.isOnNavMesh;
        public bool Waiting { get; private set; }
        public string CurrentAction { get; private set; } = "idle";
        public long ActionSerial { get; private set; }
        public Transform Head => _visual;

        Transform _visual;
        Animation _anim;
        Transform _rootBone;
        Vector3 _rootRest;
        string _playing;
        float _actionUntil;
        float _jumpStart = -10f;
        float _yawOffset;
        float _targetYaw;
        Vector3? _destination;
        float _nextRepath;
        Vector3 _stuckCheckPos;
        float _stuckSince;

        public static Hero Create(string id, string model, int agentTypeId, Transform parent)
        {
            var go = new GameObject("Hero " + id);
            go.transform.SetParent(parent, false);
            var agent = go.AddComponent<NavMeshAgent>();
            agent.agentTypeID = agentTypeId;
            agent.radius = 0.07f;
            agent.height = Height;
            agent.baseOffset = 0f;
            agent.speed = WalkSpeed;
            agent.acceleration = 3f;
            agent.angularSpeed = 540f;
            agent.stoppingDistance = 0.05f;
            agent.autoBraking = true;
            agent.obstacleAvoidanceType = ObstacleAvoidanceType.MedQualityObstacleAvoidance;
            agent.avoidancePriority = 50;
            agent.autoTraverseOffMeshLink = false; // furniture links are traversed as jumps (UpdateLinkJump)
            agent.enabled = false; // enabled by Place once the NavMesh exists under the spawn
            var hero = go.AddComponent<Hero>();
            hero.Id = id;
            hero.Agent = agent;
            hero.BuildVisual(model);
            hero.BuildShadow();
            return hero;
        }

        void BuildVisual(string model)
        {
            var pivot = new GameObject("Visual").transform;
            pivot.SetParent(transform, false);
            _visual = pivot;
            var prefab = Resources.Load<GameObject>("Characters/" + model);
            if (prefab == null)
            {
                // Missing import: a visible placeholder rather than an invisible viewer.
                var capsule = GameObject.CreatePrimitive(PrimitiveType.Capsule);
                Destroy(capsule.GetComponent<Collider>());
                capsule.transform.SetParent(pivot, false);
                capsule.transform.localScale = new Vector3(.12f, Height / 2f, .12f);
                capsule.transform.localPosition = new Vector3(0, Height / 2f, 0);
                var mat = Resources.Load<Material>("Materials/Crystal"); // default Standard shader may be stripped
                if (mat != null) capsule.GetComponent<Renderer>().sharedMaterial = mat;
                return;
            }
            var instance = Instantiate(prefab, pivot);
            instance.transform.localPosition = Vector3.zero;
            instance.transform.localRotation = Quaternion.identity;
            instance.transform.localScale = Vector3.one * (Height / ModelHeight);
            foreach (var t in instance.GetComponentsInChildren<Transform>(true))
            {
                if (t.name.StartsWith("handslot")) foreach (Transform c in t) c.gameObject.SetActive(false);
                if (Accessories.Contains(t.name)) foreach (var r in t.GetComponents<Renderer>()) r.enabled = false;
                if (t.name == "root" && _rootBone == null) { _rootBone = t; _rootRest = t.localPosition; }
            }
            foreach (var r in instance.GetComponentsInChildren<Renderer>(true))
            {
                r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                r.receiveShadows = false;
                if (r is SkinnedMeshRenderer s) s.updateWhenOffscreen = true;
            }
            _anim = instance.GetComponentInChildren<Animation>();
            if (_anim != null)
            {
                _anim.playAutomatically = false;
                foreach (AnimationState s in _anim) s.wrapMode = Loops(s.name) ? WrapMode.Loop : WrapMode.ClampForever;
                Play("Idle");
            }
        }

        // ---------------- juice: contact shadow, squash & stretch, steps, landings ----------------
        Transform _shadow;
        Renderer _shadowRenderer;
        MaterialPropertyBlock _shadowBlock;
        float _squash, _stepTimer, _groundY;
        bool _airborne;
        static readonly int StrengthId = Shader.PropertyToID("_Strength");
        static readonly Color SparkViolet = new Color(0.8f, 0.6f, 1f, 0.9f), SparkMint = new Color(0.55f, 1f, 0.88f, 0.9f);

        void BuildShadow()
        {
            var q = GameObject.CreatePrimitive(PrimitiveType.Quad);
            Destroy(q.GetComponent<Collider>());
            q.name = "Contact shadow";
            q.transform.SetParent(transform, false);
            q.transform.localRotation = Quaternion.Euler(90f, 0f, 0f);
            q.transform.localScale = new Vector3(0.24f, 0.2f, 1f);
            _shadowRenderer = q.GetComponent<Renderer>();
            _shadowRenderer.sharedMaterial = Resources.Load<Material>("Materials/BlobShadow");
            _shadowRenderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            _shadowBlock = new MaterialPropertyBlock();
            _shadow = q.transform;
            q.SetActive(false);
        }

        /// <summary>Shadow stays on the ground while the body is in the air; fainter and smaller with height.</summary>
        void UpdateShadow(float height)
        {
            if (_shadow == null) return;
            bool show = Spawned && _layer != RiftWorld.Layer && !SelfiePerched; // SELFIE: no floor shadow on a face.
            if (_shadow.gameObject.activeSelf != show) _shadow.gameObject.SetActive(show);
            if (!show) return;
            _shadow.position = new Vector3(transform.position.x, _groundY + 0.004f, transform.position.z);
            float k = Mathf.Clamp01(1f - height / 0.6f);
            _shadow.localScale = new Vector3(0.24f, 0.2f, 1f) * (0.6f + 0.4f * k);
            _shadowBlock.SetFloat(StrengthId, 0.55f * k);
            _shadowRenderer.SetPropertyBlock(_shadowBlock);
        }

        void Land(float strength)
        {
            _squash = 0.22f * strength;
            if (SelfiePerched) return; // SELFIE: squash without room-sized dust/shockwaves beside a face.
            Fx.Dust(transform.position, strength);
            RiftFx.Land(transform.position, strength > 0.9f);
            Sfx.PlayAt("land", transform.position, 0.55f * strength);
        }

        /// <summary>Lost behind (city walk) or stranded: vanish in a rift flash, reappear at [to].</summary>
        public void RiftHop(Vector3 to)
        {
            if (!Placed) return;
            Fx.Sparkle(transform.position + Vector3.up * 0.15f, SparkViolet, 20, 0.8f);
            Sfx.PlayAt("teleport_out", transform.position, 0.6f);
            if (Agent.Warp(to))
            {
                transform.position = to;
                _groundY = to.y;
                Fx.Sparkle(to + Vector3.up * 0.15f, SparkMint, 24, 0.9f);
                Sfx.PlayAt("teleport_in", to, 0.6f);
                _squash = 0.3f;
            }
        }

        // ---------------- jumping along furniture links ----------------
        bool _linkJump;
        Vector3 _linkFrom, _linkTo;
        float _linkT, _linkDuration, _linkArc;

        void UpdateLinkJump()
        {
            if (!_linkJump)
            {
                var data = Agent.currentOffMeshLinkData;
                _linkFrom = transform.position;
                _linkTo = data.endPos + Vector3.up * Agent.baseOffset;
                float rise = _linkTo.y - _linkFrom.y;
                _linkDuration = 0.5f + Mathf.Abs(rise) * 0.35f;
                _linkArc = 0.12f + Mathf.Max(0f, rise) * 0.6f;
                _linkT = 0f;
                _linkJump = true;
                _squash = -0.12f; // anticipation crouch
                Sfx.PlayAt("jump", transform.position, 0.5f);
                PlayRestart("Jump_Full_Short");
                var dir = Vector3.ProjectOnPlane(_linkTo - _linkFrom, Vector3.up);
                if (dir.sqrMagnitude > 1e-4f) transform.rotation = Quaternion.LookRotation(dir.normalized);
            }
            _linkT += Time.deltaTime / _linkDuration;
            float t = Mathf.Clamp01(_linkT);
            var p = Vector3.Lerp(_linkFrom, _linkTo, t);
            p.y += 4f * _linkArc * t * (1f - t);
            transform.position = p;
            _groundY = Mathf.Lerp(_linkFrom.y, _linkTo.y, t < 0.5f ? 0f : 1f);
            UpdateShadow(p.y - Mathf.Min(_linkFrom.y, _linkTo.y));
            if (t >= 1f)
            {
                _linkJump = false;
                Agent.CompleteOffMeshLink();
                _groundY = _linkTo.y;
                Land(0.9f);
            }
        }

        void PlayRestart(string clip)
        {
            _playing = null;
            Play(clip);
        }

        static bool Loops(string clip) => clip == "Idle" || clip.StartsWith("Walking") || clip.StartsWith("Running") || clip.EndsWith("_Idle") || clip == "Cheer";

        /// <summary>True once the hero has appeared; it is never spawned again, only recovered.</summary>
        public bool Spawned { get; private set; }

        /// <summary>Put the hero on the NavMesh at [point] (portal foot). False until the mesh exists there.</summary>
        public bool Place(Vector3 point, Quaternion facing)
        {
            transform.SetPositionAndRotation(point, facing);
            Agent.enabled = true;
            if (!Agent.Warp(point)) { Agent.enabled = false; return false; }
            Spawned = true;
            return true;
        }

        /// <summary>Walking out of the rift world: no agent yet, a straight walk from inside the world to the
        /// window foot. Behind the window plane the hero is drawn by the rift camera (layer 8).</summary>
        static float _lastArrival = -100f; // first hero of a group gets the small camera hit
        public bool Entering { get; private set; }
        RiftWorld _rift;
        Vector3 _exit;
        int _layer = -1;

        public void BeginEntrance(RiftWorld rift, Vector3 inside, Vector3 exit)
        {
            _rift = rift;
            _exit = exit;
            Entering = true;
            Spawned = true;
            Agent.enabled = false;
            var dir = Vector3.ProjectOnPlane(exit - inside, Vector3.up);
            transform.SetPositionAndRotation(inside, Quaternion.LookRotation(dir.sqrMagnitude > 1e-4f ? dir.normalized : Vector3.back));
        }

        void UpdateEntrance()
        {
            var to = _exit - transform.position;
            to.y = 0f;
            float step = WalkSpeed * 1.6f * Time.deltaTime;
            if (to.magnitude <= step)
            {
                transform.position = _exit;
                if (Place(_exit, transform.rotation))
                {
                    Entering = false;
                    SetLayer(0);
                    _groundY = _exit.y;
                    Land(0.6f);
                    Fx.Sparkle(_exit + Vector3.up * 0.12f, SparkMint, 14, 0.6f);
                    // Out of the rift = the way the hero walked (position already equals _exit here).
                    RiftFx.Arrival(_exit, Vector3.ProjectOnPlane(transform.forward, Vector3.up).normalized, Time.time - _lastArrival > 2f);
                    _lastArrival = Time.time;
                    Sfx.PlayAt("teleport_in", _exit, 0.5f);
                }
                return;
            }
            transform.position += to.normalized * step;
            transform.rotation = Quaternion.RotateTowards(transform.rotation, Quaternion.LookRotation(to.normalized), 540f * Time.deltaTime);
            SetLayer(_rift != null && _rift.IsInside(transform.position) ? RiftWorld.Layer : 0);
        }

        void SetLayer(int layer)
        {
            if (layer == _layer) return;
            _layer = layer;
            foreach (var t in _visual.GetComponentsInChildren<Transform>(true)) t.gameObject.layer = layer;
        }

        /// <summary>The NavMesh was rebuilt under a spawned hero (rebake, moved bake box): snap to the
        /// nearest walkable point where it stands, a few centimetres, instead of re-spawning it.</summary>
        public void Recover(Vector3 nearest)
        {
            if (!Agent.enabled) Agent.enabled = true;
            if (Agent.Warp(nearest) && _destination.HasValue)
            {
                var d = _destination.Value;
                _destination = null;
                SetDestination(d, Agent.speed > WalkSpeed);
            }
        }

        public void SetDestination(Vector3 point, bool run)
        {
            if (!Placed) return;
            if (Holding) return;
            Agent.speed = run ? RunSpeed : WalkSpeed;
            if (_destination.HasValue && (point - _destination.Value).sqrMagnitude < 0.01f && Time.time < _nextRepath) return;
            _destination = point;
            _nextRepath = Time.time + 1f;
            Agent.isStopped = false;
            Agent.SetDestination(point);
        }

        public void Halt()
        {
            _destination = null;
            if (Placed) { Agent.isStopped = true; Agent.ResetPath(); }
        }

        /// <summary>Stop, jump and turns hold the hero in place, like the Kotlin client.</summary>
        bool Holding => Time.time < _actionUntil && (CurrentAction == "jump" || CurrentAction.StartsWith("turn_") || CurrentAction == "sit" || CurrentAction == "sleep" || CurrentAction == "pickup" || CurrentAction == "spell");

        /// <summary>Free to be driven by the roaming brain: not mid-emote, not sitting, not mid-jump.</summary>
        public bool Idle => Placed && !_linkJump && !Holding && Time.time >= _actionUntil;

        /// <summary>Last animation the world source (server / test room) asked for.</summary>
        public string ServerAnimation { get; private set; } = "idle";
        /// <summary>Time of the last viewer command; roaming pauses after one.</summary>
        public float LastCommand { get; private set; } = -100f;

        public void Act(string action, long serial)
        {
            action = action ?? "idle";
            if (serial == ActionSerial && action == ServerAnimation) return;
            bool restarted = serial != ActionSerial;
            if (restarted) { LastCommand = Time.time; _pendingPose = null; } // untargeted command cancels a waiting pose
            ActionSerial = serial;
            ServerAnimation = action;
            Apply(action, restarted);
        }

        public void FaceTowards(Vector3 p)
        {
            var d = Vector3.ProjectOnPlane(p - transform.position, Vector3.up);
            if (d.sqrMagnitude > 1e-4f) transform.rotation = Quaternion.LookRotation(d.normalized);
        }

        string _pendingPose;
        Vector3 _poseAt;

        /// <summary>Planner step with a target in the room ("sit on the chair", "dance over there"): walk
        /// there first, then hold the pose on arrival — even if the server's timed step already moved on.</summary>
        public void ActAt(string action, long serial, Vector3 target)
        {
            action = action ?? "idle";
            if (serial == ActionSerial && action == ServerAnimation) return;
            if (serial != ActionSerial) LastCommand = Time.time;
            ActionSerial = serial;
            ServerAnimation = action;
            bool travel = action == "walk" || action == "run" || action == "sprint" || action == "navigate" || action == "follow";
            _pendingPose = null;      // a newer command supersedes any pose still waiting for arrival
            _actionUntil = 0f;        // before Apply: a direct pose sets its own hold
            if (travel || Arrived(target)) { Apply(travel ? "idle" : action, true); }
            else { _pendingPose = action; _poseAt = target; _poseSince = Time.time; Apply("idle", false); }
            if (!Arrived(target)) SetDestination(target, travel ? action != "walk" : true);
        }

        float _poseSince;

        /// <summary>Really there: horizontally close AND at the target's height (on the sofa, not beside it),
        /// not mid-path or mid-jump.</summary>
        bool Arrived(Vector3 target)
        {
            if (!Placed || _linkJump || Agent.isOnOffMeshLink) return false;
            var d = target - transform.position;
            return new Vector2(d.x, d.z).magnitude < 0.25f && Mathf.Abs(d.y) < 0.1f;
        }

        void UpdatePendingPose()
        {
            if (_pendingPose == null || !Placed || Agent.pathPending) return;
            if (Time.time - _poseSince > 15f) { _pendingPose = null; return; } // unreachable: give up, stay idle
            if (!Arrived(_poseAt)) return;
            var pose = _pendingPose;
            _pendingPose = null;
            if (Camera.main != null) FaceTowards(Camera.main.transform.position); // poses play to the streamer
            Apply(pose, true);
        }

        /// <summary>Walking to a planner target before holding its pose.</summary>
        public bool HasPendingPose => _pendingPose != null;

        /// <summary>A self-driven emote (roaming brain): same effects as a command, no server state.</summary>
        public void Emote(string action) => Apply(action, true);

        void Apply(string action, bool restarted)
        {
            CurrentAction = action;
            switch (CurrentAction)
            {
                case "jump":
                    _jumpStart = Time.time;
                    _actionUntil = Time.time + 1.17f;
                    Halt();
                    break;
                case "turn_left": _targetYaw = _yawOffset - 90f; _actionUntil = Time.time + .8f; Halt(); break;
                case "turn_right": _targetYaw = _yawOffset + 90f; _actionUntil = Time.time + .8f; Halt(); break;
                case "turn_around": _targetYaw = _yawOffset + 180f; _actionUntil = Time.time + .8f; Halt(); break;
                case "sit": case "sleep": _actionUntil = float.MaxValue; Halt(); break;
                case "stop": _actionUntil = 0; Halt(); break;
                case "dance": case "wave": case "cheer": _actionUntil = Time.time + (restarted ? 6f : 3f); break;
                case "pickup": case "spell": _actionUntil = Time.time + 1.4f; Halt(); break;
                default: _actionUntil = 0; break;
            }
            if (restarted && (CurrentAction == "dance" || CurrentAction == "wave" || CurrentAction == "jump")) _playing = null; // restart clip
            if (restarted && Spawned)
            {
                var voice = CurrentAction == "dance" || CurrentAction == "cheer" ? "cheer" : CurrentAction == "wave" ? "greet" : CurrentAction == "spell" ? "spell" : null;
                if (voice != null) Sfx.PlayAt(voice, transform.position + Vector3.up * 0.2f, 0.55f, 0.18f);
            }
        }

        float _lastMoved;

        /// <summary>Has somewhere to go but no complete path and hasn't moved for 3 s.</summary>
        public bool Stuck => Waiting && Time.time - _lastMoved > 3f;

        void Update()
        {
            // Never draw a hero before it has been placed on the floor (no ghosts at the session origin).
            if (_visual.gameObject.activeSelf != Spawned) _visual.gameObject.SetActive(Spawned);
            if (Entering) { UpdateEntrance(); Play("Walking_A"); _groundY = transform.position.y; UpdateShadow(0f); return; }
            if (Placed && Agent.isOnOffMeshLink) { _lastMoved = Time.time; UpdateLinkJump(); ApplySquash(); return; }
            if (Placed && !_linkJump) _groundY = transform.position.y;
            if (Placed && Agent.velocity.sqrMagnitude > 0.0025f) _lastMoved = Time.time;
            UpdatePendingPose();
            Footsteps();
            if (CurrentAction == "sit" || CurrentAction == "sleep")
            {
                // A new move command (serial change handled by Act) is the only way out of sitting.
            }
            else if (Time.time > _actionUntil && _actionUntil > 0f) _actionUntil = 0f;

            // Turns rotate the visual on top of the agent's own heading.
            _yawOffset = Mathf.MoveTowardsAngle(_yawOffset, _targetYaw, 540f * Time.deltaTime);
            if (Placed && Agent.velocity.sqrMagnitude > 0.004f) { _targetYaw = 0f; }
            float lift = 0f;
            float jt = Time.time - _jumpStart;
            // Jump emote: crouch, launch (0.25 s), 0.13 m arc, land with dust and squash.
            if (jt >= 0.25f && jt <= 1.0f) lift = Mathf.Sin((jt - 0.25f) / 0.75f * Mathf.PI) * 0.16f;
            bool air = lift > 0.005f;
            if (air && !_airborne) Sfx.PlayAt("hop", transform.position, 0.45f);
            if (!air && _airborne) Land(0.7f);
            _airborne = air;
            _visual.localPosition = new Vector3(0f, lift, 0f);
            _visual.localRotation = Quaternion.Euler(0f, _yawOffset, 0f);
            ApplySquash();
            UpdateShadow(lift);
            if (Placed && Agent.velocity.magnitude > 0.55f && Random.value < 0.25f)
                Fx.Mote(transform.position + Vector3.up * 0.05f, new Color(0.7f, 0.55f, 1f, 0.7f));

            Waiting = _destination.HasValue && Placed && Agent.pathPending == false && Agent.pathStatus != NavMeshPathStatus.PathComplete;
            UpdateStuck();
            Animate();
        }

        /// <summary>Squash on landing (wide/short), stretch on take-off, springing back to normal.</summary>
        void ApplySquash()
        {
            _squash = Mathf.Lerp(_squash, 0f, 1f - Mathf.Exp(-10f * Time.deltaTime));
            _visual.localScale = new Vector3(1f + _squash * 0.6f, 1f - _squash, 1f + _squash * 0.6f);
        }

        void Footsteps()
        {
            if (!Placed) return;
            float speed = Agent.velocity.magnitude;
            if (speed < 0.08f) { _stepTimer = 0f; return; }
            _stepTimer -= Time.deltaTime;
            if (_stepTimer > 0f) return;
            _stepTimer = speed > 0.55f ? 0.2f : 0.3f;
            Sfx.PlayAt("step", transform.position, speed > 0.55f ? 0.35f : 0.22f, 0.2f);
        }

        void UpdateStuck()
        {
            if (!Placed || !_destination.HasValue) { _stuckSince = 0; return; }
            if ((transform.position - _stuckCheckPos).sqrMagnitude > 0.0025f) { _stuckCheckPos = transform.position; _stuckSince = Time.time; return; }
            // Repath when stalled with somewhere left to go (another hero in the way, mesh changed).
            if (Agent.remainingDistance > 0.15f && Time.time - _stuckSince > 2f)
            {
                _stuckSince = Time.time;
                Agent.SetDestination(_destination.Value);
            }
        }

        void Animate()
        {
            if (_anim == null) return;
            string clip;
            float speed = Placed ? Agent.velocity.magnitude : 0f;
            if (speed > 0.05f) clip = speed > 0.55f ? "Running_A" : "Walking_A";
            else switch (CurrentAction)
            {
                case "jump": clip = Time.time - _jumpStart <= 1.17f ? "Jump_Full_Short" : "Idle"; break;
                case "pickup": clip = Time.time < _actionUntil ? "PickUp" : "Idle"; break;
                case "spell": clip = Time.time < _actionUntil ? "Spellcast_Shoot" : "Idle"; break;
                case "sit": clip = "Sit_Floor_Idle"; break;
                case "sleep": case "lie": clip = "Lie_Idle"; break;
                case "dance": case "wave": case "cheer": clip = Time.time < _actionUntil ? "Cheer" : "Idle"; break;
                case "attack": case "punch": clip = "Unarmed_Melee_Attack_Punch_A"; break;
                case "interact": case "build": clip = "Interact"; break;
                default: clip = "Idle"; break;
            }
            Play(clip);
        }

        void Play(string clip)
        {
            if (_anim == null || clip == _playing || _anim[clip] == null) return;
            if (_playing == null || _anim[clip].wrapMode != WrapMode.Loop) _anim[clip].time = 0f;
            _anim.CrossFade(clip, 0.14f);
            _playing = clip;
        }

        void LateUpdate()
        {
            // KayKit clips carry root translation; the agent owns position (same as the Kotlin build step).
            if (_rootBone != null) _rootBone.localPosition = _rootRest;
        }
    }
}
