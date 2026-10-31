"""Generate RaidRift's sound effects with ElevenLabs Sound Effects (owner-authorized, 2026-10-31) and master them.

Production approach (sources in docs): single-purpose layers (sub / body / detail / tail) generated separately and
mixed with aligned transients for hero moments; variation sets for repeated sounds; fast attacks and short tails for
gameplay; normalised to about -16 dBFS RMS with a -1.5 dBFS peak ceiling; 4 ms fades. Writes 48 kHz mono WAVs to
Assets/RaidRift/Resources/Audio plus SFX-ELEVENLABS.json with prompts, costs and hashes. Never prints the key.
Usage: python elevenlabs_sfx.py [--only name,name] [--budget 1500]
"""
import argparse, array, hashlib, json, math, os, struct, sys, time, urllib.request, wave

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "Assets", "RaidRift", "Resources", "Audio")
RAW = os.path.join(ROOT, "Tools", "sfx_raw")
RATE = 48000
MODEL = "eleven_text_to_sound_v2"

STYLE = "Original high-end cinematic game sound effect, clean isolated recording, no music, no speech, no words."

# name -> list of layers: (prompt, seconds, offset_seconds, gain, prompt_influence, loop)
SOUNDS = {
    "rift_open": [
        ("Rising magical energy riser building tension, shimmering violet crystal tones swelling upward", 2.2, 0.0, 0.8, 0.5, False),
        ("Massive cinematic impact: deep sub-bass boom, stone cracking open, punchy transient, big trailer hit", 1.8, 2.0, 1.0, 0.55, False),
        ("Sparkling crystalline magic debris settling after a portal opens, airy shimmering tail with wide reverb", 2.6, 2.1, 0.55, 0.45, False),
    ],
    "rift_close": [
        ("Magical portal collapsing: reverse suction whoosh imploding into a soft deep thud, crystal shimmer fading", 1.6, 0.0, 1.0, 0.5, False),
    ],
    "rift_ambience": [
        ("Seamless magical dimension ambience: soft wind, distant crystal chimes, low warm drone, gentle sparkles", 6.0, 0.0, 1.0, 0.4, True),
    ],
    "moth_flutter": [
        ("Seamless soft fluttering of small glowing magical moth wings with faint sparkle shimmer", 3.0, 0.0, 1.0, 0.45, True),
    ],
    "raid_stinger": [
        ("Epic cinematic braam hit with whoosh lead-in and sub drop, short heroic trailer stinger, no melody", 2.4, 0.0, 1.0, 0.5, False),
    ],
    "teleport_out": [("Magic vanish: quick reverse whoosh into a soft poof with sparkles", 0.8, 0.0, 1.0, 0.5, False)],
    "teleport_in": [("Magic appear: bright pop with a sparkle burst and tiny chime", 0.8, 0.0, 1.0, 0.5, False)],
    "spell": [("Small fantasy spell cast: sparkly zap with a rising chime and soft whoosh", 1.0, 0.0, 1.0, 0.5, False)],
    "landing_lock": [("Satisfying holographic lock-on confirmation: soft magical chime with gentle whoosh, premium UI", 0.9, 0.0, 1.0, 0.5, False)],
    "ui_tap": [("Very subtle soft premium UI tap, tiny glassy click", 0.5, 0.0, 1.0, 0.5, False)],
}
VARIANTS = {
    "step": ("Single tiny footstep of a small cartoon character in soft boots on carpet, short and soft", 0.5, 4),
    "jump": ("Small cartoon character jump: quick springy take-off with a short cloth whoosh", 0.6, 3),
    "land": ("Small cartoon character landing on carpet: soft punchy thud with a tiny cloth rustle", 0.5, 3),
    "cheer": ("Tiny cute fantasy creature cheering happily, high-pitched joyful gibberish yay, non-verbal", 1.2, 2),
    "greet": ("Tiny cute fantasy creature friendly greeting chirp, high-pitched, non-verbal hello", 0.8, 2),
}


def key():
    k = os.environ.get("ELEVENLABS_API_KEY_3", "")
    if not k and os.path.exists(r"E:\Hermes\.env"):
        for line in open(r"E:\Hermes\.env", encoding="utf-8"):
            if line.startswith("ELEVENLABS_API_KEY_3="):
                k = line.split("=", 1)[1].strip().strip('"')
    if not k:
        sys.exit("ELEVENLABS_API_KEY_3 not set")
    return k


def remaining(k):
    req = urllib.request.Request("https://api.elevenlabs.io/v1/user/subscription", headers={"xi-api-key": k})
    s = json.load(urllib.request.urlopen(req, timeout=30))
    return s["character_limit"] - s["character_count"]


def generate(k, prompt, seconds, influence, loop):
    body = json.dumps({"text": f"{prompt}. {STYLE}", "duration_seconds": seconds, "prompt_influence": influence,
                       "model_id": MODEL, "loop": loop}).encode()
    url = "https://api.elevenlabs.io/v1/sound-generation?output_format=pcm_48000"
    for attempt in range(5):
        try:
            req = urllib.request.Request(url, data=body, headers={"xi-api-key": k, "Content-Type": "application/json"})
            r = urllib.request.urlopen(req, timeout=120)
            data = r.read()
            cost = r.headers.get("character-cost") or r.headers.get("x-character-count") or ""
            if len(data) < 2000:
                raise IOError("short audio")
            return data, cost
        except urllib.error.HTTPError as e:
            if e.code in (400, 401, 402, 403, 422):
                sys.exit(f"ElevenLabs refused ({e.code}): {e.read()[:300]!r}")
            time.sleep(2 * (attempt + 1))
        except Exception:
            time.sleep(2 * (attempt + 1))
    sys.exit("ElevenLabs request failed 5 times")


def to_floats(pcm):
    # ElevenLabs pcm_48000 sound effects arrive as interleaved STEREO s16le (verified: L/R correlation > 0.99,
    # byte count = 2 ch x 48 kHz x duration). Fold to mono for 3D sources.
    a = array.array("h")
    a.frombytes(pcm[: len(pcm) // 4 * 4])
    return [(a[i] + a[i + 1]) / 65536.0 for i in range(0, len(a) - 1, 2)]


def master(samples, loop=False):
    # Trim leading/trailing near-silence (keep 10 ms pre-roll), normalise, fade.
    if not loop:
        thr = 0.003
        start = next((i for i, x in enumerate(samples) if abs(x) > thr), 0)
        end = len(samples) - next((i for i, x in enumerate(reversed(samples)) if abs(x) > thr), 0)
        samples = samples[max(0, start - 480): min(len(samples), end + 2400)]
    rms = math.sqrt(sum(x * x for x in samples) / max(1, len(samples))) or 1e-6
    peak = max(abs(x) for x in samples) or 1e-6
    gain = min(10 ** (-16 / 20) / rms, 10 ** (-1.5 / 20) / peak)
    samples = [x * gain for x in samples]
    fade = min(len(samples) // 2, 192 if not loop else 0)
    for i in range(fade):
        g = i / fade
        samples[i] *= g
        samples[-1 - i] *= g
    return samples


def write_wav(path, samples):
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
        w.writeframes(b"".join(struct.pack("<h", max(-32767, min(32767, int(x * 32767)))) for x in samples))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--budget", type=int, default=1500, help="stop when fewer credits than this remain")
    ap.add_argument("--remaster", action="store_true", help="re-master from cached raw layers (no API calls for cached ones)")
    args = ap.parse_args()
    only = set(filter(None, args.only.split(",")))
    k = key()
    os.makedirs(OUT, exist_ok=True); os.makedirs(RAW, exist_ok=True)
    manifest_path = os.path.join(OUT, "SFX-ELEVENLABS.json")
    manifest = json.load(open(manifest_path, encoding="utf-8")) if os.path.exists(manifest_path) else {
        "provider": "ElevenLabs Sound Effects", "model": MODEL, "authorized": "Owner request 2026-10-31 (starter plan credits)",
        "terms": "https://elevenlabs.io/terms-of-use", "mastering": "layered, trimmed, ~-16 dBFS RMS, -1.5 dBFS peak, 4 ms fades",
        "assets": {}}
    jobs = [(n, layers) for n, layers in SOUNDS.items()]
    for n, (prompt, sec, count) in VARIANTS.items():
        for i in range(count):
            jobs.append((f"{n}_{i + 1}", [(prompt + f", take {i + 1}", sec, 0.0, 1.0, 0.4, False)]))
    left = remaining(k)
    print("credits remaining", left)
    for name, layers in jobs:
        if only and name not in only and name.split("_")[0] not in only:
            continue
        if name in manifest["assets"] and os.path.exists(os.path.join(OUT, name + ".wav")) and not args.remaster:
            continue
        if left < args.budget:
            print("budget floor reached; stopping before", name); break
        mix, loop, records = [], any(l[5] for l in layers), []
        for prompt, sec, offset, gain, influence, lp in layers:
            raw_path = os.path.join(RAW, f"{name}_{len(records)}.pcm")
            if os.path.exists(raw_path):
                pcm, cost = open(raw_path, "rb").read(), "cached"
            else:
                pcm, cost = generate(k, prompt, sec, influence, lp)
                open(raw_path, "wb").write(pcm)
            layer = to_floats(pcm)
            start = int(offset * RATE)
            if len(mix) < start + len(layer):
                mix.extend([0.0] * (start + len(layer) - len(mix)))
            for i, x in enumerate(layer):
                mix[start + i] += x * gain
            records.append({"prompt": prompt, "seconds": sec, "offset": offset, "gain": gain, "prompt_influence": influence,
                            "loop": lp, "cost": cost, "sha256": hashlib.sha256(pcm).hexdigest()})
        out = master(mix, loop)
        path = os.path.join(OUT, name + ".wav")
        write_wav(path, out)
        manifest["assets"][name] = {"file": name + ".wav", "seconds": round(len(out) / RATE, 3), "layers": records,
                                    "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        json.dump(manifest, open(manifest_path, "w", encoding="utf-8"), indent=2)
        left = remaining(k) if records and records[-1]["cost"] != "cached" else left
        print(f"{name}: {len(out) / RATE:.2f}s, credits left {left}")
    print("done; credits remaining", left)


if __name__ == "__main__":
    main()
