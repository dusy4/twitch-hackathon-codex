import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";
test.use({
  launchOptions: {
    args: [
      "--enable-webgl",
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--autoplay-policy=no-user-gesture-required",
    ],
  },
});

test("creator pairing explains the Android app and existing relay while masking credentials", async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== "chromium",
    "Creator pairing privacy check runs once",
  );
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Try creator simulator" }).click();
  await page.locator("#mobile-pair").click();
  const panel = page.locator("#mobile-pairing");
  await expect(panel).toContainText("Install RaidRift on your Android phone");
  await expect(panel).toContainText("existing SRT or RTMPS ingest");
  const token = page.locator("#mobile-capture-token");
  await expect(token).toHaveAttribute("type", "password");
  expect((await token.inputValue()).length).toBeGreaterThan(30);
  expect(await panel.textContent()).not.toContain(await token.inputValue());
  await page.screenshot({
    path: "artifacts/chromium-native-pairing-flow.png",
    mask: [panel, page.locator("#overlay-url")],
  });
});

test("WHEP receiver clears frozen decoded frames while the transport stays connected", async ({
  page,
}, info) => {
  test.skip(
    info.project.name !== "chromium",
    "Real peer/freeze check runs once; native SRT proof is separate",
  );
  let available = true,
    deleted = 0;
  await page.addInitScript(() => {
    const state = window as any;
    state.answerWhep = async (offer: string) => {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 360;
      const context = canvas.getContext("2d")!;
      const draw = () => {
        context.fillStyle = "#472978";
        context.fillRect(0, 0, 640, 360);
        context.fillStyle = "#8ce6b0";
        context.fillRect(100 + Math.sin(Date.now() / 200) * 40, 100, 160, 160);
      };
      draw();
      const timer = setInterval(draw, 50);
      const stream = canvas.captureStream(20);
      const audio = new AudioContext();
      const tone = audio.createOscillator();
      const destination = audio.createMediaStreamDestination();
      tone.connect(destination);
      tone.start();
      await audio.resume();
      stream.addTrack(destination.stream.getAudioTracks()[0]);
      const peer = new RTCPeerConnection({ iceServers: [] });
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));
      await peer.setRemoteDescription({ type: "offer", sdp: offer });
      await peer.setLocalDescription(await peer.createAnswer());
      if (peer.iceGatheringState !== "complete")
        await new Promise<void>((resolve) => {
          peer.onicegatheringstatechange = () => {
            if (peer.iceGatheringState === "complete") resolve();
          };
        });
      state.freezeWhep = () => clearInterval(timer);
      state.whepState = () => ({
        connection: peer.connectionState,
        track: stream.getVideoTracks()[0].readyState,
        audioTrack: stream.getAudioTracks()[0].readyState,
      });
      state.cleanupWhep = () => {
        clearInterval(timer);
        peer.close();
        stream.getTracks().forEach((track) => track.stop());
        tone.stop();
        void audio.close();
      };
      return peer.localDescription!.sdp;
    };
  });
  await page.route("http://127.0.0.1:8889/freeze/**", async (route) => {
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Expose-Headers": "Location",
    };
    if (route.request().method() === "OPTIONS")
      return route.fulfill({ status: 204, headers });
    if (route.request().method() === "DELETE") {
      deleted++;
      return route.fulfill({ status: 204, headers });
    }
    if (!available) return route.fulfill({ status: 503, headers });
    const answer = await page.evaluate(
      (offer) => (window as any).answerWhep(offer),
      route.request().postData()!,
    );
    return route.fulfill({
      status: 201,
      headers: {
        ...headers,
        Location: "/freeze/session",
        "Content-Type": "application/sdp",
      },
      body: answer,
    });
  });
  await page.goto(
    `/relay-receiver#source=${encodeURIComponent("http://127.0.0.1:8889/freeze/whep")}`,
  );
  const video = page.locator("#relay-video");
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth))
    .toBe(640);
  await expect
    .poll(() =>
      video.evaluate(
        (v: HTMLVideoElement) => v.getVideoPlaybackQuality().totalVideoFrames,
      ),
    )
    .toBeGreaterThan(3);
  const before = await page.evaluate(() => (window as any).whepState());
  expect(before).toEqual({
    connection: "connected",
    track: "live",
    audioTrack: "live",
  });
  await page.screenshot({ path: "artifacts/chromium-whep-live.png" });
  available = false;
  const frozenAt = Date.now();
  await page.evaluate(() => (window as any).freezeWhep());
  await expect
    .poll(
      () =>
        video.evaluate(
          (v: HTMLVideoElement) => v.srcObject === null && v.videoWidth === 0,
        ),
      { timeout: 7000 },
    )
    .toBe(true);
  await expect(page.locator("#relay-status")).toContainText("offline");
  await expect.poll(() => deleted).toBeGreaterThan(0);
  await page.screenshot({ path: "artifacts/chromium-whep-cleared.png" });
  await writeFile(
    "artifacts/whep-freeze-proof.json",
    JSON.stringify(
      {
        scope:
          "Actual browser peer with synthetic canvas frames, then frozen drawing while sender ICE/track stay live; native SRT is tested separately",
        before,
        clearUpperBoundMs: Date.now() - frozenAt,
        deletedSessions: deleted,
        video: await video.evaluate((v: HTMLVideoElement) => ({
          width: v.videoWidth,
          detached: v.srcObject === null,
          hidden: v.hidden,
        })),
      },
      null,
      2,
    ),
  );
  await page.evaluate(() => (window as any).cleanupWhep());
});
