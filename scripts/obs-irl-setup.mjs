import WebSocket from "ws";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

// Home-OBS half of a standard IRL chain: phone -> relay (MediaMTX) -> OBS -> Twitch.
// Builds one scene: BRB card at the bottom, phone feed above it. When the phone's
// feed drops, the media source goes blank and the BRB card shows through.
// Usage: node scripts/obs-irl-setup.mjs [--overlay <browser source URL>] [--relay <rtsp url>]
// Only drives the isolated portable QA instance configured in .data/obs-qa-credentials.json.
const config = JSON.parse(
  await readFile(".data/obs-qa-credentials.json", "utf8"),
);
if (config.port !== 4456 || !config.root?.includes("Codex-RaidRift-QA"))
  throw Error("Not the isolated QA configuration");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const relay = arg("--relay", "rtsp://127.0.0.1:8554/live/raidrift");
const overlay = arg("--overlay", "");

const ws = new WebSocket(`ws://127.0.0.1:${config.port}`);
const pending = new Map();
let identifiedResolve, identifiedReject;
const identified = new Promise((resolve, reject) => {
  identifiedResolve = resolve;
  identifiedReject = reject;
});
const timer = setTimeout(
  () => identifiedReject(Error("OBS did not identify")),
  15_000,
);
ws.on("error", identifiedReject);
ws.on("message", (data) => {
  const message = JSON.parse(data.toString());
  if (message.op === 0) {
    const auth = message.d.authentication;
    const hash = (text) => createHash("sha256").update(text).digest("base64");
    ws.send(
      JSON.stringify({
        op: 1,
        d: {
          rpcVersion: 1,
          eventSubscriptions: 0,
          ...(auth
            ? {
                authentication: hash(
                  hash(config.password + auth.salt) + auth.challenge,
                ),
              }
            : {}),
        },
      }),
    );
  } else if (message.op === 2) {
    clearTimeout(timer);
    identifiedResolve();
  } else if (message.op === 7) {
    const task = pending.get(message.d.requestId);
    if (task) {
      clearTimeout(task.timer);
      pending.delete(message.d.requestId);
      message.d.requestStatus.result
        ? task.resolve(message.d.responseData ?? {})
        : task.reject(
            Error(
              `${message.d.requestType}: ${message.d.requestStatus.code} ${message.d.requestStatus.comment ?? ""}`,
            ),
          );
    }
  }
});
function call(requestType, requestData = {}) {
  return new Promise((resolve, reject) => {
    const requestId = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(Error(`${requestType} timed out`));
    }, 15_000);
    pending.set(requestId, { resolve, reject, timer });
    ws.send(
      JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }),
    );
  });
}

const W = 1280,
  H = 720;
const sceneName = "RaidRift IRL";
const shot = arg("--shot", "");
try {
  await identified;
  if (shot) {
    // Verification only: save what the program scene currently shows.
    const { imageData } = await call("GetSourceScreenshot", {
      sourceName: sceneName,
      imageFormat: "png",
      imageWidth: W,
      imageHeight: H,
    });
    await writeFile(shot, Buffer.from(imageData.split(",")[1], "base64"));
    console.log(JSON.stringify({ shot }));
    process.exit(0);
  }
  await call("SetVideoSettings", {
    baseWidth: W,
    baseHeight: H,
    outputWidth: W,
    outputHeight: H,
    fpsNumerator: 30,
    fpsDenominator: 1,
  });
  const scenes = await call("GetSceneList");
  if (!scenes.scenes.some((s) => s.sceneName === sceneName))
    await call("CreateScene", { sceneName });
  const kinds = (await call("GetInputKindList", { unversioned: false }))
    .inputKinds;
  const textKind =
    kinds.find((k) => k.startsWith("text_gdiplus")) ??
    kinds.find((k) => k.startsWith("text_ft2"));
  const colorKind =
    kinds.find((k) => k.startsWith("color_source")) ?? "color_source";
  const existing = new Set(
    (await call("GetInputList")).inputs.map((i) => i.inputName),
  );
  async function upsert(inputName, inputKind, inputSettings) {
    if (existing.has(inputName))
      await call("SetInputSettings", {
        inputName,
        inputSettings,
        overlay: true,
      });
    else
      await call("CreateInput", {
        sceneName,
        inputName,
        inputKind,
        inputSettings,
        sceneItemEnabled: true,
      });
    const { sceneItemId } = await call("GetSceneItemId", {
      sceneName,
      sourceName: inputName,
    });
    return sceneItemId;
  }
  const fill = {
    positionX: 0,
    positionY: 0,
    boundsType: "OBS_BOUNDS_SCALE_INNER",
    boundsWidth: W,
    boundsHeight: H,
    alignment: 5,
  };
  // Bottom to top: BRB background, BRB text, phone feed, optional overlay.
  const bg = await upsert("BRB background", colorKind, {
    color: 0xff1c1210,
    width: W,
    height: H,
  });
  const text = await upsert("BRB text", textKind, {
    text: "Signal dropped · reconnecting…\nThe heroes are holding the rift.",
    align: "center",
    valign: "center",
    font: { face: "Segoe UI", size: 48, style: "Bold" },
    color: 0xffffa6bc,
    bk_opacity: 0,
  });
  const feed = await upsert("Phone relay", "ffmpeg_source", {
    is_local_file: false,
    input: relay,
    input_format: "",
    ffmpeg_options: "rtsp_transport=tcp fflags=nobuffer flags=low_delay",
    buffering_mb: 0,
    reconnect_delay_sec: 1,
    restart_on_activate: true,
    close_when_inactive: false,
    clear_on_media_end: true,
    hw_decode: true,
  });
  await call("SetSceneItemTransform", {
    sceneName,
    sceneItemId: bg,
    sceneItemTransform: { positionX: 0, positionY: 0 },
  });
  await call("SetSceneItemTransform", {
    sceneName,
    sceneItemId: text,
    sceneItemTransform: { positionX: W / 2, positionY: H / 2, alignment: 0 },
  });
  await call("SetSceneItemTransform", {
    sceneName,
    sceneItemId: feed,
    sceneItemTransform: fill,
  });
  const order = [bg, text, feed];
  if (overlay) {
    const ov = await upsert("RaidRift overlay", "browser_source", {
      url: overlay,
      width: W,
      height: H,
      fps: 30,
      reroute_audio: false,
      shutdown: false,
    });
    await call("SetSceneItemTransform", {
      sceneName,
      sceneItemId: ov,
      sceneItemTransform: { positionX: 0, positionY: 0 },
    });
    order.push(ov);
  }
  for (const [index, sceneItemId] of order.entries())
    await call("SetSceneItemIndex", {
      sceneName,
      sceneItemId,
      sceneItemIndex: index,
    });
  await call("SetCurrentProgramScene", { sceneName });
  console.log(
    JSON.stringify({
      sceneName,
      relay,
      overlay: overlay || null,
      textKind,
      colorKind,
    }),
  );
} finally {
  ws.close();
}
