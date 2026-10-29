import WebSocket from 'ws';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

// Only the disposable, explicitly configured portable QA instance. Never discover user OBS.
const config = JSON.parse(await readFile('.data/obs-qa-credentials.json', 'utf8'));
if (config.port !== 4456 || !config.root?.includes('Codex-RaidRift-QA')) throw Error('Not the isolated QA configuration');
const ws = new WebSocket(`ws://127.0.0.1:${config.port}`);
const pending = new Map();
let identifiedResolve, identifiedReject;
const identified = new Promise((resolve, reject) => { identifiedResolve = resolve; identifiedReject = reject; });
const timer = setTimeout(() => identifiedReject(Error('Isolated OBS did not identify')), 15_000);
ws.on('error', identifiedReject);
ws.on('message', data => {
  const message = JSON.parse(data.toString());
  if (message.op === 0) {
    const auth = message.d.authentication;
    const hash = text => createHash('sha256').update(text).digest('base64');
    ws.send(JSON.stringify({ op: 1, d: { rpcVersion: 1, eventSubscriptions: 0,
      ...(auth ? { authentication: hash(hash(config.password + auth.salt) + auth.challenge) } : {}) } }));
  } else if (message.op === 2) { clearTimeout(timer); identifiedResolve(); }
  else if (message.op === 7) {
    const task = pending.get(message.d.requestId);
    if (task) {
      clearTimeout(task.timer); pending.delete(message.d.requestId);
      message.d.requestStatus.result ? task.resolve(message.d.responseData ?? {}) : task.reject(Error(`${message.d.requestType}: ${message.d.requestStatus.code} ${message.d.requestStatus.comment ?? ''}`));
    }
  }
});
function call(requestType, requestData = {}) {
  return new Promise((resolve, reject) => {
    const requestId = randomUUID();
    const timer = setTimeout(() => { pending.delete(requestId); reject(Error(`${requestType} timed out`)); }, 15_000);
    pending.set(requestId, { resolve, reject, timer });
    ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
  });
}
try {
  await identified;
  const command = process.argv[2] ?? 'status';
  const measuredSource = process.argv.includes('--whep') ? 'Native WHEP Relay' : 'Native AR Relay';
  if (command === 'status') {
    const version = await call('GetVersion');
    console.log(JSON.stringify({ obsVersion: version.obsVersion, websocketVersion: version.obsWebSocketVersion,
      video: await call('GetVideoSettings'), record: await call('GetRecordStatus'), inputs: await call('GetInputList') }));
  } else if (command === 'setup') {
    await call('SetVideoSettings', { baseWidth: 1280, baseHeight: 720, outputWidth: 1280, outputHeight: 720, fpsNumerator: 30, fpsDenominator: 1 });
    await call('SetRecordDirectory', { recordDirectory: config.recordings });
    for (const [parameterName, parameterValue] of [['StreamEncoder', 'x264'], ['RecEncoder', 'x264'], ['RecQuality', 'HQ'], ['RecFormat2', 'mkv']]) {
      await call('SetProfileParameter', { parameterCategory: 'SimpleOutput', parameterName, parameterValue });
    }
    const sceneName = 'RaidRift Native QA';
    const scenes = await call('GetSceneList');
    if (!scenes.scenes.some(scene => scene.sceneName === sceneName)) await call('CreateScene', { sceneName });
    const inputs = await call('GetInputList');
    // Prevent recording workstation audio. The only intended audio is the native relay track.
    for (const input of inputs.inputs) if (input.inputName !== 'Native AR Relay') {
      await call('SetInputMute', { inputName: input.inputName, inputMuted: true }).catch(() => {});
    }
    const inputSettings = { is_local_file: false, input: 'rtmp://127.0.0.1:1936/live/qa',
      input_format: 'flv', ffmpeg_options: 'rtmp_live=live rtmp_buffer=100 analyzeduration=1000000 probesize=32768 fflags=nobuffer flags=low_delay',
      buffering_mb: 0, reconnect_delay_sec: 1, restart_on_activate: true, close_when_inactive: false, hw_decode: true };
    if (!inputs.inputs.some(input => input.inputName === 'Native AR Relay')) {
      await call('CreateInput', { sceneName, inputName: 'Native AR Relay', inputKind: 'ffmpeg_source', inputSettings, sceneItemEnabled: true });
    } else await call('SetInputSettings', { inputName: 'Native AR Relay', inputSettings, overlay: true });
    await call('SetCurrentProgramScene', { sceneName });
    const item = await call('GetSceneItemId', { sceneName, sourceName: 'Native AR Relay' });
    await call('SetSceneItemTransform', { sceneName, sceneItemId: item.sceneItemId, sceneItemTransform: {
      positionX: 0, positionY: 0, boundsType: 'OBS_BOUNDS_SCALE_INNER', boundsWidth: 1280, boundsHeight: 720, alignment: 5 } });
    console.log(JSON.stringify({ setup: true, sceneName, input: 'Private SSH-forwarded RTMP relay, camera composition supplied by Android' }));
  } else if (command === 'whep-setup') {
    const sceneName = 'RaidRift Native QA';
    const inputs = await call('GetInputList');
    const inputSettings = { url: `http://127.0.0.1:3400/relay-receiver#source=${encodeURIComponent('http://127.0.0.1:8889/live/webrtc/whep')}`,
      width: 1280, height: 720, fps: 30, reroute_audio: true, shutdown: true };
    if (!inputs.inputs.some(input => input.inputName === 'Native WHEP Relay')) {
      await call('CreateInput', { sceneName, inputName: 'Native WHEP Relay', inputKind: 'browser_source', inputSettings, sceneItemEnabled: true });
    } else await call('SetInputSettings', { inputName: 'Native WHEP Relay', inputSettings, overlay: true });
    for (const [sourceName, sceneItemEnabled] of [['Native AR Relay', false], ['Native WHEP Relay', true]]) {
      const item = await call('GetSceneItemId', { sceneName, sourceName });
      await call('SetSceneItemEnabled', { sceneName, sceneItemId: item.sceneItemId, sceneItemEnabled });
      await call('SetInputMute', { inputName: sourceName, inputMuted: !sceneItemEnabled });
    }
    console.log(JSON.stringify({ receiver: 'Private loopback WHEP Browser Source; native H.264 copied, AAC converted to Opus at bridge' }));
  } else if (['latency-orbit', 'latency-action', 'pause-proof', 'revoke-proof'].includes(command)) {
    const stopping = command === 'pause-proof' || command === 'revoke-proof';
    const endpoint = JSON.parse(await readFile('.data/boat-ssh-endpoint2.json', 'utf8'));
    const address = endpoint.sshEndpoint ?? `${endpoint.machineIp}:22`;
    const split = address.lastIndexOf(':');
    const folder = stopping ? `.data/native-${command}` : command === 'latency-action' ? '.data/native-action-latency' : '.data/native-orbit-latency';
    await mkdir(folder, { recursive: true });
    const frames = [];
    async function capture(index) {
      const requested = Date.now();
      const result = await call('GetSourceScreenshot', { sourceName: measuredSource, imageFormat: 'png', imageWidth: 1280, imageHeight: 720 });
      const received = Date.now();
      const path = `${folder}/${String(index).padStart(3, '0')}.png`;
      await writeFile(path, Buffer.from(result.imageData.split(',')[1], 'base64'));
      frames.push({ index, requested, received, path });
    }
    for (let i = 0; i < 8; i++) { await capture(i); await new Promise(resolve => setTimeout(resolve, 100)); }
    const eventRequested = Date.now();
    const event = stopping ? fetch(`http://127.0.0.1:3403/__qa/${command === 'pause-proof' ? 'pause' : 'revoke'}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:3403' }, body: '{}',
    }).then(async response => {
      if (!response.ok) throw Error(`Synthetic stop returned ${response.status}`);
      return { completed: Date.now(), result: await response.json() };
    }) : command === 'latency-action' ? fetch('http://127.0.0.1:3403/__qa/action', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://127.0.0.1:3403' },
      body: JSON.stringify({ actor: 'one', prompt: process.argv[3] ?? 'right' }),
    }).then(async response => {
      if (!response.ok) throw Error(`Synthetic actor action returned ${response.status}`);
      return { completed: Date.now(), result: await response.json() };
    }) : new Promise((resolve, reject) => {
      const process = spawn('ssh', ['-p', address.slice(split + 1), '-i', join(globalThis.process.env.USERPROFILE, '.ssh/ascii_box_ed25519'),
        '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'UserKnownHostsFile=E:/Codex-RaidRift-QA-2026-10-29/boat-known-hosts',
        '-o', 'HostKeyAlias=bx_x6phhkgj', `user@${address.slice(0, split)}`,
        'date +%s%3N; /home/user/raidrift-qa/android-sdk/platform-tools/adb shell input swipe 200 500 560 500 300; date +%s%3N'], { windowsHide: true });
      let stdout = ''; process.stdout.on('data', chunk => { stdout += chunk; });
      process.on('error', reject); process.on('exit', code => code === 0 ? resolve({ completed: Date.now(), vmTimes: stdout.trim().split(/\s+/).map(Number) }) : reject(Error('QA gesture failed')));
    });
    for (let i = 8; i < (stopping ? 64 : 168); i++) { await capture(i); await new Promise(resolve => setTimeout(resolve, 100)); }
    const gesture = await event;
    const scope = stopping ? `Synthetic world ${command === 'pause-proof' ? 'pause' : 'revocation'} request to received OBS source clearing; actual native SRT, private WebRTC bridge, emulator camera-off` : command === 'latency-action' ? `Synthetic actor HTTP action request to decoded OBS frame through native snapshot/render/encode, SRT relay and ${measuredSource === 'Native WHEP Relay' ? 'RTMP-to-WebRTC bridge (native H.264 copy, AAC-to-Opus)' : 'RTMP Media Source'}; camera-off emulator, not live Twitch or physical capture-to-OBS latency` : 'Conservative local gesture request to decoded OBS frame; emulated camera-off preview, not physical capture-to-OBS latency';
    await writeFile(`${folder}/samples.json`, JSON.stringify({ scope, receiver: measuredSource, eventRequested, gesture, frames }, null, 2));
    console.log(JSON.stringify({ samples: frames.length, gesture, manifest: `${folder}/samples.json` }));
  } else if (command === 'diagnostics') {
    console.log(JSON.stringify({ stats: await call('GetStats'), record: await call('GetRecordStatus'),
      scene: await call('GetCurrentProgramScene'), items: await call('GetSceneItemList', { sceneName: 'RaidRift Native QA' }) }));
  } else if (command === 'reload-profile') {
    const current = await call('GetProfileList');
    if (!current.profiles.includes('RaidRiftRefresh')) await call('CreateProfile', { profileName: 'RaidRiftRefresh' });
    else await call('SetCurrentProfile', { profileName: 'RaidRiftRefresh' });
    await new Promise(resolve => setTimeout(resolve, 500));
    await call('SetCurrentProfile', { profileName: 'RaidRiftQA' });
    console.log(JSON.stringify(await call('GetProfileList')));
  } else if (command === 'output-config') {
    console.log(JSON.stringify({ profile: await call('GetProfileList'), outputs: await call('GetOutputList'), directory: await call('GetRecordDirectory'),
      encoder: await call('GetProfileParameter', { parameterCategory: 'SimpleOutput', parameterName: 'RecEncoder' }),
      mode: await call('GetProfileParameter', { parameterCategory: 'Output', parameterName: 'Mode' }) }));
  } else if (command === 'snapshot' || command === 'source-snapshot') {
    const result = await call('GetSourceScreenshot', { sourceName: command === 'source-snapshot' ? measuredSource : 'RaidRift Native QA', imageFormat: 'png', imageWidth: 1280, imageHeight: 720 });
    const path = process.argv[3] ?? 'artifacts/obs-native-relay.png';
    if (!path.startsWith('artifacts/') || !path.endsWith('.png')) throw Error('QA screenshot must stay in artifacts/');
    await mkdir('artifacts', { recursive: true });
    await writeFile(path, Buffer.from(result.imageData.split(',')[1], 'base64'));
    console.log(JSON.stringify({ screenshot: path }));
  } else if (command === 'record') {
    await call('StartRecord');
    await new Promise(resolve => setTimeout(resolve, 1500));
    const state = await call('GetRecordStatus');
    if (!state.outputActive) throw Error('OBS accepted the request but did not start recording');
    console.log(JSON.stringify(state));
  }
  else if (command === 'stop-record') console.log(JSON.stringify(await call('StopRecord')));
  else if (command === 'media-status') console.log(JSON.stringify(await call('GetMediaInputStatus', { inputName: 'Native AR Relay' })));
  else throw Error('Unknown QA operation');
} finally { clearTimeout(timer); ws.close(); }
