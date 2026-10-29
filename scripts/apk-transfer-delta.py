"""Exact APK transfer delta for disposable QA VMs; preserves the original signed bytes.

Reuses identical compressed ZIP entry payloads. New headers, signing block and
central directory are copied literally. Full base/target SHA256 checks are mandatory.
The phone still installs the complete reconstructed APK through normal verification.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import zipfile

def sha(data): return hashlib.sha256(data).hexdigest()

def create(base_path, target_path, output):
    base, target = base_path.read_bytes(), target_path.read_bytes()
    def payload(data, entry):
        start = entry.header_offset
        if data[start:start+4] != b'PK\x03\x04': raise ValueError('Invalid ZIP local header')
        name, extra = struct.unpack_from('<HH', data, start + 26)
        offset = start + 30 + name + extra
        return offset, entry.compress_size
    commands, literal, cursor, reused = [], bytearray(), 0, 0
    def insert(start, end):
        if end > start:
            commands.append(dict(literal=len(literal), length=end-start))
            literal.extend(target[start:end])
    with zipfile.ZipFile(base_path) as old, zipfile.ZipFile(target_path) as new:
        entries = {entry.filename: entry for entry in old.infolist()}
        for entry in sorted(new.infolist(), key=lambda item: item.header_offset):
            previous = entries.get(entry.filename)
            if previous is None or entry.compress_size == 0: continue
            offset, length = payload(target, entry)
            old_offset, old_length = payload(base, previous)
            if length == old_length and base[old_offset:old_offset+length] == target[offset:offset+length]:
                insert(cursor, offset)
                commands.append(dict(copy=old_offset, length=length))
                cursor = offset + length; reused += length
        insert(cursor, len(target))
    manifest = dict(version=1, baseSha256=sha(base), targetSha256=sha(target), targetBytes=len(target), commands=commands)
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('manifest.json', json.dumps(manifest))
        archive.writestr('payload.bin', literal)
    print(json.dumps(dict(targetSha256=manifest['targetSha256'], targetBytes=len(target), reusedBytes=reused, patchBytes=output.stat().st_size)))

def apply(base_path, patch):
    base_path = base_path.resolve(strict=True)
    base = base_path.read_bytes()
    with zipfile.ZipFile(patch) as archive:
        if archive.getinfo('payload.bin').file_size > 150_000_000: raise ValueError('Oversized delta payload')
        manifest = json.loads(archive.read('manifest.json'))
        literal = archive.read('payload.bin')
    if manifest['version'] != 1 or sha(base) != manifest['baseSha256']: raise ValueError('Base APK does not match')
    if not 0 < manifest['targetBytes'] <= 150_000_000: raise ValueError('Invalid target size')
    result = bytearray()
    for command in manifest['commands']:
        source = base if 'copy' in command else literal
        offset = command.get('copy', command.get('literal')); length = command['length']
        if offset < 0 or length < 0 or offset + length > len(source): raise ValueError('Invalid delta range')
        result.extend(source[offset:offset+length])
        if len(result) > manifest['targetBytes']: raise ValueError('Delta exceeds target size')
    if len(result) != manifest['targetBytes'] or sha(result) != manifest['targetSha256']: raise ValueError('Reconstructed APK checksum failed')
    temporary = base_path.with_name(base_path.name + '.qa-next')
    temporary.write_bytes(result)
    temporary.replace(base_path)
    print(json.dumps(dict(verified=True, sha256=manifest['targetSha256'], bytes=len(result))))

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest='command', required=True)
    build = commands.add_parser('create')
    build.add_argument('base', type=Path); build.add_argument('target', type=Path); build.add_argument('patch', type=Path)
    install = commands.add_parser('apply')
    install.add_argument('base', type=Path); install.add_argument('patch', type=Path)
    args = parser.parse_args()
    if args.command == 'create': create(args.base, args.target, args.patch)
    else: apply(args.base, args.patch)
