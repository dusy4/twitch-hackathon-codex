"""RaidRift open-vocabulary detector sidecar (OmDet-Turbo, Apache-2.0).

Local only: binds 127.0.0.1. One model on the GPU, inference serialized by a lock.

  GET  /health  -> {ok, device, dtype, model}
  POST /detect  {image: base64 jpeg, classes: [str <= 20], threshold?: 0.3}
                -> {ms, detections: [{label, score, box: [x, y, w, h]}]}
                   box normalized 0..1, top-left origin, in the posted image's space
"""

from __future__ import annotations

import argparse
import base64
import binascii
import inspect
import io
import json
import logging
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import torch
from PIL import Image
from transformers import AutoProcessor, OmDetTurboForObjectDetection

MODEL_ID = "omlab/omdet-turbo-swin-tiny-hf"
MAX_BODY = 1_200_000
MAX_CLASSES = 20
NMS_THRESHOLD = 0.3
HERE = Path(__file__).resolve().parent

log = logging.getLogger("ov-detector")


class Detector:
    def __init__(self, device: str, dtype: str, warmup: Path | None):
        self.lock = threading.Lock()
        self.device = device
        self.processor = AutoProcessor.from_pretrained(MODEL_ID)
        self.model = self._load(torch.float32)
        self.dtype = torch.float32
        params = inspect.signature(
            self.processor.post_process_grounded_object_detection
        ).parameters
        self._labels_kw = "text_labels" if "text_labels" in params else "classes"
        self._thr_kw = "threshold" if "threshold" in params else "score_threshold"
        image = (
            Image.open(warmup).convert("RGB")
            if warmup and warmup.exists()
            else Image.new("RGB", (640, 360), (120, 110, 100))
        )
        probe = ["chair", "table", "box", "person", "dog"]
        if device == "cuda" and dtype in ("auto", "fp16"):
            # fp16 via autocast: model.half() fails because OmDet builds some
            # tensors in fp32 internally (Float vs Half matmul).
            ref = self._run(image, probe, 0.3)
            self.dtype = torch.float16
            try:
                half = self._run(image, probe, 0.3)
            except RuntimeError as e:
                log.warning("fp16 failed (%s); using fp32", e)
                half = None
            if half is None or (dtype == "auto" and not _similar(ref, half)):
                if half is not None:
                    log.warning("fp16 differs from fp32 (%s vs %s); using fp32", ref, half)
                self.dtype = torch.float32
            else:
                log.info("fp16 check ok: fp32 %s / fp16 %s", ref, half)
        for _ in range(2):  # warm-up (cudnn autotune, allocator)
            self._run(image, probe, 0.3)

    def _load(self, dtype):
        model = OmDetTurboForObjectDetection.from_pretrained(MODEL_ID, torch_dtype=dtype)
        return model.to(self.device).eval()

    @property
    def dtype_name(self) -> str:
        return "fp16" if self.dtype == torch.float16 else "fp32"

    def _run(self, image: Image.Image, classes: list[str], threshold: float):
        inputs = self.processor(images=image, text=classes, return_tensors="pt")
        inputs = {k: v.to(self.device) if hasattr(v, "to") else v for k, v in inputs.items()}
        half = self.dtype == torch.float16
        with torch.inference_mode(), torch.autocast("cuda", dtype=torch.float16, enabled=half):
            outputs = self.model(**inputs)
        result = self.processor.post_process_grounded_object_detection(
            outputs,
            **{self._labels_kw: [classes], self._thr_kw: threshold},
            target_sizes=[(image.height, image.width)],
            nms_threshold=NMS_THRESHOLD,
        )[0]
        labels = result.get("text_labels", result.get("classes"))
        if labels is None:
            labels = [classes[int(i)] for i in result["labels"]]
        out = []
        for box, score, label in zip(result["boxes"].tolist(), result["scores"].tolist(), labels):
            x0, y0, x1, y1 = box
            x0, y0 = max(0.0, x0), max(0.0, y0)
            x1, y1 = min(float(image.width), x1), min(float(image.height), y1)
            if x1 <= x0 or y1 <= y0:
                continue
            out.append(
                {
                    "label": str(label),
                    "score": round(float(score), 4),
                    "box": [
                        round(x0 / image.width, 4),
                        round(y0 / image.height, 4),
                        round((x1 - x0) / image.width, 4),
                        round((y1 - y0) / image.height, 4),
                    ],
                }
            )
        out.sort(key=lambda d: -d["score"])
        return out

    def detect(self, image: Image.Image, classes: list[str], threshold: float):
        with self.lock:
            started = time.perf_counter()
            detections = self._run(image, classes, threshold)
            if self.device == "cuda":
                torch.cuda.synchronize()
            return round((time.perf_counter() - started) * 1000, 1), detections


def _similar(a: list[dict], b: list[dict]) -> bool:
    """Same labels for the top detections, scores within 0.05, boxes within 0.02."""
    top_a = [d for d in a if d["score"] >= 0.35][:5]
    top_b = [d for d in b if d["score"] >= 0.35][:5]
    if len(top_a) != len(top_b):
        return False
    for x, y in zip(top_a, top_b):
        if x["label"] != y["label"] or abs(x["score"] - y["score"]) > 0.05:
            return False
        if max(abs(p - q) for p, q in zip(x["box"], y["box"])) > 0.02:
            return False
    return True


def make_handler(det: Detector):
    class Handler(BaseHTTPRequestHandler):
        server_version = "raidrift-ov/1"

        def log_message(self, fmt, *args):  # route to logging, no request bodies
            log.info("%s %s", self.address_string(), fmt % args)

        def _send(self, status: int, body: dict):
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path == "/health":
                return self._send(
                    200,
                    {"ok": True, "device": det.device, "dtype": det.dtype_name, "model": MODEL_ID},
                )
            self._send(404, {"error": "not found"})

        def do_POST(self):
            if self.path != "/detect":
                return self._send(404, {"error": "not found"})
            try:
                length = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                length = -1
            if length <= 0 or length > MAX_BODY:
                return self._send(413, {"error": "body must be 1..1200000 bytes"})
            try:
                req = json.loads(self.rfile.read(length))
                classes = req.get("classes")
                if (
                    not isinstance(classes, list)
                    or not 1 <= len(classes) <= MAX_CLASSES
                    or not all(isinstance(c, str) and 0 < len(c.strip()) <= 40 for c in classes)
                ):
                    raise ValueError("classes must be 1..20 strings of 1..40 chars")
                classes = list(dict.fromkeys(c.strip().lower() for c in classes))
                threshold = float(req.get("threshold", 0.3))
                threshold = min(0.95, max(0.05, threshold))
                raw = base64.b64decode(req.get("image") or "", validate=True)
                image = Image.open(io.BytesIO(raw))
                if image.width * image.height > 4096 * 4096:
                    raise ValueError("image too large")
                image = image.convert("RGB")
            except (ValueError, TypeError, binascii.Error, OSError, json.JSONDecodeError) as e:
                return self._send(400, {"error": str(e)[:200]})
            try:
                ms, detections = det.detect(image, classes, threshold)
            except Exception as e:  # keep serving
                log.exception("detect failed")
                return self._send(500, {"error": type(e).__name__})
            self._send(200, {"ms": ms, "detections": detections})

    return Handler


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=3420)
    ap.add_argument("--device", choices=["auto", "cuda", "cpu"], default="auto")
    ap.add_argument("--dtype", choices=["auto", "fp16", "fp32"], default="auto")
    ap.add_argument("--warmup", type=Path, default=HERE / "warmup.jpg")
    args = ap.parse_args()
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        stream=sys.stdout,
    )
    device = args.device
    if device == "auto":
        device = "cuda" if torch.cuda.is_available() else "cpu"
    started = time.time()
    det = Detector(device, args.dtype if device == "cuda" else "fp32", args.warmup)
    log.info(
        "model %s on %s %s ready in %.1fs (torch %s)",
        MODEL_ID,
        det.device,
        det.dtype_name,
        time.time() - started,
        torch.__version__,
    )
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(det))
    log.info("listening on http://127.0.0.1:%d", args.port)
    server.serve_forever()


if __name__ == "__main__":
    main()
