"""Inspect packaged native ELF alignment without extracting binaries or requiring an NDK."""
import json
import struct
import sys
import zipfile
from pathlib import Path

apk = Path(sys.argv[1] if len(sys.argv) > 1 else "artifacts/raidrift-capture-debug.apk")
reports = []
with zipfile.ZipFile(apk) as archive:
    for name in archive.namelist():
        if not name.startswith("lib/") or not name.endswith(".so"):
            continue
        data = archive.read(name)
        if data[:4] != b"\x7fELF" or data[4:6] != b"\x02\x01":
            raise ValueError("Expected little-endian ELF64: " + name)
        offset = struct.unpack_from("<Q", data, 32)[0]
        size, count = struct.unpack_from("<HH", data, 54)
        loads, relro = [], []
        for index in range(count):
            kind, flags, file_offset, virtual, _, file_size, memory_size, alignment = struct.unpack_from("<IIQQQQQQ", data, offset + index * size)
            segment = {"flags": flags, "virtualAddress": virtual, "memorySize": memory_size, "alignment": alignment}
            if kind == 1:
                loads.append(segment)
            elif kind == 0x6474E552:
                relro.append(segment)
        relro_checks = []
        for region in relro:
            end = region["virtualAddress"] + region["memorySize"]
            protected_end = ((end + 16383) // 16384) * 16384
            writable_tail = any(load["flags"] & 2 and load["virtualAddress"] < protected_end and load["virtualAddress"] + load["memorySize"] > end for load in loads)
            relro_checks.append({"endAligned16KiB": end % 16384 == 0, "writableTailInRoundedPage": writable_tail})
        reports.append({"path": name, "loadSegmentAlignments": [load["alignment"] for load in loads],
                        "supports16KiBLoadAlignment": bool(loads) and all(load["alignment"] >= 16384 for load in loads),
                        "relro": relro_checks})

result = {"scope": "ELF PT_LOAD and RELRO structural checks; separate official zipalign check; no 16 KiB runtime pass", "libraries": reports}
Path("artifacts/android-native-alignment.json").write_text(json.dumps(result, indent=2))
failed = [record["path"] for record in reports if not record["supports16KiBLoadAlignment"] or any(item["writableTailInRoundedPage"] for item in record["relro"])]
print(json.dumps({"libraries": len(reports), "alignmentFailures": failed}))
sys.exit(1 if failed else 0)
