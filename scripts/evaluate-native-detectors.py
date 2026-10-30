"""Private, offline model comparison on a supplied recording's unobscured camera region.

Example: python -X utf8 scripts/evaluate-native-detectors.py --python-libs E:/tmp/raidrift-recovery-python --video <local.mp4>
No uploads. Timing is workstation CPU timing, never an Android performance claim.
"""
import argparse
import json
import sys
import subprocess
from pathlib import Path
from time import perf_counter

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--python-libs', required=True)
p.add_argument('--video', required=True)
p.add_argument('--ffmpeg', default='C:/ffmpeg/bin/ffmpeg.exe')
p.add_argument('--crop', default='0,700,1080,850')
args = p.parse_args()
sys.path.insert(0,args.python_libs)
import mediapipe as mp
from mediapipe.tasks.python import BaseOptions, vision
import numpy as np
from PIL import Image, ImageDraw, ImageOps

work = Path('.data/recovery-evaluation'); work.mkdir(parents=True,exist_ok=True)
out = Path('artifacts/recovery'); out.mkdir(parents=True,exist_ok=True)
x,y,w,h = map(int,args.crop.split(','))
frames=[]
for t in [2,6,18,22]:
    destination = work/f'room-{t}.png'
    subprocess.run([args.ffmpeg,'-hide_banner','-loglevel','error','-ss',str(t),'-i',args.video,'-vf',f'crop={w}:{h}:{x}:{y},scale=640:-1','-frames:v','1','-y',str(destination)],check=True)
    frames.append((t,Image.open(destination).convert('RGB')))
reports=[]
for name,threshold in [('efficientdet_lite0.tflite',.5),('efficientdet_lite2_int8.tflite',.32)]:
    options=vision.ObjectDetectorOptions(base_options=BaseOptions(model_asset_path=str(Path('apps/android/app/src/main/assets/models')/name)),score_threshold=threshold,max_results=15)
    with vision.ObjectDetector.create_from_options(options) as detector:
        for t,image in frames:
            # Match the Android pipeline. The old task received a non-square input and stretched it.
            if 'lite2' in name:
                image = ImageOps.pad(image,(448,448),method=Image.Resampling.BILINEAR,color=(128,128,128))
            started=perf_counter()
            result=detector.detect(mp.Image(image_format=mp.ImageFormat.SRGB,data=np.ascontiguousarray(image)))
            elapsed=(perf_counter()-started)*1000
            hits=[]; annotated=image.copy(); draw=ImageDraw.Draw(annotated)
            for d in result.detections:
                c=d.categories[0]; b=d.bounding_box
                hits.append({'class':c.category_name,'score':round(c.score,3),'box':[b.origin_x,b.origin_y,b.width,b.height]})
                draw.rectangle((b.origin_x,b.origin_y,b.origin_x+b.width,b.origin_y+b.height),outline='#aaffbb',width=3)
                draw.text((b.origin_x,max(0,b.origin_y-14)),f'{c.category_name} {c.score:.2f}',fill='#ffffff',stroke_width=1,stroke_fill='#000000')
            annotated.save(work/f'{name}-{t}.jpg')
            reports.append({'model':name,'threshold':threshold,'recordingSecond':t,'workstationCpuMs':round(elapsed,1),'detections':hits})
            print(json.dumps(reports[-1]))
report={'scope':'Offline workstation CPU, cropped visible camera area of owner recording; no AR pose/depth and no device FPS evidence. Private footage stays in .data. No ground-truth recall claim.','samples':reports}
(out/'detector-comparison.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
