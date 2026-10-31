import os, sys, time, urllib.request
url, out = sys.argv[1], sys.argv[2]
chunk = 4 << 20
req = urllib.request.Request(url, method="HEAD")
total = int(urllib.request.urlopen(req, timeout=30).headers["Content-Length"])
pos = os.path.getsize(out) if os.path.exists(out) else 0
fails = 0
with open(out, "ab") as f:
    while pos < total:
        end = min(pos + chunk, total) - 1
        try:
            r = urllib.request.urlopen(urllib.request.Request(url, headers={"Range": f"bytes={pos}-{end}"}), timeout=60)
            data = r.read()
            if len(data) != end - pos + 1:
                raise IOError(f"short read {len(data)}")
            f.write(data); f.flush()
            pos += len(data)
            fails = 0
        except Exception as e:
            fails += 1
            if fails > 40:
                print("giving up at", pos, e); sys.exit(1)
            time.sleep(min(10, fails))
print("done", pos, total)
