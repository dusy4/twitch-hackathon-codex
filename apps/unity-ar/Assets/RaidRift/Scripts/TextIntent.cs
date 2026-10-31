using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

namespace RaidRift
{
    /// <summary>Port of the Kotlin TextIntent: small offline intent compiler (English/Ukrainian).
    /// Only complete supported instructions become actions; ordinary conversation stays chat.</summary>
    public static class TextIntent
    {
        static readonly Regex Prefix = new Regex(@"^!(rift|ourapp)\s+");
        static readonly Regex Trailing = new Regex(@"[.!?,]+$");
        static readonly Regex Split = new Regex(@"\s*(?:;|,?\s+then\s+|\s+and then\s+|\s+потім\s+|\s+а потім\s+|\s+затем\s+)\s*");
        static readonly Regex Polite = new Regex(@"^(please|could you|can you|будь ласка|пожалуйста)\s+");
        static readonly Regex PoliteEnd = new Regex(@"\s+(please|будь ласка|пожалуйста)$");
        static readonly Regex LeftEn = new Regex(@"^(?:(?:walk|go|move|step|head|run|sprint)\s+)?(?:to the )?left$");
        static readonly Regex LeftUa = new Regex(@"^(?:(?:йди|іди|піди|рухайся|біжи|иди)\s+)?(?:ліворуч|наліво|вліво|налево)$");
        static readonly Regex RightEn = new Regex(@"^(?:(?:walk|go|move|step|head|run|sprint)\s+)?(?:to the )?right$");
        static readonly Regex RightUa = new Regex(@"^(?:(?:йди|іди|піди|рухайся|біжи|иди)\s+)?(?:праворуч|направо|вправо)$");

        static readonly HashSet<string> Join = new HashSet<string> { "join", "join in", "i want to join", "приєднатись", "приєднатися", "приєднайся" };
        static readonly HashSet<string> Forward = new HashSet<string> { "w", "up", "forward", "go forward", "walk forward", "move forward", "walk away", "go away", "відійди", "йди вперед", "іди вперед", "вперед" };
        static readonly HashSet<string> Back = new HashSet<string> { "s", "down", "back", "backward", "go back", "walk back", "move back", "come closer", "come here", "walk towards me", "підійди ближче", "підійди сюди", "йди назад", "іди назад", "назад" };
        static readonly HashSet<string> Jump = new HashSet<string> { "jump", "hop", "jump up", "do a jump", "стрибни", "підстрибни", "пригни", "прыгни" };
        static readonly HashSet<string> Dance = new HashSet<string> { "dance", "start dancing", "do a dance", "танцюй", "потанцюй", "танцуй" };
        static readonly HashSet<string> Wave = new HashSet<string> { "wave", "say hello", "wave hello", "wave at me", "помахай", "помахай рукою", "привітайся" };
        static readonly HashSet<string> Sit = new HashSet<string> { "sit", "sit down", "сядь", "сідай" };
        static readonly HashSet<string> Stop = new HashSet<string> { "stop", "stop moving", "stand", "stand up", "stay here", "стій", "зупинись", "зупинися", "встань", "стоп" };
        static readonly HashSet<string> TurnLeft = new HashSet<string> { "turn left", "face left", "поверни ліворуч", "повернись ліворуч" };
        static readonly HashSet<string> TurnRight = new HashSet<string> { "turn right", "face right", "поверни праворуч", "повернись праворуч" };
        static readonly HashSet<string> TurnAround = new HashSet<string> { "turn around", "turn back", "повернись", "повернися", "розвернись", "розвернися" };

        static bool IsRun(string s) => s.StartsWith("run ") || s.StartsWith("sprint ") || s.StartsWith("біжи ");

        public static List<string> Parse(string input)
        {
            var trimmed = input.Trim();
            if (!trimmed.StartsWith("!") && new[] { "w", "a", "s", "d" }.Contains(trimmed.ToLowerInvariant())) return null;
            var text = Prefix.Replace(trimmed.ToLowerInvariant(), "");
            if (text.StartsWith("!")) text = text.Substring(1);
            text = Trailing.Replace(text, "").Trim();
            if (text.Length > 300 || text.Contains("@")) return null;
            var clauses = Split.Split(text);
            if (clauses.Length > 4) return null;
            var result = new List<string>();
            foreach (var raw in clauses)
            {
                var s = PoliteEnd.Replace(Polite.Replace(raw, ""), "").Trim();
                string action;
                if (Join.Contains(s)) action = "join";
                else if (LeftEn.IsMatch(s) || LeftUa.IsMatch(s)) action = IsRun(s) ? "run left" : "left";
                else if (RightEn.IsMatch(s) || RightUa.IsMatch(s)) action = IsRun(s) ? "run right" : "right";
                else if (Forward.Contains(s)) action = "forward";
                else if (Back.Contains(s)) action = "back";
                else if (s == "a") action = "left";
                else if (s == "d") action = "right";
                else if (Jump.Contains(s)) action = "jump";
                else if (Dance.Contains(s)) action = "dance";
                else if (Wave.Contains(s)) action = "wave";
                else if (Sit.Contains(s)) action = "sit";
                else if (Stop.Contains(s)) action = "stop";
                else if (TurnLeft.Contains(s)) action = "turn_left";
                else if (TurnRight.Contains(s)) action = "turn_right";
                else if (TurnAround.Contains(s)) action = "turn_around";
                else return null;
                result.Add(action);
            }
            if (result.Count > 1 && result.Contains("join")) return null;
            return result;
        }
    }
}
