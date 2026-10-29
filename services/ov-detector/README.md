# ov-detector: open-vocabulary detection sidecar

Finds any named object ("pillow", "lamp", "bike rack") in the phone's latest camera
frame, so chat commands are not limited to the phone's 80 COCO classes. Pretrained,
no training: **OmDet-Turbo** (`omlab/omdet-turbo-swin-tiny-hf`, om-ai-lab, Apache-2.0).

Local only: binds `127.0.0.1:3420`. One model on the GPU; inference is serialized by a lock.
The API server (`apps/api/ov-detector.ts`) calls it; the phone never talks to it directly.

| Endpoint | Body | Response |
|---|---|---|
| `GET /health` | | `{ok, device, dtype, model}` |
| `POST /detect` | `{image: base64 jpeg, classes: [≤20 strings ≤40 chars], threshold?: 0.3}` | `{ms, detections: [{label, score, box:[x,y,w,h]}]}` |

`box` is normalized 0..1 with a top-left origin, in the posted image's space (the same
convention as `Track.box`).

## Install

Venv `E:\Hermes\venvs\raidrift-ov`, created with `C:\Python312\python.exe -m venv` (Python 3.12).

| Package | Version | Source | License |
|---|---|---|---|
| torch | 2.14.1+cu126 | download.pytorch.org/whl/cu126 (SHA-256 checked against pip's report) | BSD-3-Clause |
| torchvision | 0.29.1+cu126 | download.pytorch.org/whl/cu126 | BSD-3-Clause |
| transformers | 5.22.0 | PyPI | Apache-2.0 |
| timm | 1.0.30 | PyPI (needed for OmDet's Swin backbone) | Apache-2.0 |
| pillow | 13.0.0 | PyPI | MIT-CMU (HPND) |
| huggingface_hub, numpy | 2.4.0, 2.5.4 | PyPI (dependencies) | Apache-2.0, BSD-3-Clause |

Weights are downloaded once into `HF_HOME=E:/Hermes/cache/huggingface`.

## Run

`powershell -File services/ov-detector/start.ps1` launches it detached (hidden window),
logging to `E:\Hermes\tmp\rr\ov-detector.log`. Ready in about 6 s.

Notes:
- Don't set `HF_HUB_OFFLINE`: transformers 5.x looks up the backbone name on the Hub
  while building the config, even with the weights cached, and fails offline.
- `--dtype auto` (default) compares fp16 (CUDA autocast) against fp32 on the warm-up image
  and keeps fp16 only if they agree. On the GTX 1650 fp16 returns **no detections**
  (fp32 found 5), so it runs fp32. `model.half()` doesn't work at all (Float/Half matmul error).

## Benchmark (2026-10-29)

GTX 1650 4 GB, driver 560.94, fp32, 640 px wide JPEG frames from `tests/fixtures`
(`python bench.py <frames-dir>`, threshold 0.3):

| Frames | Classes | Model p50 / p95 | HTTP round trip p50 / p95 |
|---|---|---|---|
| 20 × moving-chairs | chair, box, table, dog, book | 144 / 145 ms | 146 / 148 ms |
| 47 × chairs + dog-tail | dog, pillow, couch, lamp, plant | 147 / 149 ms | 149 / 152 ms |

The first request after start takes about 500 ms (CUDA warm-up). Typical hits: chair 0.84–0.92,
dog 0.96–0.98.
