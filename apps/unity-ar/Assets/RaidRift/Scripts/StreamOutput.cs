using System;
using System.Collections;
using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Newtonsoft.Json.Linq;
using Unity.WebRTC;
using UnityEngine;

namespace RaidRift
{
    /// <summary>Live AR video to the streamer's PC over WebRTC (Unity's official com.unity.webrtc), same
    /// signalling as the Kotlin CompositeOutput: WS /v1/media as role "capture"; server sends "ready" when
    /// the overlay receiver is connected; we offer, it answers, both trickle candidates. Video only,
    /// 720x1280 portrait, HUD excluded (the AR camera renders into a texture shown under the HUD).</summary>
    public class StreamOutput : MonoBehaviour
    {
        public Camera arCamera;
        public ServerConnection server;
        public Hud hud;

        public bool Active { get; private set; }
        public string Status { get; private set; } = "Stream off";

        const int Width = 720, Height = 1280;
        RenderTexture _view, _stream;
        RTCPeerConnection _pc;
        VideoStreamTrack _track;
        ClientWebSocket _ws;
        CancellationTokenSource _cts;
        readonly ConcurrentQueue<string> _inbox = new ConcurrentQueue<string>();
        Coroutine _webrtcUpdate;

        public void Toggle()
        {
            if (Active) Stop("Stream off");
            else StartStream();
        }

        void StartStream()
        {
            if (!server.HasToken) { hud.Toast("Pair with the server first (Setup)"); return; }
            Active = true;
            Status = "Waiting for the PC receiver…";
            _view = new RenderTexture(Screen.width, Screen.height, 24, RenderTextureFormat.ARGB32);
            _view.Create();
            arCamera.targetTexture = _view;
            hud.SetBackdrop(_view);
            var format = WebRTC.GetSupportedGraphicsFormat(SystemInfo.graphicsDeviceType);
            _stream = new RenderTexture(Width, Height, 0, format);
            _stream.Create();
            _webrtcUpdate = StartCoroutine(WebRTC.Update());
            _cts = new CancellationTokenSource();
            _ = Connect(_cts.Token);
        }

        public void Stop(string status)
        {
            Active = false;
            Status = status;
            _cts?.Cancel();
            try { _ws?.Abort(); } catch { }
            _ws = null;
            _track?.Dispose(); _track = null;
            _pc?.Close(); _pc?.Dispose(); _pc = null;
            if (_webrtcUpdate != null) StopCoroutine(_webrtcUpdate);
            _webrtcUpdate = null;
            if (arCamera != null) arCamera.targetTexture = null;
            hud.SetBackdrop(null);
            if (_view != null) { _view.Release(); Destroy(_view); _view = null; }
            if (_stream != null) { _stream.Release(); Destroy(_stream); _stream = null; }
        }

        void OnDestroy() { if (Active) Stop("Stream off"); }

        async Task Connect(CancellationToken token)
        {
            try
            {
                var url = server.Server.Replace("https://", "wss://").Replace("http://", "ws://") + "/v1/media";
                _ws = new ClientWebSocket();
                _ws.Options.SetRequestHeader("Authorization", "Bearer " + server.Token);
                await _ws.ConnectAsync(new Uri(url), token);
                _inbox.Enqueue("{\"type\":\"_open\"}");
                var buffer = new byte[128 * 1024];
                var sb = new StringBuilder();
                while (_ws.State == WebSocketState.Open && !token.IsCancellationRequested)
                {
                    var result = await _ws.ReceiveAsync(new ArraySegment<byte>(buffer), token);
                    if (result.MessageType == WebSocketMessageType.Close) break;
                    sb.Append(Encoding.UTF8.GetString(buffer, 0, result.Count));
                    if (!result.EndOfMessage) continue;
                    _inbox.Enqueue(sb.ToString());
                    sb.Clear();
                }
                _inbox.Enqueue("{\"type\":\"_closed\"}");
            }
            catch (Exception e)
            {
                if (!token.IsCancellationRequested) _inbox.Enqueue(new JObject { ["type"] = "_error", ["message"] = e.Message }.ToString());
            }
        }

        void Send(JObject message)
        {
            var ws = _ws;
            if (ws == null || ws.State != WebSocketState.Open) return;
            var bytes = Encoding.UTF8.GetBytes(message.ToString(Newtonsoft.Json.Formatting.None));
            _ = ws.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, _cts.Token);
        }

        void Update()
        {
            if (!Active) return;
            // Clean frame (no HUD) for the stream, every rendered frame.
            if (_view != null && _stream != null)
            {
                // Centre-crop the taller phone frame to 9:16 instead of squashing it.
                float source = (float)_view.height / _view.width, target = (float)Height / Width;
                var scale = source > target ? new Vector2(1f, target / source) : new Vector2(source / target, 1f);
                Graphics.Blit(_view, _stream, scale, (Vector2.one - scale) * 0.5f);
            }
            while (_inbox.TryDequeue(out var raw))
            {
                JObject m;
                try { m = JObject.Parse(raw); } catch { continue; }
                switch ((string)m["type"])
                {
                    case "_open": Status = "Connected · open the RaidRift receiver on the PC"; break;
                    case "_closed": Stop("Receiver left · stream stopped"); hud.Toast(Status); return;
                    case "_error": Stop("Stream failed · " + (string)m["message"]); hud.Toast(Status); return;
                    case "ready": StartCoroutine(Offer()); break;
                    case "answer": StartCoroutine(Answer((string)m["sdp"])); break;
                    case "candidate":
                        _pc?.AddIceCandidate(new RTCIceCandidate(new RTCIceCandidateInit
                        {
                            candidate = (string)m["candidate"],
                            sdpMid = (string)m["sdpMid"],
                            sdpMLineIndex = (int?)m["sdpMLineIndex"]
                        }));
                        break;
                }
            }
        }

        IEnumerator Offer()
        {
            _pc?.Close(); _pc?.Dispose();
            var config = new RTCConfiguration { iceServers = new[] { new RTCIceServer { urls = new[] { "stun:stun.l.google.com:19302" } } } };
            _pc = new RTCPeerConnection(ref config);
            _pc.OnIceCandidate = c => Send(new JObject { ["type"] = "candidate", ["candidate"] = c.Candidate, ["sdpMid"] = c.SdpMid, ["sdpMLineIndex"] = c.SdpMLineIndex });
            _pc.OnIceConnectionChange = s => Status = s == RTCIceConnectionState.Connected || s == RTCIceConnectionState.Completed ? "LIVE to PC · 720p" : "Stream " + s.ToString().ToLowerInvariant();
            _track = new VideoStreamTrack(_stream);
            var sender = _pc.AddTrack(_track);
            var parameters = sender.GetParameters();
            foreach (var e in parameters.encodings) { e.maxBitrate = 3_000_000; e.maxFramerate = 30; }
            sender.SetParameters(parameters);
            var offer = _pc.CreateOffer();
            yield return offer;
            if (offer.IsError) { Stop("Offer failed · " + offer.Error.message); yield break; }
            var desc = offer.Desc;
            var local = _pc.SetLocalDescription(ref desc);
            yield return local;
            Send(new JObject { ["type"] = "offer", ["sdp"] = desc.sdp });
            Status = "Offer sent · connecting…";
        }

        IEnumerator Answer(string sdp)
        {
            if (_pc == null) yield break;
            var desc = new RTCSessionDescription { type = RTCSdpType.Answer, sdp = sdp };
            var op = _pc.SetRemoteDescription(ref desc);
            yield return op;
            if (op.IsError) Stop("Answer rejected · " + op.Error.message);
        }
    }
}
