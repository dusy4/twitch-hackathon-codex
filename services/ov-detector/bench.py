"""Benchmark a running sidecar: python bench.py <frames-dir> [--n 20] [--url http://127.0.0.1:3420].

Frames: 640 px wide JPEGs, e.g.
  ffmpeg -i tests/fixtures/moving-chairs.webm -vf "fps=2,scale=640:-2" -fps_mode vfr -q:v 4 frames/chairs-%03d.jpg
"""

import argparse
import base64
import json
import statistics
import time
import urllib.request
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument("frames", type=Path)
ap.add_argument("--n", type=int, default=20)
ap.add_argument("--url", default="http://127.0.0.1:3420")
ap.add_argument("--classes", default="chair,box,table,dog,book")
args = ap.parse_args()
classes = args.classes.split(",")
files = sorted(args.frames.glob("*.jpg"))
assert files, "no frames"
print(urllib.request.urlopen(f"{args.url}/health").read().decode())
server_ms, total_ms = [], []
for i in range(args.n):
    f = files[i % len(files)]
    body = json.dumps(
        {"image": base64.b64encode(f.read_bytes()).decode(), "classes": classes, "threshold": 0.3}
    ).encode()
    req = urllib.request.Request(
        f"{args.url}/detect", body, {"Content-Type": "application/json"}
    )
    t = time.perf_counter()
    res = json.loads(urllib.request.urlopen(req).read())
    total_ms.append((time.perf_counter() - t) * 1000)
    server_ms.append(res["ms"])
    top = ", ".join(f"{d['label']} {d['score']:.2f}" for d in res["detections"][:4])
    print(f"{f.name}: {res['ms']:.0f} ms server, {total_ms[-1]:.0f} ms http -> {top or '-'}")


def pct(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, round(p / 100 * (len(xs) - 1)))]


for name, xs in (("model", server_ms), ("http round trip", total_ms)):
    print(
        f"{name}: p50 {pct(xs, 50):.0f} ms, p95 {pct(xs, 95):.0f} ms, "
        f"mean {statistics.mean(xs):.0f} ms over {len(xs)}"
    )
