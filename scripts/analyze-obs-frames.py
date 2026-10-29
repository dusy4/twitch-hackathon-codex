"""Analyze actual OBS screenshot samples. Requires Pillow and NumPy; no images synthesized."""
import argparse
import json
from pathlib import Path
import numpy as np
from PIL import Image

p = argparse.ArgumentParser()
p.add_argument('mode', choices=['action', 'stop'])
p.add_argument('manifest', type=Path)
p.add_argument('output', type=Path)
args = p.parse_args()
m = json.loads(args.manifest.read_text())
frames = m['frames']
roi = [500, 220, 900, 500]
x0, y0, x1, y1 = roi
def pixels(frame):
    return np.asarray(Image.open(frame['path']).convert('RGB'), dtype=np.int16)[y0:y1, x0:x1]
reference = pixels(frames[0])
for frame in frames:
    a = pixels(frame)
    frame['coloredPixels'] = int((a.max(axis=2) > 60).sum())
    frame['changedPixels'] = int((np.abs(a - reference).mean(axis=2) > 25).sum())
baseline = frames[:8]
valid = min(f['coloredPixels'] for f in baseline) > 400
first = None
threshold = max(300, max(f['changedPixels'] for f in baseline) * 4)
if valid:
    if args.mode == 'action':
        first = next((f for f in frames[8:] if f['changedPixels'] > threshold), None)
    else:
        # Require two consecutive clear frames, avoiding a one-frame decoder flash.
        first = next((a for a, b in zip(frames[8:], frames[9:]) if a['coloredPixels'] < 50 and b['coloredPixels'] < 50), None)
result = dict(scope=m['scope'], receiver=m.get('receiver'), mode=args.mode,
    eventRequested=m['eventRequested'], event=m['gesture'], roi=roi,
    baselineContainsRenderedContent=valid, baselineMinimumColoredPixels=min(f['coloredPixels'] for f in baseline),
    actionChangeThreshold=threshold if args.mode == 'action' else None,
    firstObserved=first, requestToObservedFrameUpperBoundMs=None if first is None else first['received'] - m['eventRequested'],
    passed=valid and first is not None, samples=[{k: v for k, v in f.items() if k != 'path'} for f in frames])
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(result, indent=2))
Image.open(frames[0]['path']).save(args.output.with_suffix('.before.png'))
Image.open((first or frames[-1])['path']).save(args.output.with_suffix('.after.png'))
print(json.dumps({k: v for k, v in result.items() if k != 'samples'}))
raise SystemExit(0 if result['passed'] else 1)
