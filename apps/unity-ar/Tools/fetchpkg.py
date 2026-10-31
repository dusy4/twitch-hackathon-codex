import hashlib, json, os, subprocess, sys, urllib.request
out_dir = sys.argv[1]
os.makedirs(out_dir, exist_ok=True)
for spec in sys.argv[2:]:
    name, ver = spec.split("@")
    meta = json.load(urllib.request.urlopen(f"https://packages.unity.com/{name}", timeout=30))["versions"][ver]["dist"]
    out = os.path.join(out_dir, f"{name}-{ver}.tgz")
    if not os.path.exists(out):
        subprocess.run([sys.executable, os.path.join(os.environ["TEMP"], "chunkdl.py"), meta["tarball"], out], check=True)
    sha1 = hashlib.sha1(open(out, "rb").read()).hexdigest()
    print(name, ver, "sha1 ok" if sha1 == meta["shasum"] else f"SHA1 MISMATCH {sha1} != {meta['shasum']}")
