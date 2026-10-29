import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
test("real browser WebRTC transports synthetic composed frames through authenticated relay to receiver", async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== "chromium",
    "Transport codec smoke runs once",
  );
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Try creator simulator" }).click();
  await page.locator('input[name="paused"]').uncheck();
  await page.getByRole("button", { name: "Save world settings" }).click();
  await expect(page.locator("#toast")).toContainText("saved");
  const pairing = await page.evaluate(async () => {
    const me = await (await fetch("/v1/me")).json();
    return (
      await fetch("/v1/creator/mobile-token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": me.csrf,
        },
        body: JSON.stringify({ consent: true }),
      })
    ).json();
  });
  expect(pairing.token).toBeTruthy();
  const sender = await page.context().newPage();
  await sender.goto("/");
  await sender.evaluate(
    ({ token }) => {
      const globals = window as any;
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 360;
      const ctx = canvas.getContext("2d")!;
      const interval = setInterval(() => {
        ctx.fillStyle = "#442269";
        ctx.fillRect(0, 0, 640, 360);
        ctx.fillStyle = "#b9edc7";
        ctx.fillRect(100 + Math.sin(Date.now() / 200) * 30, 130, 100, 100);
      }, 66);
      document.body.append(canvas);
      const stream = canvas.captureStream(15);
      const peer = new RTCPeerConnection({ iceServers: [] });
      peer.addTrack(stream.getVideoTracks()[0], stream);
      const socket = new WebSocket(
        `ws://${location.host}/v1/media?token=${encodeURIComponent(token)}`,
      );
      const candidates: RTCIceCandidateInit[] = [];
      peer.onicecandidate = (e) => {
        if (e.candidate && socket.readyState === 1)
          socket.send(
            JSON.stringify({
              type: "candidate",
              candidate: e.candidate.candidate,
              sdpMid: e.candidate.sdpMid,
              sdpMLineIndex: e.candidate.sdpMLineIndex,
            }),
          );
      };
      socket.onmessage = (e) => {
        void (async () => {
          const signal = JSON.parse(e.data);
          if (signal.type === "ready") {
            const offer = await peer.createOffer();
            await peer.setLocalDescription(offer);
            socket.send(JSON.stringify({ type: "offer", sdp: offer.sdp }));
          }
          if (signal.type === "answer") {
            await peer.setRemoteDescription({
              type: "answer",
              sdp: signal.sdp,
            });
            for (const c of candidates.splice(0)) await peer.addIceCandidate(c);
          }
          if (signal.type === "candidate") {
            const candidate = {
              candidate: signal.candidate,
              sdpMid: signal.sdpMid,
              sdpMLineIndex: signal.sdpMLineIndex,
            };
            if (peer.remoteDescription) await peer.addIceCandidate(candidate);
            else candidates.push(candidate);
          }
        })();
      };
      globals.cleanupMedia = () => {
        clearInterval(interval);
        stream.getTracks().forEach((t) => t.stop());
        peer.close();
        socket.close();
      };
    },
    { token: pairing.token },
  );
  const receiver = await page.context().newPage();
  await receiver.goto(pairing.receiverUrl);
  await expect
    .poll(
      () =>
        receiver
          .locator("video")
          .evaluate((v: HTMLVideoElement) => v.videoWidth),
      { timeout: 15000 },
    )
    .toBe(640);
  await expect
    .poll(
      () =>
        receiver.locator("video").evaluate((video: HTMLVideoElement) => {
          if (video.videoWidth !== 640 || video.videoHeight !== 360)
            return false;
          const canvas = document.createElement("canvas");
          canvas.width = 640;
          canvas.height = 360;
          const context = canvas.getContext("2d")!;
          context.drawImage(video, 0, 0);
          const background = context.getImageData(5, 5, 1, 1).data;
          const character = context.getImageData(150, 160, 1, 1).data;
          return (
            [68, 34, 105].every(
              (value, index) => Math.abs(background[index] - value) < 15,
            ) &&
            [185, 237, 199].every(
              (value, index) => Math.abs(character[index] - value) < 15,
            ) &&
            video.currentTime > 0.25 &&
            video.getVideoPlaybackQuality().totalVideoFrames >= 3
          );
        }),
      { timeout: 15000 },
    )
    .toBe(true);
  const proof = await receiver
    .locator("video")
    .evaluate((video: HTMLVideoElement) => {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 360;
      const context = canvas.getContext("2d")!;
      context.drawImage(video, 0, 0);
      return {
        background: Array.from(context.getImageData(5, 5, 1, 1).data),
        character: Array.from(context.getImageData(150, 160, 1, 1).data),
        currentTime: video.currentTime,
        decodedFrames: video.getVideoPlaybackQuality().totalVideoFrames,
      };
    });
  await writeFile(
    "artifacts/webrtc-frame-proof.json",
    JSON.stringify(
      {
        source: "synthetic browser canvas; no native camera or AR evidence",
        ...proof,
      },
      null,
      2,
    ),
  );
  await receiver.screenshot({ path: "artifacts/chromium-webrtc-receiver.png" });
  await sender.evaluate(() => (window as any).cleanupMedia());
  await expect
    .poll(() =>
      receiver
        .locator("video")
        .evaluate((video: HTMLVideoElement) => video.srcObject === null),
    )
    .toBe(true);
  await expect
    .poll(() =>
      receiver
        .locator("video")
        .evaluate((video: HTMLVideoElement) => video.videoWidth),
    )
    .toBe(0);
  await sender.close();
  await receiver.close();
});
