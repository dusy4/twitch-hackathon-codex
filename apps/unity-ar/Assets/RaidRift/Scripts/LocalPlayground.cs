using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

namespace RaidRift
{
    /// <summary>Port of the Kotlin LocalPlayground: an offline test raid. Three fixed test viewers
    /// claim characters with !join and send scripted chat. Scheduled inputs are chat messages,
    /// never position mutations; nothing here pretends to be Twitch.</summary>
    public class LocalPlayground
    {
        public class Viewer
        {
            public string Id, Name, CharacterId, Character;
            public Viewer(string id, string name, string characterId, string character) { Id = id; Name = name; CharacterId = characterId; Character = character; }
        }

        struct Scripted { public long At; public string Viewer; public string Text; public Scripted(long at, string v, string t) { At = at; Viewer = v; Text = t; } }

        public readonly List<Viewer> Viewers = new List<Viewer>
        {
            new Viewer("stub-alice", "Alice", "test-alice", "Mage"),
            new Viewer("stub-bob", "Bob", "test-bob", "Rogue"),
            new Viewer("stub-charlie", "Charlie", "test-charlie", "Barbarian"),
        };

        static readonly Scripted[] Scenario =
        {
            new Scripted(1400, "stub-alice", "!join"),
            new Scripted(2300, "stub-bob", "!join"),
            new Scripted(3200, "stub-charlie", "!join"),
            new Scripted(6500, "stub-alice", "wave at me"),
            new Scripted(8500, "stub-bob", "walk right"),
            new Scripted(10500, "stub-charlie", "танцюй"),
            new Scripted(13000, "stub-bob", "стрибни"),
            new Scripted(15500, "stub-alice", "go forward"),
            new Scripted(18000, "stub-charlie", "run right"),
            new Scripted(20500, "stub-bob", "sit down"),
            new Scripted(23500, "stub-alice", "turn around then dance"),
            new Scripted(26500, "stub-charlie", "jump"),
            new Scripted(29500, "stub-bob", "walk left then jump"),
            new Scripted(33000, "stub-charlie", "помахай рукою"),
            new Scripted(36000, "stub-alice", "сядь"),
        };

        public readonly WorldState World = new WorldState { Mode = "LOCAL TEST CHAT" };
        public readonly List<ChatLine> Messages = new List<ChatLine>();
        public bool Running { get; private set; }
        public event Action<ChatLine> OnLine;

        long _elapsed;
        long? _lastTick;
        int _delivered;
        int _raidSerial;
        long _actionSerial;
        readonly Dictionary<string, long> _expires = new Dictionary<string, long>();
        readonly Dictionary<string, long> _bubbles = new Dictionary<string, long>();
        readonly Dictionary<string, (long at, List<string> rest)> _queued = new Dictionary<string, (long, List<string>)>();
        readonly List<(long at, string viewer, string text)> _reactions = new List<(long, string, string)>();

        void Log(string speaker, string text, bool system = false, bool ok = true)
        {
            var line = new ChatLine { Speaker = speaker, Text = text, System = system, Ok = ok };
            Messages.Add(line);
            if (Messages.Count > 80) Messages.RemoveAt(0);
            OnLine?.Invoke(line);
        }

        public void Raid(long now)
        {
            _raidSerial++;
            _queued.Clear(); _expires.Clear(); _bubbles.Clear(); _reactions.Clear();
            _delivered = 0; _elapsed = 0; _lastTick = now; Running = true;
            World.Heroes.Clear();
            World.Raid = new RaidState { Id = "test-" + _raidSerial, From = "TEST VIEWERS", Count = Viewers.Count, Started = now, Test = true };
            Messages.Clear();
            Log("Test raid", "3 viewers raided. Waiting for their !join messages…", true);
        }

        /// <summary>Canned replies to Rift Trail events; they still go through Send and ownership.</summary>
        public void React(string kind, long now)
        {
            if (World.Raid == null) return;
            switch (kind)
            {
                case "discovered": _reactions.Add((now + 1200, "stub-alice", "A crystal! Keep it in view ✨")); break;
                case "collected": _reactions.Add((now + 900, "stub-bob", "Another fragment for our party!")); break;
                case "restored":
                    _reactions.Add((now + 1300, "stub-alice", "wave"));
                    _reactions.Add((now + 2500, "stub-bob", "dance"));
                    _reactions.Add((now + 3700, "stub-charlie", "стрибни"));
                    break;
            }
        }

        public (bool ok, string text) Send(string viewerId, string text, long now)
        {
            var viewer = Viewers.FirstOrDefault(v => v.Id == viewerId);
            if (viewer == null) return (false, "Unknown test viewer");
            var value = text.Trim();
            if (value.Length > 300) value = value.Substring(0, 300);
            if (value.Length == 0) return (false, "Write a message first");
            Log(viewer.Name, value);
            var intent = TextIntent.Parse(value);
            if (intent == null && !value.StartsWith("!")) return (true, "Chat message · try “walk right”, “стрибни”, or “turn around then dance”");
            _queued.Remove(viewer.Id);
            var reply = Apply(intent != null ? intent[0] : value, viewer, now);
            if (reply.ok && intent != null && intent.Count > 1) _queued[viewer.Id] = (now + Duration(intent[0]), intent.Skip(1).ToList());
            var hero = World.Heroes.FirstOrDefault(h => h.Id == viewer.CharacterId);
            if (hero != null) { hero.Message = reply.ok ? value : "Command refused"; _bubbles[hero.Id] = now + 5000; }
            Log("RaidRift → " + viewer.Name, reply.text, true, reply.ok);
            return reply;
        }

        /// <summary>The streamer's own buttons act as the first test viewer, through the same handler.</summary>
        public (bool ok, string text) Command(string text, string actorId, long now)
        {
            var viewer = Viewers.FirstOrDefault(v => v.CharacterId == (actorId ?? Viewers[0].CharacterId)) ?? Viewers[0];
            return Send(viewer.Id, text.StartsWith("!") ? text : "!rift " + text, now);
        }

        static readonly Regex Everyone = new Regex(@"\b(everyone|all characters|all players)\b");
        static readonly Regex StopRe = new Regex(@"\b(stop|stand|idle)\b");
        static readonly Regex SitRe = new Regex(@"\b(sit|perch)\b");
        static readonly Regex SleepRe = new Regex(@"\b(sleep|lie)\b");
        static readonly Regex MoveRe = new Regex(@"\b(run|sprint|walk|go|follow|move)\b");
        static readonly Dictionary<string, string> Keys = new Dictionary<string, string>
            { { "w", "forward" }, { "a", "left" }, { "s", "back" }, { "d", "right" }, { "up", "forward" }, { "down", "back" }, { "backward", "back" } };

        (bool ok, string text) Apply(string text, Viewer viewer, long now)
        {
            var clean = text.ToLowerInvariant();
            foreach (var p in new[] { "!rift ", "!ourapp ", "!" }) if (clean.StartsWith(p)) { clean = clean.Substring(p.Length); break; }
            clean = clean.Trim();
            if (clean == "join")
            {
                if (World.Heroes.All(h => h.Id != viewer.CharacterId))
                {
                    int i = Viewers.IndexOf(viewer);
                    World.Heroes.Add(new HeroState { Id = viewer.CharacterId, Name = viewer.Name, X = .28f + i * .22f, Y = .5f + i * .05f, SpawnedAt = now, Serial = ++_actionSerial });
                }
                return (true, viewer.Name + " owns the " + viewer.Character + " · one viewer, one character");
            }
            if (clean.Contains("@") || Everyone.IsMatch(clean)) return (false, viewer.Name + " can only control their own character");
            bool running = clean.StartsWith("run ");
            if (running && (clean == "run left" || clean == "run right")) clean = clean.Substring(4);
            if (Keys.TryGetValue(clean, out var mapped)) clean = mapped;
            var actor = World.Heroes.FirstOrDefault(h => h.Id == viewer.CharacterId);
            if (actor == null) return (false, "Send !join to claim your character");
            bool directional = clean == "left" || clean == "right" || clean == "forward" || clean == "back";
            string action;
            if (StopRe.IsMatch(clean)) action = "stop";
            else if (clean.StartsWith("turn_")) action = clean;
            else if (SitRe.IsMatch(clean)) action = "sit";
            else if (SleepRe.IsMatch(clean)) action = "sleep";
            else if (clean.Contains("dance")) action = "dance";
            else if (clean.Contains("wave") || clean.Contains("hello")) action = "wave";
            else if (clean.Contains("jump") || clean.Contains("hop")) action = "jump";
            else if (MoveRe.IsMatch(clean)) action = "run";
            else if (directional) action = running ? "run" : "walk";
            else return (false, "Try walk right, come closer, jump, or walk left then jump");

            actor.X = Clamp(actor.X + (clean == "left" ? -.13f : clean == "right" ? .13f : 0f), .04f, .96f);
            actor.Y = Clamp(actor.Y + (clean == "forward" ? -.09f : clean == "back" ? .09f : 0f), .15f, .9f);
            actor.Animation = action;
            actor.Serial = ++_actionSerial;
            _expires.Remove(actor.Id);
            switch (action)
            {
                case "jump": _expires[actor.Id] = now + 1250; break;
                case "turn_left": case "turn_right": case "turn_around": _expires[actor.Id] = now + 800; break;
                case "walk": case "run": _expires[actor.Id] = now + 1500; break;
                case "dance": case "wave": _expires[actor.Id] = now + 6000; break;
            }
            return (true, viewer.Name + " · " + (directional ? "step " + clean : action));
        }

        static float Clamp(float v, float lo, float hi) => v < lo ? lo : v > hi ? hi : v;

        static long Duration(string command)
        {
            switch (command)
            {
                case "jump": return 1300;
                case "left": case "right": case "forward": case "back": case "run left": case "run right": return 1600;
                case "dance": case "wave": return 3000;
                default: return 800;
            }
        }

        /// <summary>Advance the replay. Time pauses while [ready] is false (no landing yet, tracking lost).</summary>
        public void Tick(long now, bool ready)
        {
            long? previous = _lastTick;
            _lastTick = now;
            long gap = previous.HasValue ? Math.Max(0, now - previous.Value) : 0;
            long paused = gap - (ready ? Math.Min(gap, 250) : 0);
            if (paused > 0)
            {
                foreach (var k in _expires.Keys.ToList()) _expires[k] += paused;
                foreach (var k in _bubbles.Keys.ToList()) _bubbles[k] += paused;
                foreach (var k in _queued.Keys.ToList()) _queued[k] = (_queued[k].at + paused, _queued[k].rest);
                for (int i = 0; i < _reactions.Count; i++) _reactions[i] = (_reactions[i].at + paused, _reactions[i].viewer, _reactions[i].text);
            }
            if (!ready) return;
            if (World.Raid != null && previous.HasValue) _elapsed += Math.Min(Math.Max(0, now - previous.Value), 250);
            if (Running)
            {
                while (_delivered < Scenario.Length && Scenario[_delivered].At <= _elapsed)
                {
                    var e = Scenario[_delivered++];
                    Send(e.Viewer, e.Text, now);
                }
                if (_delivered == Scenario.Length)
                {
                    Running = false;
                    Log("Test room", "Chat replay finished. The characters stay here. Send your own commands from Chat.", true);
                }
            }
            foreach (var key in _queued.Keys.ToList())
            {
                var entry = _queued[key];
                if (now < entry.at) continue;
                var viewer = Viewers.First(v => v.Id == key);
                var reply = Apply(entry.rest[0], viewer, now);
                Log("RaidRift → " + viewer.Name, reply.text, true, reply.ok);
                if (reply.ok && entry.rest.Count > 1) _queued[key] = (now + Duration(entry.rest[0]), entry.rest.Skip(1).ToList());
                else _queued.Remove(key);
            }
            var due = _reactions.Where(r => r.at <= now).ToList();
            _reactions.RemoveAll(r => r.at <= now);
            foreach (var r in due) Send(r.viewer, r.text, now);
            foreach (var key in _expires.Where(kv => now >= kv.Value).Select(kv => kv.Key).ToList())
            {
                var hero = World.Heroes.FirstOrDefault(h => h.Id == key);
                if (hero != null) hero.Animation = "idle";
                _expires.Remove(key);
            }
            foreach (var key in _bubbles.Where(kv => now >= kv.Value).Select(kv => kv.Key).ToList())
            {
                var hero = World.Heroes.FirstOrDefault(h => h.Id == key);
                if (hero != null) hero.Message = "";
                _bubbles.Remove(key);
            }
        }
    }
}
