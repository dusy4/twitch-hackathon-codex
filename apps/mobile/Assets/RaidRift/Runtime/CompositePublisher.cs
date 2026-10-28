using System;
using System.Collections;
using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using UnityEngine;
using Unity.WebRTC;
namespace RaidRift {
 public sealed class CompositePublisher : MonoBehaviour {
  public ArWorld world; public string Status {get;private set;}="Not broadcasting";
  RTCPeerConnection peer;VideoStreamTrack video;RenderTexture texture;ClientWebSocket socket;CancellationTokenSource cancel;Coroutine capture,update;readonly ConcurrentQueue<string> messages=new();readonly SemaphoreSlim sendLock=new(1,1);bool publishing;
  public async void BeginPublishing(){if(publishing||!world.Consented){Status="Enable camera consent and pair first";return;}try{
   publishing=true;cancel=new CancellationTokenSource();socket=new ClientWebSocket();var url=world.server.Replace("https://","wss://").Replace("http://","ws://").TrimEnd('/')+"/v1/media?token="+Uri.EscapeDataString(world.token);await socket.ConnectAsync(new Uri(url),cancel.Token);
   var config=new RTCConfiguration {iceServers=Array.Empty<RTCIceServer>()};peer=new RTCPeerConnection(ref config);texture=new RenderTexture(1280,720,0,WebRTC.GetSupportedRenderTextureFormat(SystemInfo.graphicsDeviceType));texture.Create();video=new VideoStreamTrack(texture);peer.AddTrack(video);peer.OnIceCandidate=c=>Send(new Signal{type="candidate",candidate=c.Candidate,sdpMid=c.SdpMid,sdpMLineIndex=c.SdpMLineIndex??0});peer.OnConnectionStateChange=s=>Status="Composed output: "+s;update=StartCoroutine(WebRTC.Update());capture=StartCoroutine(Capture());_ = Receive();Status="Broadcast armed. Waiting for OBS receiver (same LAN).";
  }catch(Exception e){Status="Broadcast failed: "+e.GetType().Name;StopPublishing();}}
  async Task Receive(){var bytes=new byte[110000];try{while(socket?.State==WebSocketState.Open&&!cancel.IsCancellationRequested){int offset=0;WebSocketReceiveResult result;do{result=await socket.ReceiveAsync(new ArraySegment<byte>(bytes,offset,bytes.Length-offset),cancel.Token);offset+=result.Count;if(offset>=bytes.Length)throw new InvalidOperationException("Signal too large");}while(!result.EndOfMessage);if(result.MessageType==WebSocketMessageType.Close)break;messages.Enqueue(Encoding.UTF8.GetString(bytes,0,offset));}}catch(OperationCanceledException){}catch{messages.Enqueue("{\"type\":\"closed\"}");}}
  void Update(){while(messages.TryDequeue(out var json)){var data=JsonUtility.FromJson<Signal>(json);if(data.type=="ready")StartCoroutine(Offer());else if(data.type=="answer")StartCoroutine(Answer(data.sdp));else if(data.type=="candidate")peer?.AddIceCandidate(new RTCIceCandidate(new RTCIceCandidateInit{candidate=data.candidate,sdpMid=data.sdpMid,sdpMLineIndex=data.sdpMLineIndex}));else if(data.type=="closed")StopPublishing();}}
  IEnumerator Offer(){if(peer==null)yield break;var operation=peer.CreateOffer();yield return operation;if(operation.IsError){Status="Offer failed";yield break;}var description=operation.Desc;var local=peer.SetLocalDescription(ref description);yield return local;if(!local.IsError)Send(new Signal{type="offer",sdp=description.sdp});}
  IEnumerator Answer(string sdp){var description=new RTCSessionDescription{type=RTCSdpType.Answer,sdp=sdp};yield return peer.SetRemoteDescription(ref description);}
  IEnumerator Capture(){var wait=new WaitForEndOfFrame();while(publishing){yield return wait;if(texture)ScreenCapture.CaptureScreenshotIntoRenderTexture(texture);}}
  async void Send(Signal signal){try{await sendLock.WaitAsync();if(socket?.State==WebSocketState.Open){var payload=Encoding.UTF8.GetBytes(JsonUtility.ToJson(signal));await socket.SendAsync(new ArraySegment<byte>(payload),WebSocketMessageType.Text,true,cancel.Token);}}catch{}finally{sendLock.Release();}}
  public void StopPublishing(){publishing=false;cancel?.Cancel();if(capture!=null)StopCoroutine(capture);if(update!=null)StopCoroutine(update);capture=null;update=null;video?.Dispose();video=null;peer?.Close();peer?.Dispose();peer=null;if(texture){texture.Release();Destroy(texture);texture=null;}socket?.Dispose();socket=null;cancel?.Dispose();cancel=null;Status="Broadcast stopped. No media retained.";}
  void OnDestroy(){StopPublishing();}
 }
}
