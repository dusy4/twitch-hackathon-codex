using System.Collections.Generic;
using UnityEngine;

namespace RaidRift
{
    /// <summary>Game audio. Original ElevenLabs cues (provenance in Resources/Audio/SOUNDS-PROVENANCE.json):
    /// portal_open, portal_close, discovery, pickup, quest_complete. Plus small sounds synthesized here at
    /// start-up (no third-party audio): step, jump, land, whoosh, chime, hop. Positional sounds come from a
    /// pool of 3D sources so a footstep is heard where the hero is. Pitch/volume jitter avoids repetition.</summary>
    public class Sfx : MonoBehaviour
    {
        const string PrefMute = "raidrift.mute";
        static Sfx _instance;
        readonly Dictionary<string, AudioClip> _clips = new Dictionary<string, AudioClip>();
        readonly Dictionary<string, List<AudioClip>> _variants = new Dictionary<string, List<AudioClip>>();

        bool TryClip(string id, out AudioClip clip)
        {
            if (_variants.TryGetValue(id, out var takes) && takes.Count > 0) { clip = takes[Random.Range(0, takes.Count)]; return true; }
            return _clips.TryGetValue(id, out clip);
        }

        /// <summary>A looping 3D source (rift ambience, moth wings) attached to [parent].</summary>
        public static AudioSource Loop(string id, Transform parent, float volume, float maxDistance = 6f)
        {
            if (_instance == null || !_instance._clips.TryGetValue(id, out var clip)) return null;
            var s = parent.gameObject.AddComponent<AudioSource>();
            s.clip = clip;
            s.loop = true;
            s.spatialBlend = 1f;
            s.rolloffMode = AudioRolloffMode.Logarithmic;
            s.minDistance = 0.5f;
            s.maxDistance = maxDistance;
            s.dopplerLevel = 0f;
            s.volume = Muted ? 0f : volume;
            s.time = Random.Range(0f, clip.length);
            s.Play();
            return s;
        }
        AudioSource _source;
        readonly List<AudioSource> _pool = new List<AudioSource>();
        int _next;

        public static bool Muted
        {
            get => PlayerPrefs.GetInt(PrefMute, 0) == 1;
            set { PlayerPrefs.SetInt(PrefMute, value ? 1 : 0); PlayerPrefs.Save(); }
        }

        void Awake()
        {
            _instance = this;
            _source = gameObject.AddComponent<AudioSource>();
            _source.playOnAwake = false;
            _source.spatialBlend = 0f;
            foreach (var id in new[] { "portal_open", "portal_close", "discovery", "pickup", "quest_complete",
                         "rift_open", "rift_close", "rift_ambience", "moth_flutter", "raid_stinger", "teleport_out", "teleport_in",
                         "spell", "landing_lock", "ui_tap" })
            {
                var clip = Resources.Load<AudioClip>("Audio/" + id);
                if (clip != null) _clips[id] = clip;
            }
            // ElevenLabs variation sets (step_1..4, jump_1..3, land_1..3, cheer_1..2, greet_1..2): a random take
            // per play, so repeated actions never sound identical.
            foreach (var set in new[] { "step", "jump", "land", "cheer", "greet" })
            {
                var takes = new List<AudioClip>();
                for (int i = 1; i <= 6; i++)
                {
                    var c = Resources.Load<AudioClip>($"Audio/{set}_{i}");
                    if (c != null) takes.Add(c);
                }
                if (takes.Count > 0) _variants[set] = takes;
            }
            _clips["step"] = Synth("step", 0.05f, (t, n) => n * Mathf.Exp(-t * 90f) * 0.6f, lowpass: 0.25f);
            _clips["land"] = Synth("land", 0.16f, (t, n) => (Mathf.Sin(2 * Mathf.PI * Mathf.Lerp(140f, 55f, t / 0.16f) * t) * 0.8f + n * 0.3f) * Mathf.Exp(-t * 28f), lowpass: 0.35f);
            _clips["jump"] = Synth("jump", 0.2f, (t, n) => Mathf.Sin(2 * Mathf.PI * (260f * t + 900f * t * t)) * Mathf.Exp(-t * 14f) * 0.5f);
            _clips["hop"] = Synth("hop", 0.12f, (t, n) => Mathf.Sin(2 * Mathf.PI * (420f * t + 1500f * t * t)) * Mathf.Exp(-t * 26f) * 0.4f);
            _clips["whoosh"] = Synth("whoosh", 0.7f, (t, n) => n * Mathf.Sin(Mathf.PI * t / 0.7f) * 0.45f, lowpass: 0.08f);
            _clips["chime"] = Synth("chime", 0.9f, (t, n) => (Mathf.Sin(2 * Mathf.PI * 880f * t) + 0.6f * Mathf.Sin(2 * Mathf.PI * 1318.5f * t) + 0.3f * Mathf.Sin(2 * Mathf.PI * 1760f * t)) * Mathf.Exp(-t * 5f) * 0.22f);
            for (int i = 0; i < 10; i++)
            {
                var go = new GameObject("Sfx3D " + i);
                go.transform.SetParent(transform, false);
                var s = go.AddComponent<AudioSource>();
                s.playOnAwake = false;
                s.spatialBlend = 1f;
                s.rolloffMode = AudioRolloffMode.Logarithmic;
                s.minDistance = 0.4f;
                s.maxDistance = 12f;
                s.dopplerLevel = 0f;
                _pool.Add(s);
            }
        }

        delegate float Wave(float t, float noise);

        static AudioClip Synth(string name, float seconds, Wave wave, float lowpass = 1f)
        {
            const int rate = 44100;
            int n = Mathf.CeilToInt(seconds * rate);
            var data = new float[n];
            var rng = new System.Random(name.GetHashCode());
            float lp = 0f;
            for (int i = 0; i < n; i++)
            {
                float noise = (float)(rng.NextDouble() * 2 - 1);
                lp += (noise - lp) * lowpass;
                data[i] = Mathf.Clamp(wave(i / (float)rate, lp), -1f, 1f);
            }
            // 4 ms fade-in/out: no clicks.
            int fade = Mathf.Min(n / 2, 176);
            for (int i = 0; i < fade; i++) { float g = i / (float)fade; data[i] *= g; data[n - 1 - i] *= g; }
            var clip = AudioClip.Create(name, n, 1, rate, false);
            clip.SetData(data, 0);
            return clip;
        }

        public static void Play(string id, float volume = 0.9f)
        {
            if (_instance == null || Muted || !_instance.TryClip(id, out var clip)) return;
            _instance._source.pitch = 1f;
            _instance._source.PlayOneShot(clip, volume);
        }

        /// <summary>Positional one-shot with pitch/volume jitter.</summary>
        public static void PlayAt(string id, Vector3 position, float volume = 0.6f, float jitter = 0.12f)
        {
            if (_instance == null || Muted || !_instance.TryClip(id, out var clip)) return;
            var s = _instance._pool[_instance._next];
            _instance._next = (_instance._next + 1) % _instance._pool.Count;
            s.transform.position = position;
            s.pitch = 1f + Random.Range(-jitter, jitter);
            s.volume = volume * Random.Range(0.85f, 1f);
            s.clip = clip;
            s.Play();
        }
    }
}
