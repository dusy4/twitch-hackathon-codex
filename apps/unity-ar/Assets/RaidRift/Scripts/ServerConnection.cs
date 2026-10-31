using System;
using System.Collections;
using System.Text;
using Newtonsoft.Json.Linq;
using UnityEngine;
using UnityEngine.Networking;

namespace RaidRift
{
    /// <summary>Same backend contract as the native Kotlin client (apps/api/server.ts):
    /// GET /v1/native/world polled ~150 ms after each reply, POST /v1/native/chat,
    /// POST /v1/native/debug/event, pairing via GET /v1/debug/pair. Bearer capture token.
    /// 401/403 drop the token (revoked/expired); other errors keep the last world and retry.</summary>
    public class ServerConnection : MonoBehaviour
    {
        public const string DefaultServer = "https://raidrift-pc.tail7252b4.ts.net";
        const string PrefServer = "raidrift.server";
        const string PrefToken = "raidrift.token";

        public string Server { get; private set; }
        public string Token { get; private set; }
        public string Status { get; private set; } = "Offline · local test room";
        public bool Connected { get; private set; }
        public WorldState World { get; private set; }
        public event Action<string, bool> OnNotice;

        Coroutine _loop;

        void Awake()
        {
            Server = PlayerPrefs.GetString(PrefServer, DefaultServer);
            Token = PlayerPrefs.GetString(PrefToken, "");
        }

        public bool HasToken => !string.IsNullOrEmpty(Token);

        public void SetServer(string url)
        {
            url = (url ?? "").Trim().TrimEnd('/');
            if (url.Length == 0) url = DefaultServer;
            if (!url.StartsWith("http")) url = "https://" + url;
            Server = url;
            PlayerPrefs.SetString(PrefServer, Server);
            PlayerPrefs.Save();
        }

        /// <summary>A capture token from Creator Studio (POST /v1/creator/mobile-token), pasted by the streamer.</summary>
        public void SetToken(string token)
        {
            Token = (token ?? "").Trim();
            PlayerPrefs.SetString(PrefToken, Token);
            PlayerPrefs.SetInt(PrefDebugToken, 0);
            PlayerPrefs.Save();
        }

        public void Forget()
        {
            Stop();
            Token = "";
            PlayerPrefs.DeleteKey(PrefToken);
            Status = "Offline · local test room";
        }

        /// <summary>Debug pairing (empty token field) can be redone silently: the private rehearsal server keeps
        /// pairing in memory, so a server restart turns the saved token into a 401 mid-stream.</summary>
        const string PrefDebugToken = "raidrift.token.debug";
        // Missing flag = a token saved by ≤0.20.0, which only had debug pairing in practice; pasted tokens set 0.
        bool DebugToken => PlayerPrefs.GetInt(PrefDebugToken, 1) == 1;

        /// <summary>The Twitch channel live mode wants read. Re-applied whenever the server's world doesn't
        /// show it (server restart, re-pair), so a street stream never silently loses chat.</summary>
        public string DesiredChannel { get; private set; }
        float _nextChannelAttempt;

        IEnumerator PairOnce(bool quiet)
        {
            Status = "Pairing with " + Server + "…";
            using (var req = UnityWebRequest.Get(Server + "/v1/debug/pair"))
            {
                req.timeout = 8;
                yield return req.SendWebRequest();
                if (req.result != UnityWebRequest.Result.Success)
                {
                    Status = (req.responseCode == 404 ? "Server has no test room · start one in Creator Studio" : "Pairing failed · " + req.error) + " · retrying";
                    if (!quiet) OnNotice?.Invoke(Status, false);
                    yield break;
                }
                JObject json;
                try { json = JObject.Parse(req.downloadHandler.text); }
                catch (Exception e) { Status = "Pairing reply unreadable · " + e.Message; if (!quiet) OnNotice?.Invoke(Status, false); yield break; }
                Token = (string)json["token"] ?? "";
                if (Token.Length == 0) { Status = "Pairing reply had no token"; if (!quiet) OnNotice?.Invoke(Status, false); yield break; }
                PlayerPrefs.SetString(PrefToken, Token);
                PlayerPrefs.SetInt(PrefDebugToken, 1);
                PlayerPrefs.Save();
                _nextChannelAttempt = 0f;
                OnNotice?.Invoke("Paired with room " + (string)json["room"], true);
            }
        }

        public void Begin()
        {
            Stop();
            _loop = StartCoroutine(Run());
        }

        public void Stop()
        {
            if (_loop != null) StopCoroutine(_loop);
            _loop = null;
            Connected = false;
            World = null;
        }

        /// <summary>Pair (debug) if needed, then poll; never gives up while wanted. Only a pasted Creator Studio
        /// token that gets revoked stops the loop (re-pairing could silently switch rooms).</summary>
        IEnumerator Run()
        {
            int failures = 0;
            while (true)
            {
                if (!HasToken)
                {
                    yield return PairOnce(failures > 0);
                    if (!HasToken) { failures++; yield return new WaitForSecondsRealtime(Mathf.Min(2f + failures, 6f)); continue; }
                    failures = 0;
                }
                bool unauthorized = false;
                yield return Poll(() => unauthorized = true);
                if (!unauthorized) yield break;
                if (!DebugToken)
                {
                    Status = "Pairing revoked or expired · pair again";
                    OnNotice?.Invoke(Status, false);
                    yield break;
                }
                OnNotice?.Invoke("Server restarted · pairing again", false);
                yield return new WaitForSecondsRealtime(0.5f);
            }
        }

        IEnumerator Poll(Action unauthorized)
        {
            while (true)
            {
                using (var req = UnityWebRequest.Get(Server + "/v1/native/world"))
                {
                    req.timeout = 5;
                    req.SetRequestHeader("Authorization", "Bearer " + Token);
                    yield return req.SendWebRequest();
                    if (req.responseCode == 401 || req.responseCode == 403)
                    {
                        Token = "";
                        PlayerPrefs.DeleteKey(PrefToken);
                        Connected = false;
                        World = null;
                        unauthorized();
                        yield break;
                    }
                    if (req.result == UnityWebRequest.Result.Success)
                    {
                        try
                        {
                            World = ParseWorld(JObject.Parse(req.downloadHandler.text));
                            Connected = true;
                            Status = "Live · " + World.Mode;
                            EnsureChannel();
                        }
                        catch (Exception e) { Status = "Bad world reply · " + e.Message; }
                        yield return new WaitForSecondsRealtime(0.15f);
                    }
                    else
                    {
                        Connected = false;
                        Status = "Server unreachable · retrying";
                        yield return new WaitForSecondsRealtime(1.2f);
                    }
                }
            }
        }

        void EnsureChannel()
        {
            if (string.IsNullOrEmpty(DesiredChannel) || Time.realtimeSinceStartup < _nextChannelAttempt) return;
            if (World.LiveChannel != null && string.Equals(World.LiveChannel.TrimStart('#'), DesiredChannel, StringComparison.OrdinalIgnoreCase)) return;
            if (_channelBusy) return;
            _nextChannelAttempt = Time.realtimeSinceStartup + 8f;
            var channel = DesiredChannel;
            StartCoroutine(ChannelOp(channel, (ok, reply) =>
            {
                if (ok && DesiredChannel == channel) OnNotice?.Invoke($"Reconnected #{channel} chat", true);
            }));
        }

        /// <summary>Channel select/stop requests run one at a time, in order, so a slow automatic re-apply can never
        /// land after End's DELETE and switch chat back on. channel null = DELETE (stop reading).</summary>
        bool _channelBusy;
        IEnumerator ChannelOp(string channel, Action<bool, string> done)
        {
            while (_channelBusy) yield return null;
            // A select that waited behind a stop (or a newer select) is obsolete: don't send it.
            if (channel != null && DesiredChannel != channel) { done?.Invoke(false, "superseded"); yield break; }
            _channelBusy = true;
            try
            {
                if (channel != null) yield return Post("/v1/live/channel", new JObject { ["channel"] = channel }, 10, done);
                else yield return Post("/v1/live/channel", new JObject(), 10, done, "DELETE");
            }
            finally { _channelBusy = false; }
        }

        static WorldState ParseWorld(JObject j)
        {
            var w = new WorldState { Mode = (string)j["mode"] ?? "LIVE" };
            if (j["avatars"] is JArray avatars)
            {
                foreach (var a in avatars)
                {
                    if (string.IsNullOrEmpty((string)a["id"])) continue;
                    w.Heroes.Add(new HeroState
                    {
                        Id = (string)a["id"],
                        Name = (string)a["name"] ?? "",
                        X = (float?)a["x"] ?? .5f,
                        Y = (float?)a["y"] ?? .5f,
                        Animation = (string)a["animation"] ?? "idle",
                        Serial = (long?)a["animationAt"] ?? 0,
                        Message = (string)a["message"] ?? "",
                        SpawnedAt = (long?)a["spawnedAt"] ?? 0,
                        Target = (string)a["target"],
                        SteerX = (float?)a["steer"]?["x"] ?? 0f,
                        SteerY = (float?)a["steer"]?["y"] ?? 0f,
                        SteerUntil = (long?)a["steer"]?["until"] ?? 0,
                        SteerSeq = (long?)a["steer"]?["seq"] ?? 0,
                    });
                    if (w.Heroes.Count >= 12) break;
                }
            }
            if (j["tracks"] is JArray tracks)
                foreach (var t in tracks)
                {
                    var box = t["box"] as JArray;
                    if (box == null || box.Count != 4 || string.IsNullOrEmpty((string)t["id"])) continue;
                    w.Tracks.Add(new TrackState
                    {
                        Id = (string)t["id"],
                        Class = (string)t["class"] ?? "",
                        Box = new[] { (float)box[0], (float)box[1], (float)box[2], (float)box[3] },
                        Source = (string)t["source"] ?? "phone",
                        FrameId = (string)t["frameId"],
                    });
                }
            if (j["live"] is JObject live) { w.LiveChannel = (string)live["channel"]; w.LiveConnected = (bool?)live["connected"] ?? false; }
            if (j["raid"] is JObject r)
                w.Raid = new RaidState { Id = (string)r["id"], From = (string)r["from"] ?? "", Count = (int?)r["count"] ?? 0, Started = (long?)r["started"] ?? 0, Test = (bool?)r["test"] ?? false };
            return w;
        }

        /// <summary>Viewer-style chat; the server only accepts it in SIMULATOR mode.</summary>
        public void Chat(string text, string actorId, Action<bool, string> done)
        {
            var body = new JObject { ["text"] = text.StartsWith("!") ? text : "!rift " + text };
            if (!string.IsNullOrEmpty(actorId)) body["actorId"] = actorId;
            StartCoroutine(Post("/v1/native/chat", body, 30, (ok, reply) =>
            {
                if (!ok) { done?.Invoke(false, reply); return; }
                try
                {
                    var j = JObject.Parse(reply);
                    bool accepted = (bool?)j["ok"] ?? false;
                    done?.Invoke(accepted, accepted ? (string)j["plan"] ?? "OK" : (string)j["message"] ?? (string)j["code"] ?? "Refused");
                }
                catch { done?.Invoke(false, "Bad chat reply"); }
            }));
        }

        bool _tracksInFlight, _frameInFlight;

        /// <summary>Phone tracks (≤50). Single-flight: a slow reply never queues stale positions.</summary>
        public void PostTracks(JArray tracks)
        {
            if (!Connected || _tracksInFlight) return;
            _tracksInFlight = true;
            StartCoroutine(Post("/v1/native/tracks", new JObject { ["tracks"] = tracks }, 5, (ok, _) => _tracksInFlight = false));
        }

        /// <summary>One JPEG of the displayed camera view for the server's open-vocabulary detector.</summary>
        public void PostFrame(string frameId, byte[] jpeg, int width, int height, Action<bool, string> done = null)
        {
            if (!Connected || _frameInFlight || jpeg == null || jpeg.Length > 400_000) return;
            _frameInFlight = true;
            var body = new JObject { ["frameId"] = frameId, ["jpeg"] = Convert.ToBase64String(jpeg), ["width"] = width, ["height"] = height };
            StartCoroutine(Post("/v1/native/frame", body, 10, (ok, reply) => { _frameInFlight = false; done?.Invoke(ok, reply); }));
        }

        /// <summary>Live mode: the server reads this real Twitch channel's chat (anonymous, read-only) and raids.</summary>
        public void SetLiveChannel(string channel, Action<bool, string> done)
        {
            DesiredChannel = (channel ?? "").Trim().TrimStart('#');
            // Not paired yet (or pairing in flight): the poll loop applies it as soon as a world arrives.
            if (!HasToken) { _nextChannelAttempt = 0f; return; }
            _nextChannelAttempt = Time.realtimeSinceStartup + 8f;
            StartCoroutine(ChannelOp(DesiredChannel, done));
        }

        public void StopLiveChannel(Action<bool, string> done = null)
        {
            DesiredChannel = null;
            if (HasToken) StartCoroutine(ChannelOp(null, done));
        }

        public void DebugRaid(Action<bool, string> done) =>
            StartCoroutine(Post("/v1/native/debug/event", new JObject { ["type"] = "raid", ["from"] = "TestRaider", ["viewers"] = 6, ["chatters"] = 6 }, 8, done));

        IEnumerator Post(string path, JObject body, int timeout, Action<bool, string> done, string method = "POST")
        {
            using (var req = new UnityWebRequest(Server + path, method))
            {
                req.uploadHandler = new UploadHandlerRaw(Encoding.UTF8.GetBytes(body.ToString(Newtonsoft.Json.Formatting.None)));
                req.downloadHandler = new DownloadHandlerBuffer();
                req.SetRequestHeader("Content-Type", "application/json");
                req.SetRequestHeader("Authorization", "Bearer " + Token);
                req.timeout = timeout;
                yield return req.SendWebRequest();
                if (req.result == UnityWebRequest.Result.Success) done?.Invoke(true, req.downloadHandler.text);
                else
                {
                    // Surface the server's own refusal text (e.g. 403 VIEWER_CONTROLLER_REQUIRED), never as success.
                    string reason = req.error;
                    try
                    {
                        var j = JObject.Parse(req.downloadHandler?.text ?? "");
                        reason = (string)j["message"] ?? (string)j["code"] ?? reason;
                    }
                    catch { }
                    done?.Invoke(false, reason);
                }
            }
        }
    }
}
