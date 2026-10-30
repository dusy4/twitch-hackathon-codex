"""Owner-authorized, bounded ElevenLabs SFX generation. Never stores the API key.

Uses the existing paid plan allowance; no automatic plan/credit upgrade. Existing
assets are retained so rerunning does not silently regenerate or spend credits.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'apps/android/app/src/main/assets/audio'
FFMPEG = Path('C:/ffmpeg/bin/ffmpeg.exe')
CUES = {
    'portal_open': (2.4, 'Original cozy fantasy game dimensional portal opening: a soft stone click, rising airy violet energy whoosh, warm deep magical resonance and a delicate shimmering finish. Single isolated sound effect, restrained, no music, no speech, no horror, no explosive bang.'),
    'discovery': (1.3, 'Original whimsical fantasy adventure game discovery sound: three delicate ascending glass bell notes over a soft airy sparkle. Warm inviting magical crystal discovered nearby. Isolated short sound effect, no speech, no background music, no harsh high frequencies.'),
    'pickup': (0.7, 'Original satisfying tiny magical crystal pickup for a cozy fantasy game. A soft glass plink rises into a bright rounded sparkle with a very short tail. One isolated clean sound, no speech, no music, no harsh treble.'),
    'quest_complete': (2.3, 'Original cozy fantasy adventure quest completion sound effect: warm ascending celesta arpeggio, gentle rounded chime chord and tiny sparkling tail. Satisfying and celebratory but restrained. No orchestra, no background music, no speech, no drums.'),
    'portal_close': (1.2, 'Original small magical portal closing sound for a cozy fantasy game: airy reverse shimmer contracts into a soft low rounded pop, with a brief warm crystalline tail. Isolated clean effect, no speech, no music, no scary sounds.'),
}

def request(path, body=None):
    key = os.environ.get('ELEVENLABS_API_KEY_3') or os.environ.get('ELEVENLABS_API_KEY')
    if not key:
        raise SystemExit('ElevenLabs key is not configured')
    req = urllib.request.Request('https://api.elevenlabs.io/v1/' + path,
        data=None if body is None else json.dumps(body).encode(),
        headers={'xi-api-key': key, 'Content-Type': 'application/json'})
    return urllib.request.urlopen(req, timeout=90)

def main():
    with request('user/subscription') as response:
        plan = json.load(response)
    if plan.get('tier') in (None, 'free') or plan.get('status') != 'active':
        raise SystemExit('Paid active plan required for commercial asset rights; no plan change attempted')
    if plan.get('character_limit', 0) - plan.get('character_count', 0) < 1500:
        raise SystemExit('Insufficient existing allowance; no paid overage attempted')
    DEST.mkdir(parents=True, exist_ok=True)
    receipt_path = DEST / 'manifest.json'
    receipt = json.loads(receipt_path.read_text()) if receipt_path.exists() else {
        'provider': 'ElevenLabs', 'model': 'eleven_text_to_sound_v2',
        'terms': 'https://elevenlabs.io/terms-of-use',
        'commercialBasis': 'Generated under owner-authorized active paid starter subscription; no plan upgrade or overage.',
        'sourcePolicy': 'Only original text prompts; no uploaded recordings, voices, copyrighted references or private media.',
        'format': '48000 Hz mono signed little-endian PCM16; normalized -22 LUFS, -3 dBTP before mixing.',
        'assets': []}
    completed = {a['id'] for a in receipt['assets']}
    for name, (duration, prompt) in CUES.items():
        if name in completed:
            print(name + ': retained')
            continue
        with request('sound-generation?output_format=mp3_44100_128',
                     {'text': prompt, 'duration_seconds': duration, 'prompt_influence': 0.45,
                      'model_id': 'eleven_text_to_sound_v2'}) as response:
            encoded = response.read(2_000_001)
            cost = response.headers.get('character-cost')
        if not 1000 < len(encoded) < 2_000_000:
            raise SystemExit('Unexpected audio response size')
        temporary = ROOT / '.data' / ('immersion-' + name + '.mp3')
        temporary.parent.mkdir(exist_ok=True)
        temporary.write_bytes(encoded)
        destination = DEST / (name + '.pcm')
        subprocess.run([str(FFMPEG), '-hide_banner', '-loglevel', 'error', '-y', '-i', str(temporary),
            '-af', f'atrim=duration={duration + 0.15},loudnorm=I=-22:TP=-3:LRA=7,afade=t=in:d=0.008,afade=t=out:st={duration - .07}:d=0.07',
            '-ac', '1', '-ar', '48000', '-f', 's16le', str(destination)], check=True)
        raw = destination.read_bytes()
        receipt['assets'].append({'id': name, 'file': destination.name, 'prompt': prompt,
            'requestedSeconds': duration, 'seconds': len(raw) / 96000, 'bytes': len(raw),
            'sha256': hashlib.sha256(raw).hexdigest(), 'characterCost': cost,
            'generatedAt': __import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat()})
        receipt_path.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(name + ': generated ' + str(len(raw)) + ' bytes; credits ' + str(cost), flush=True)

if __name__ == '__main__':
    main()
