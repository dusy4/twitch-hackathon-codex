# Asset provenance and redistribution gates

All website geometry, voxel characters, portal shader, particles, animations and Web Audio cues in `apps/web` are original code-generated assets. No Minecraft textures, audio, character skins or branded logo art were copied. Fonts are system UI/Georgia/monospace; there are no remote font requests. No OpenAI-generated raster images were needed.

`npm run licenses` writes `artifacts/dependency-licenses.json`. The current inventory contains MIT, Apache-2.0, BSD-3-Clause, ISC and BlueOak-1.0.0 dependencies, with no unknown package license fields. This metadata inventory is not a substitute for preserving notices in distributed binaries. npm audit reports no known advisories at the recorded validation point.

## Vision runtime and model

`@mediapipe/tasks-vision` 1.1.1 declares Apache-2.0. The EfficientDet-Lite0 int8 model was downloaded from the official [MediaPipe model distribution](https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite), SHA-256 `0720bf247bd76e6594ea28fa9c6f7c5242be774818997dbbeffc4da460c723bb`. Source URL/hash are recorded by `setup:vision`. [Official object detector documentation](https://developers.google.com/edge/mediapipe/solutions/vision/object_detector) describes the model, but does not establish all model-weight redistribution terms. Do not infer weight licensing from the runtime’s license. Production Docker context excludes local model/WASM assets until distribution review is complete. Local evaluation copies are present on this workstation and ignored by Git.

## Licensed QA videos

`tests/fixtures/ATTRIBUTION.json` contains source pages, authors, licenses and original-file hashes. Video bytes are unchanged and used only in local QA, separate from product assets:

| Fixture | Author / source | License |
| --- | --- | --- |
| dog-tail.webm | Liannadavis, [Dog wagging tail](https://commons.wikimedia.org/wiki/File:Dog_wagging_tail.webm) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| dog-rain.webm | PetrohsW, [Perro callejero jugando](https://commons.wikimedia.org/wiki/File:PerroCallejeroJugandoLLuvia20240828_ohs01.webm) | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| moving-chairs.webm | Erik Pålsson / Sounds of Changes, [Moving chairs in the museum cellar](https://commons.wikimedia.org/wiki/File:Moving_chairs_in_the_museum_cellar.webm) | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) on file license; source also states CC BY 4.0 |

Screenshots containing these videos are annotated derivatives for QA. If shared, preserve the attribution and applicable share-alike license for those image/video artifacts. These media licenses do not apply to independent application source code. They are not live Twitch or native AR proof recordings. No streamer-owned private video was captured.

`artifacts/dog-composite-qa.webm` and `artifacts/chromium-clip-frame.png` are app-generated annotated/composited derivatives of **Dog wagging tail**, Liannadavis, [source](https://commons.wikimedia.org/wiki/File:Dog_wagging_tail.webm), licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Changes: original procedural RaidRift avatar graphics, simulator/test watermark, resizing/encoding and playback UI in the screenshot. These derivative media artifacts are provided under CC BY-SA 4.0. They contain simulator identities, no captured private streamer footage, and no source audio. Application source code remains separate.

The optional active silhouette worker uses the original MagicTouch float32 checkpoint (6,227,884 bytes), SHA-256 `e24338a717c1b7ad8d159666677ef400babb7f33b8ad60c4d96db4ecf694cd25`. Its [Google model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MagicTouch.pdf) explicitly states Apache-2.0 and documents limitations. It is used only for animals/furniture here. The newer v2 checkpoint was locally evaluated but is not active; its exact redistribution terms remain unreviewed. See ADR-002.
