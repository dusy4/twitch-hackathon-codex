"""Download (non-elevated) or extract (elevated) the Unity 6000.3.27f1 Android modules,
mirroring Unity Hub's module definitions (services.api.unity.com releases API)."""
import os, shutil, subprocess, sys, zipfile

UNITY = r"E:\Unity\Editors\6000.3.27f1"
AP = UNITY + r"\Editor\Data\PlaybackEngines\AndroidPlayer"
DL = r"E:\Unity\downloads\android"
MODULES = [
    # (name, url, destination, rename_from (relative to destination) -> rename_to)
    ("jdk", "https://download.unity3d.com/download_unity/open-jdk/open-jdk-win-x64/jdk17.0.18-8_15e8817d1f5db6db3571ebe7430ef37f7fa8e60e8ff6f3e18ca1cb4c29f78774.zip", AP + r"\OpenJDK", None),
    ("sdk-base", "https://download.unity3d.com/download_unity/android-sdk-tools/1_5312bb398affd0d94b90d3780976e1a162aa91944ef6bb40c8feb10ad6cc360d.zip", AP + r"\SDK", None),
    ("ndk", "https://dl.google.com/android/repository/android-ndk-r27c-windows.zip", AP + r"\NDK", ("android-ndk-r27c", ".")),
    ("build-tools", "https://dl.google.com/android/repository/build-tools_r36_windows.zip", AP + r"\SDK\build-tools", ("android-16", "36.0.0")),
    ("platform-tools", "https://dl.google.com/android/repository/platform-tools_r37.0.1-win.zip", AP + r"\SDK", None),
    ("platform-36", "https://dl.google.com/android/repository/platform-36_r02.zip", AP + r"\SDK\platforms", None),
    ("platform-37", "https://dl.google.com/android/repository/platform-37.0_r02.zip", AP + r"\SDK\platforms", None),
    ("cmdline-tools", "https://dl.google.com/android/repository/commandlinetools-win-12266719_latest.zip", AP + r"\SDK\cmdline-tools", ("cmdline-tools", "16.0")),
]


def download():
    os.makedirs(DL, exist_ok=True)
    for name, url, _, _ in MODULES:
        out = os.path.join(DL, name + ".zip")
        if os.path.exists(out + ".ok"):
            continue
        r = subprocess.run([sys.executable, os.path.join(os.environ["TEMP"], "chunkdl.py"), url, out])
        if r.returncode != 0:
            sys.exit(f"download failed: {name}")
        zipfile.ZipFile(out).testzip()
        open(out + ".ok", "w").close()
        print("downloaded", name, os.path.getsize(out))


def extract():
    log = open(r"E:\Unity\android-modules.log", "a")
    for name, _, dest, rename in MODULES:
        src = os.path.join(DL, name + ".zip")
        os.makedirs(dest, exist_ok=True)
        zipfile.ZipFile(src).extractall(dest)
        if rename:
            a, b = rename
            frm = os.path.join(dest, a)
            if b == ".":
                for item in os.listdir(frm):
                    shutil.move(os.path.join(frm, item), os.path.join(dest, item))
                os.rmdir(frm)
            else:
                to = os.path.join(dest, b)
                if os.path.exists(to):
                    shutil.rmtree(to)
                os.rename(frm, to)
        print("extracted", name, "->", dest, file=log, flush=True)
    print("done", file=log, flush=True)


if __name__ == "__main__":
    {"download": download, "extract": extract}[sys.argv[1]]()
