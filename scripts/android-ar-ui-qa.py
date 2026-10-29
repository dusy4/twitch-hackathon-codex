"""Observe debug ARCore diagnostics and exercise real viewport taps through ADB.

Run on a Linux ADB host against an owned QA device with room AR already open.
No trackables, anchors, poses or camera images are injected by this tool.
Reported native state and saved screenshots require separate visual assessment.
"""
import argparse
import json
import os
from pathlib import Path
import re
import select
import subprocess
import time

PACKAGE = "world.raidrift.capture.android"
FRAME = re.compile(r"frame state=(\w+) floors=(\d+) points=(\d+) imageFps=(\d+) anchor=(\w+) previousFeet=(\d+)")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--duration", type=int, default=75, choices=range(10, 181), metavar="10..180")
    parser.add_argument("--capture-dir", type=Path, required=True)
    args = parser.parse_args()
    args.capture_dir.mkdir(parents=True, exist_ok=True)
    active = subprocess.run(["adb", "shell", "dumpsys", "activity", "activities"], check=True, capture_output=True, text=True, timeout=15).stdout
    if not any(PACKAGE in line for line in active.splitlines() if "mResumedActivity" in line):
        raise SystemExit("RaidRift must be the foreground activity on the owned QA device")
    size = subprocess.run(["adb", "shell", "wm", "size"], check=True, capture_output=True, text=True, timeout=10).stdout
    matches = re.findall(r"(?:Override|Physical) size:\s*(\d+)x(\d+)", size)
    if not matches:
        raise SystemExit("Cannot determine the viewport dimensions")
    width, height = map(int, matches[-1])
    if width >= height:
        raise SystemExit("This QA tap target requires the portrait room AR layout")
    report = {"scope": "Real UI plane-hit/anchor/feet diagnostics; screenshot pixels require visual assessment; not a physical-phone or AR frame-rate pass", "viewport": [width, height], "actualPlaneHitReported": False, "anchoredFeetReported": False, "tapAttempts": [], "samples": [], "captures": []}
    started = time.monotonic()
    deadline = started + args.duration
    last_tap = last_capture = 0.0
    reader = subprocess.Popen(["adb", "logcat", "-T", "1", "-s", "RaidRiftAR", "-v", "raw"], stdout=subprocess.PIPE, bufsize=0)
    pending = b""
    try:
        while time.monotonic() < deadline:
            if not select.select([reader.stdout], [], [], .5)[0]:
                continue
            data = os.read(reader.stdout.fileno(), 16384)
            if not data:
                break
            pending += data
            lines = pending.split(b"\n")
            pending = lines.pop()
            # Read raw chunks rather than mixing select() with buffered readline():
            # prefetched lines otherwise wait in a Python buffer and appear stale.
            for raw in lines:
                line = raw.decode("utf-8", "replace")
                now = time.monotonic()
                elapsed = round((now - started) * 1000)
                if "surfaceTap" in line and "hit=true" in line:
                    report["actualPlaneHitReported"] = True
                    report.setdefault("firstPlaneHitMs", elapsed)
                match = FRAME.search(line)
                if not match:
                    continue
                camera, floors, points, fps, anchor, feet = match.groups()
                sample = dict(elapsedMs=elapsed, camera=camera, floors=int(floors), points=int(points), uniqueImageFps=int(fps), anchor=anchor, previousFeet=int(feet))
                report["samples"].append(sample)
                if camera == "TRACKING" and anchor == "TRACKING" and int(feet) > 0:
                    report["anchoredFeetReported"] = True
                    if len(report["captures"]) < 3 and now - last_capture > 5:
                        last_capture = now
                        try:
                            result = subprocess.run(["adb", "exec-out", "screencap", "-p"], check=True, capture_output=True, timeout=15)
                            if not result.stdout.startswith(b"\x89PNG\r\n\x1a\n"):
                                raise ValueError("ADB did not produce a PNG")
                            target = args.capture_dir / ("anchored-%02d.png" % len(report["captures"]))
                            target.write_bytes(result.stdout)
                            report["captures"].append(dict(path=target.name, requestedMs=elapsed, completedMs=round((time.monotonic() - started) * 1000)))
                        except (subprocess.SubprocessError, ValueError) as error:
                            report.setdefault("captureErrors", []).append(type(error).__name__)
                if camera == "TRACKING" and int(floors) > 0 and anchor == "null" and not report["actualPlaneHitReported"] and now - last_tap > 3 and len(report["tapAttempts"]) < 12:
                    last_tap = now
                    report["tapAttempts"].append(elapsed)
                    try:
                        subprocess.run(["adb", "shell", "input", "tap", str(width // 2), str(round(height * .52))], check=True, capture_output=True, timeout=10)
                    except subprocess.SubprocessError as error:
                        report.setdefault("inputErrors", []).append(type(error).__name__)
    finally:
        reader.terminate()
        reader.wait(timeout=5)
        report["observedMs"] = round((time.monotonic() - started) * 1000)
        report["diagnosticReports"] = len(report["samples"])
        (args.capture_dir / "state.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({key: report[key] for key in ("actualPlaneHitReported", "anchoredFeetReported", "diagnosticReports", "observedMs")} | {"captures": len(report["captures"]), "tapAttempts": len(report["tapAttempts"])}))


if __name__ == "__main__":
    main()
