# Consented local composite clips

The creator's desktop capture companion offers **Record local clip**, **Finish clip** and **Discard local clip**. The permission checkbox is required for every recording session. Recording begins only after the creator selects an active source, enables camera processing and resumes the world. There is no rolling buffer. No clip bytes are uploaded, published or stored in the backend.

Source controls remain disabled while the local capture module initializes. A delayed-module browser regression test checks this gate before choosing a file; early input cannot disappear before handlers attach. Navigation during initialization closes the old preview socket/renderer instead of attaching controls to a different route.

The recorder composites the selected source and original virtual graphics into a separate canvas, using the same crop, mirror, rotation and viewport transform as authoritative target anchors. It requests 30 fps at up to 1280 × 720, approximately 2 Mbps. Actual browser encoding/frame rate may vary. Recording stops after 20 seconds or roughly 12 MiB, whichever occurs first. WebM VP9/VP8 is preferred when supported; other supported browser video formats may be selected. Unsupported encoders produce an explanation.

Exports are **video only**. Microphone, source audio and synthesized SFX are not included. DOM player-name labels and detector diagnostics are omitted; existing content within the source is preserved. Simulator/test-video exports are watermarked. Review source/participant permissions and attribution before sharing a downloaded file. There is no automatic social upload.

Permission withdrawal, source shutdown, loss of source frames, hidden browser tab, navigation, creator pause or camera-processing revocation cancels an unfinished recording. Brief decoder gaps hold the last frame for at most 750 ms; they do not fabricate new observations or extend target tracking. Discard/replacement/navigation revokes the in-memory preview URL. Files already downloaded remain under the user's control.

## Actual validation

`tests/e2e/clips.spec.ts` runs in Chromium against the isolated QA server: licensed dog file → actual capture companion → authoritative avatar wave → explicit clip consent → two-second recording → playable downloaded WebM → decoded frame screenshot → discard and permission-withdrawal cancellation. `artifacts/clip-export.json` records dimensions/hash/provenance; `artifacts/chromium-clip-frame.png` and `artifacts/dog-composite-qa.webm` are derivatives of Liannadavis's CC BY-SA 4.0 dog video. See `ASSETS.md`. This is not live Twitch, native phone or OBS recording evidence.

`tests/clips.test.ts` compares canvas image transforms with authoritative anchor mapping across crop, all four rotations, both mirror states and a partial output viewport. Broader real-camera alignment and other browser encoders remain unvalidated. The moving-dog target-following test remains separate; a transient detector/tracker loss was observed during development and safely stopped the avatar. The fixture seeks to a reproducible start before its bounded choreography check.

Official interfaces consulted: [W3C MediaStream Recording](https://www.w3.org/TR/mediastream-recording/) and [W3C capture from DOM elements](https://www.w3.org/TR/mediacapture-fromelement/). These are evolving specifications; runtime capability checks and actual browser playback remain necessary.

Composite dimensions follow the configured OBS canvas aspect ratio, bounded to 1280×720 with even encoder dimensions. The companion preview and clip exporter share the source drawing implementation in `apps/web/composite.ts`; the preview also transforms diagnostic outlines. Synthetic actual-video pixel checks cover a cropped, mirrored, rotated source inside an offset viewport. Raw camera/file pixels remain local.
