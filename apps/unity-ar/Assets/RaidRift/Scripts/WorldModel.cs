using System.Collections.Generic;

namespace RaidRift
{
    /// <summary>One viewer's character as the world source (server or local test room) describes it.
    /// X/Y are the server's normalized stage coordinates: x across (0..1), y depth (0..1, 0 = far).
    /// Serial increases on every new action so a repeated "jump" restarts.</summary>
    public class HeroState
    {
        public string Id;
        public string Name;
        public float X = 0.5f;
        public float Y = 0.5f;
        public string Animation = "idle";
        public long Serial;
        public string Message = "";
        public long SpawnedAt;
        public string Target;
    }

    public class RaidState
    {
        public string Id;
        public string From;
        public int Count;
        public long Started;
        public bool Test;
    }

    public class WorldState
    {
        public string Mode = "OFFLINE";
        public readonly List<HeroState> Heroes = new List<HeroState>();
        public readonly List<TrackState> Tracks = new List<TrackState>();
        public RaidState Raid;
    }

    /// <summary>A scene target: an object the server's detector found ("server", box in the phone frame
    /// [frameId]) or a spatial target the phone publishes ("there", "streamer", "portal", "furniture top").
    /// Box = [x, y, w, h] normalised to the displayed portrait view, origin top-left.</summary>
    public class TrackState
    {
        public string Id;
        public string Class;
        public float[] Box = new float[4];
        public string Source;
        public string FrameId;
    }

    public class ChatLine
    {
        public string Speaker;
        public string Text;
        public bool System;
        public bool Ok = true;
    }

    /// <summary>Same model choice as the Kotlin client: hash of the hero id over the four KayKit heroes.</summary>
    public static class HeroModels
    {
        public static readonly string[] Names = { "Knight", "Mage", "Rogue", "Barbarian" };

        public static string For(string id)
        {
            if (id == "test-alice") return "Mage";
            if (id == "test-bob") return "Rogue";
            if (id == "test-charlie") return "Barbarian";
            int h = 0;
            foreach (var c in id) h = unchecked(h * 31 + c);
            return Names[((h % Names.Length) + Names.Length) % Names.Length];
        }
    }
}
