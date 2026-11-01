using System.Collections.Generic;
using System.Linq;
using UnityEngine;

namespace RaidRift
{
    public partial class RaidRiftApp
    {
        public SelfieMode selfie;
        bool _selfiePaused;
        readonly Dictionary<GameObject, bool> _selfieHidden = new Dictionary<GameObject, bool>();
        readonly HashSet<string> _selfieReturn = new HashSet<string>();

        void InitSelfie()
        {
            if (selfie == null) return;
            selfie.Notice += SelfieNotice;
            selfie.Changed += SelfieChanged;
            selfie.RoomLost += SelfieRoomLost;
        }

        void SelfieRoomLost() => ResetRoom();

        /// <summary>ARCore may reset its world origin when the physical camera changes, and the rear camera can come
        /// back without positional tracking. Never keep a room in the wrong frame: once tracking is steady, compare
        /// the pose with the one saved before the flip (the streamer holds still for selfie). A jump bigger than a
        /// handheld flip, or no tracking within 10 s, resets the room (and the session if tracking never came).</summary>
        System.Collections.IEnumerator VerifyRoomAfterSelfie()
        {
            float start = Time.realtimeSinceStartup;
            int steady = 0;
            while (steady < 15)
            {
                if (selfie == null || selfie.WorldPaused) yield break; // flipped again: the next return re-checks
                steady = UnityEngine.XR.ARFoundation.ARSession.state == UnityEngine.XR.ARFoundation.ARSessionState.SessionTracking ? steady + 1 : 0;
                if (Time.realtimeSinceStartup - start > 20f)
                {
                    if (session != null) session.Reset();
                    ResetRoom();
                    hud.Toast("Room tracking restarted · point at the floor to land again", 4f);
                    yield break;
                }
                yield return null;
            }
            // Owner 2026-11-01: switching the camera must not move or reset anything. Heroes and the room stay put.
        }

        void SelfieNotice(string message) { if (hud != null) hud.Toast(message, 3f); }
        void SelfieChanged(bool active) => RefreshSelfieButton();
        bool SelfieBlocksButton(string id)
        {
            if (selfie == null || !selfie.WorldPaused) return false;
            if (id != "scan" && id != "trail" && id != "follow" && id != "reset-room") return false;
            hud.Toast("Return to the room camera to use room tools");
            return true;
        }
        void RefreshSelfieButton()
        {
            if (hud != null) hud.SetButton("selfie", selfie != null && selfie.IsSelfie ? "Room camera" : "Selfie", selfie != null && selfie.IsSelfie);
        }

        void HideForSelfie(GameObject go)
        {
            if (go == null || _selfieHidden.ContainsKey(go)) return;
            _selfieHidden.Add(go, go.activeSelf);
            go.SetActive(false);
        }

        // Called before the world director. Retains scan settings, raid ids and server state.
        bool UpdateSelfie()
        {
            if (selfie == null) return false;
            if (!selfie.WorldPaused)
            {
                if (_selfiePaused)
                {
                    _selfiePaused = false;
                    foreach (var pair in _selfieHidden) if (pair.Key != null) pair.Key.SetActive(pair.Value);
                    _selfieHidden.Clear();
                    // Heroes were never moved during selfie: nothing to re-place.
                    _roam.Clear();
                    _steer.Clear();
                    _tapGoal = null;
                    _candidate = null;
                    _nextMaterialPass = 0f;
                    StartCoroutine(VerifyRoomAfterSelfie());
                }
                return false;
            }

            if (!_selfiePaused)
            {
                _selfiePaused = true;
                if (sceneTracks != null) { sceneTracks.active = false; sceneTracks.ResetScene(); }
                HideForSelfie(_rift != null ? _rift.gameObject : null);
                HideForSelfie(_marker);
                HideForSelfie(moths != null ? moths.gameObject : null);
                HideForSelfie(trail != null && trail.Site != null ? trail.Site.gameObject : null);
                if (_heroRoot != null) HideForSelfie(_heroRoot.gameObject);
                WorldTags.Clear();
            }

            if (!UseServer) _playground.Tick(NowMs, selfie.IsSelfie && !selfie.IsSwitching);
            var world = CurrentWorld();
            // Owner 2026-11-01: "I'm just switching the camera — remember where they persist." The front camera has no
            // room tracking, so the party is not drawn here; every hero stays exactly where it stood (paused, hidden)
            // and is shown again in place when the room camera returns. Joins/leaves are still tracked.
            bool gyro = selfie.IsSelfie && !selfie.IsSwitching && selfie.GyroView;
            if (selfie.IsSelfie && !selfie.IsSwitching) KeepSelfieRoster(world);
            // Gyro view: the camera is aimed by the phone's rotation from where it stood, so the room content can be
            // drawn where it really is — point the selfie camera at a hero and it is there. Positions never change.
            foreach (var pair in _selfieHidden) if (pair.Key != null) pair.Key.SetActive(gyro ? pair.Value : false);
            _heroRoot.gameObject.SetActive(gyro);
            if (gyro)
            {
                foreach (var state in world.Heroes)
                    if (_heroes.TryGetValue(state.Id, out var h) && h.Spawned)
                    {
                        h.DisplayName = state.Name;
                        h.Message = state.Message;
                        h.Act(state.Animation, state.Serial); // emotes play in place; no room targets in selfie
                    }
                WorldTags.Update(arCamera, _heroes.Values, true);
            }
            else WorldTags.Clear();
            hud.SetStatus($"Selfie party · {_heroes.Count} heroes", "Room scan and navigation paused",
                selfie.IsSwitching ? "Switching cameras…" : !selfie.IsSelfie ? "Point at the room · tap selfie to retry" : selfie.GyroView ? "Turn to where your party stands · stay in place" : "Party is waiting in the room · flip back to see them");
            hud.SetScan(1f, "");
            hud.SetFeed(UseServer ? _serverLines : _playground.Messages);
            LiveTick(world); // Publisher retains the same Camera.targetTexture.
            return true;
        }

        /// <summary>Selfie: keep the hero list in step with chat (new viewers get a hero that lands when the room camera
        /// returns; leavers are removed) without touching anyone's position.</summary>
        void KeepSelfieRoster(WorldState world)
        {
            var alive = new HashSet<string>();
            foreach (var state in world.Heroes)
            {
                alive.Add(state.Id);
                if (!_heroes.ContainsKey(state.Id))
                    _heroes[state.Id] = Hero.Create(state.Id, HeroModels.For(state.Id), room.AgentTypeId, _heroRoot);
            }
            foreach (var id in _heroes.Keys.Where(k => !alive.Contains(k)).ToList())
            {
                Destroy(_heroes[id].gameObject);
                _heroes.Remove(id);
                _selfieReturn.Remove(id);
            }
        }

        void SyncSelfieHeroes(WorldState world)
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
                if (selfie.TryGetPerch(index++, out var position, out var rotation))
                    hero.SetSelfiePerch(position, rotation, selfie.HeroScale);
                // Room-targeted sit/dance plays immediately at the perch, without stale room targets.
                hero.Act(state.Animation, state.Serial);
            }
            foreach (var id in _heroes.Keys.Where(k => !alive.Contains(k)).ToList())
            {
                Destroy(_heroes[id].gameObject);
                _heroes.Remove(id);
                _selfieReturn.Remove(id);
            }
        }

        // Retry after subsequent world frames if the floor is not scanned yet. Never spawn at zero.
        bool ReturnSelfieHero(Hero hero, int index)
        {
            if (!_selfieReturn.Contains(hero.Id)) return false;
            if (!room.HasNavMesh || !room.FloorUnderCamera(out var floor)) return true;
            var flat = Vector3.ProjectOnPlane(arCamera.transform.forward, Vector3.up).normalized;
            var probe = Slot(floor + flat * 0.65f, index);
            if (!room.Sample(probe, 0.6f, out var spot) || Mathf.Abs(spot.y - floor.y) > 0.20f) return true;
            var toward = Vector3.ProjectOnPlane(arCamera.transform.position - spot, Vector3.up);
            if (!hero.Place(spot, Quaternion.LookRotation(toward.sqrMagnitude > 1e-4f ? toward.normalized : Vector3.back))) return true;
            _selfieReturn.Remove(hero.Id);
            return false;
        }

        void OnDestroy()
        {
            if (selfie == null) return;
            selfie.Notice -= SelfieNotice;
            selfie.Changed -= SelfieChanged;
            selfie.RoomLost -= SelfieRoomLost;
        }
    }
}
