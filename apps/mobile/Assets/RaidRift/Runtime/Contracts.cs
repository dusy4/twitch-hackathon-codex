using System;
namespace RaidRift {
 [Serializable] public class AvatarState { public string id,name,color,cosmetic,animation; public float x,y; }
 [Serializable] public class RaidState { public string id,from; public int count; public long started; public bool test; }
 [Serializable] public class WorldState { public string roomId,mode; public long epoch; public AvatarState[] avatars; public RaidState raid; public WorldConfig config; }
 [Serializable] public class WorldConfig { public bool paused; public bool reducedMotion; public float audio; }
 [Serializable] public class Signal { public string type,sdp,candidate,sdpMid; public int sdpMLineIndex; }
}
