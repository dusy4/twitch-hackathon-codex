/** Owner-configured WHEP watch endpoint, kept in the URL fragment and memory. */
export function relayEndpoint(value: string) {
  if (value.length > 4096) throw Error("Relay watch URL is too long.");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw Error("Enter a WHEP watch URL.");
  }
  const local = ["127.0.0.1", "localhost"].includes(url.hostname);
  if (
    !(url.protocol === "https:" || (url.protocol === "http:" && local)) ||
    url.username ||
    url.password ||
    url.hash ||
    !url.pathname.endsWith("/whep")
  )
    throw Error("Use an HTTPS WHEP watch URL, or a private loopback bridge.");
  return url;
}

/** Receives media only. It never opens a camera or submits world/economy actions. */
export function receiveRelay(
  video: HTMLVideoElement,
  endpoint: URL,
  bearer: string,
  status: (message: string) => void,
) {
  if (bearer.length > 4000 || /[\s\x00-\x1f\x7f]/.test(bearer))
    throw Error("Invalid relay watch authorization.");
  let disposed = false,
    generation = 0,
    release: (() => void) | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const headers = { ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) };

  function clearVideo() {
    video.hidden = true;
    video.pause();
    (video.srcObject as MediaStream | null)
      ?.getTracks()
      .forEach((track) => track.stop());
    video.srcObject = null;
    video.removeAttribute("src");
    video.load();
  }
  function schedule() {
    if (!disposed)
      retry = setTimeout(() => {
        void connect();
      }, 1500);
  }
  async function connect() {
    if (disposed) return;
    release?.();
    const current = ++generation;
    const controller = new AbortController();
    const peer = new RTCPeerConnection({ iceServers: [] });
    const stream = new MediaStream();
    let session: URL | undefined,
      failed = false;
    let lastFrame = performance.now(),
      firstFrame = false;
    let frameCallback: number | undefined;
    const timeout = setTimeout(() => controller.abort(), 12_000);
    const stillCurrent = () => !disposed && current === generation && !failed;
    const watchdog = setInterval(() => {
      if (
        stillCurrent() &&
        performance.now() - lastFrame > (firstFrame ? 3000 : 15_000)
      )
        fail();
    }, 250);

    const teardown = () => {
      failed = true;
      clearTimeout(timeout);
      clearInterval(watchdog);
      controller.abort();
      if (frameCallback !== undefined)
        video.cancelVideoFrameCallback?.(frameCallback);
      peer.ontrack = null;
      peer.onconnectionstatechange = null;
      peer.close();
      stream.getTracks().forEach((track) => track.stop());
      if (current === generation || disposed) clearVideo();
      if (session)
        void fetch(session, {
          method: "DELETE",
          headers,
          credentials: "omit",
          referrerPolicy: "no-referrer",
          redirect: "error",
          keepalive: true,
          signal: AbortSignal.timeout(2500),
        }).catch(() => {});
    };
    function fail() {
      if (!stillCurrent()) return;
      teardown();
      status("Feed offline · reconnecting");
      schedule();
    }
    release = teardown;
    clearVideo();
    status("Connecting to relay…");
    const decoded = () => {
      if (!stillCurrent()) return;
      lastFrame = performance.now();
      firstFrame = true;
      video.hidden = false;
      status("");
      frameCallback = video.requestVideoFrameCallback(decoded);
    };
    // Actual decoded video progress, independent of audio/currentTime or ICE state.
    if (typeof video.requestVideoFrameCallback !== "function") {
      teardown();
      status("This receiver requires a browser with video frame callbacks.");
      return;
    }
    frameCallback = video.requestVideoFrameCallback(decoded);
    peer.ontrack = (event) => {
      if (!stillCurrent()) {
        event.track.stop();
        return;
      }
      stream.addTrack(event.track);
      if (video.srcObject !== stream) {
        video.srcObject = stream;
        video.hidden = false;
        void video.play().catch(fail);
      }
      event.track.onended = fail;
    };
    peer.onconnectionstatechange = () => {
      if (["disconnected", "failed", "closed"].includes(peer.connectionState))
        fail();
    };
    try {
      peer.addTransceiver("video", { direction: "recvonly" });
      peer.addTransceiver("audio", { direction: "recvonly" });
      await peer.setLocalDescription(await peer.createOffer());
      if (peer.iceGatheringState !== "complete")
        await new Promise<void>((resolve, reject) => {
          const gathered = () => {
            if (peer.iceGatheringState === "complete") {
              clean();
              resolve();
            }
          };
          const aborted = () => {
            clean();
            reject(Error("Relay connection timed out"));
          };
          const clean = () => {
            peer.removeEventListener("icegatheringstatechange", gathered);
            controller.signal.removeEventListener("abort", aborted);
          };
          peer.addEventListener("icegatheringstatechange", gathered);
          controller.signal.addEventListener("abort", aborted, { once: true });
          if (controller.signal.aborted) aborted();
          else gathered();
        });
      if (!stillCurrent()) return;
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/sdp" },
        body: peer.localDescription!.sdp,
        credentials: "omit",
        referrerPolicy: "no-referrer",
        redirect: "error",
        signal: controller.signal,
      });
      if (response.status !== 201) throw Error("Relay is unavailable");
      const location = response.headers.get("Location");
      if (!location || location.length > 4096)
        throw Error("Missing relay session");
      session = new URL(location, endpoint);
      if (
        session.origin !== endpoint.origin ||
        session.username ||
        session.password
      ) {
        session = undefined;
        throw Error("Invalid relay session origin");
      }
      const answer = await response.text();
      if (answer.length > 128_000) throw Error("Relay answer exceeds limit");
      if (!stillCurrent()) {
        teardown();
        return;
      }
      await peer.setRemoteDescription({ type: "answer", sdp: answer });
      clearTimeout(timeout);
    } catch {
      fail();
    }
  }
  void connect();
  return () => {
    disposed = true;
    generation++;
    clearTimeout(retry);
    release?.();
    clearVideo();
  };
}
