"""Drive the actual camera-off Android trail UI in an owner-authorized Boat VM.

Requires the APK to be installed and its Activity open. It does not provision VMs,
enable a microphone, start a broadcast, use provider keys or simulate AR tracking.
The labelled preview moves through the same native quest engine as physical AR.
"""
import argparse
import base64
import json
from pathlib import Path
import re
import subprocess
import time
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
ADB = '/home/user/raidrift-qa/android-sdk/platform-tools/adb'

def main():
    p = argparse.ArgumentParser()
    p.add_argument('vm')
    p.add_argument('--out', type=Path, default=ROOT / 'artifacts/immersion')
    p.add_argument('--boat', type=Path, default=ROOT / '.tools/boat/boat.exe')
    args = p.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    def run(command):
        r = subprocess.run([str(args.boat), '--no-update', '--json', 'exec', args.vm,
            '--timeout', '25', '--', 'bash', '-lc', command], capture_output=True,
            text=True, encoding='utf-8', timeout=35)
        if r.returncode:
            raise RuntimeError(r.stderr or r.stdout)
        d = json.loads(r.stdout)
        if d.get('exitCode', 0) != 0:
            raise RuntimeError(d.get('stderr', '') + d.get('stdout', ''))
        return d.get('stdout', '')

    def ui():
        raw = run(f'{ADB} shell uiautomator dump /sdcard/trail-qa.xml >/dev/null; {ADB} shell cat /sdcard/trail-qa.xml')
        root = ET.fromstring(raw[raw.index('<?xml'):])
        return [n for n in root.iter('node') if n.get('text')]

    def tap(label):
        node = next(n for n in ui() if n.get('text') == label)
        x, y, xx, yy = map(int, re.findall(r'\d+', node.get('bounds')))
        if xx <= x or yy <= y:
            raise RuntimeError('UI action is off screen: ' + label)
        run(f'{ADB} shell input tap {(x+xx)//2} {(y+yy)//2}')

    def screen(name):
        run(f'{ADB} exec-out screencap -p > /home/user/raidrift-qa/evidence/trail-current.png')
        image = base64.b64decode(run('base64 -w0 /home/user/raidrift-qa/evidence/trail-current.png'))
        (args.out / (name + '.png')).write_bytes(image)

    run(f'{ADB} logcat -c')
    tap('Preview test raid · 3 viewers')
    tap('Explore')
    screen('final-trail-sheet')
    tap('Try trail preview')
    visited = set()
    complete = False
    steps = 0
    seen = []
    for _ in range(58):
        nodes = ui()
        texts = [n.get('text') for n in nodes]
        progress = next((s for s in texts if re.match(r'^\d / 3 crystals', s)), '')
        phase = next((s for s in texts if s in ('Gather the lost fragments', 'Restore the rift shrine', 'A cheer from the party', 'Rift Trail complete')), '')
        seen.append({'phase': phase, 'progress': progress, 'steps': steps})
        print(json.dumps(seen[-1]), flush=True)
        key = phase + ':' + progress
        if key not in visited:
            visited.add(key)
            screen('final-trail-stage-' + str(len(visited)))
        if phase == 'Rift Trail complete':
            screen('final-trail-complete')
            complete = True
            break
        if phase == 'A cheer from the party':
            time.sleep(.5)
            continue
        if steps >= 38:
            raise RuntimeError('Trail did not reach its finale within the measured preview route')
        tap('Walk forward · preview only')
        steps += 1
        time.sleep(.5)
    log = run(f'{ADB} logcat -d -s RaidRiftTrail:D AndroidRuntime:E')
    (args.out / 'final-trail-runtime.log').write_text(log, encoding='utf-8')
    result = {'source': 'Actual native Android UI; explicitly simulated camera-off trail, not physical AR',
        'complete': complete, 'steps': steps, 'observations': seen,
        'discoveredEvents': log.count('D RaidRiftTrail: DISCOVERED:'),
        'collectedEvents': log.count('D RaidRiftTrail: COLLECTED:'),
        'restoredEvents': log.count('D RaidRiftTrail: RESTORED:'),
        'completedEvents': log.count('D RaidRiftTrail: COMPLETED:'),
        'runtimeCrash': 'FATAL EXCEPTION' in log}
    (args.out / 'native-trail-ui.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    if not complete or result['collectedEvents'] != 3 or result['restoredEvents'] != 1 or result['completedEvents'] != 1 or result['runtimeCrash']:
        raise RuntimeError('Native trail verification failed; inspect the saved observations and log')
    print('Actual native trail completed through UI and independent stub chat inputs.', flush=True)

if __name__ == '__main__':
    main()
