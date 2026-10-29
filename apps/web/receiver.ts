export function receiveMedia(
  video: HTMLVideoElement,
  token: string,
  status: (text: string) => void,
) {
  const socket = new WebSocket(
    `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/v1/media?token=${encodeURIComponent(token)}`,
  );
  const peer = new RTCPeerConnection({ iceServers: [] });
  const buffered: RTCIceCandidateInit[] = [];
  let closed = false;
  const release = () => {
    if (closed) return;
    closed = true;
    buffered.length = 0;
    peer.close();
    const stream = video.srcObject as MediaStream | null;
    stream?.getTracks().forEach((track) => track.stop());
    video.srcObject = null;
  };
  peer.ontrack = (e) => {
    if (closed) {
      e.track.stop();
      return;
    }
    video.srcObject = e.streams[0] || new MediaStream([e.track]);
    void video.play().catch(() => status("Click play to enable media."));
    status("Receiving composed camera + AR video");
  };
  peer.onicecandidate = (e) => {
    if (e.candidate && socket.readyState === WebSocket.OPEN)
      socket.send(
        JSON.stringify({
          type: "candidate",
          candidate: e.candidate.candidate,
          sdpMid: e.candidate.sdpMid,
          sdpMLineIndex: e.candidate.sdpMLineIndex,
        }),
      );
  };
  peer.onconnectionstatechange = () => {
    if (!closed) status(`Media ${peer.connectionState} · direct LAN mode`);
  };
  socket.onmessage = (e) => {
    if (closed) return;
    void (async () => {
      const data = JSON.parse(e.data);
      if (data.type === "offer") {
        await peer.setRemoteDescription({ type: "offer", sdp: data.sdp });
        for (const c of buffered.splice(0)) await peer.addIceCandidate(c);
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        socket.send(JSON.stringify({ type: "answer", sdp: answer.sdp }));
      } else if (data.type === "candidate") {
        const c = {
          candidate: data.candidate,
          sdpMid: data.sdpMid,
          sdpMLineIndex: data.sdpMLineIndex,
        };
        if (peer.remoteDescription) await peer.addIceCandidate(c);
        else buffered.push(c);
      }
    })().catch((error) => status(`Media error: ${error.message}`));
  };
  socket.onopen = () => {
    status("Waiting for an explicitly paired mobile broadcaster");
    socket.send(JSON.stringify({ type: "ready" }));
  };
  socket.onclose = () => {
    release();
    status("Media session ended. Generate a fresh pairing token.");
  };
  return () => {
    socket.close();
    release();
  };
}
