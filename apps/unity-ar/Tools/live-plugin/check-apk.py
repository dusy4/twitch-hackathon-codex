"""Check JNI class, packaged license and removal of Android Log calls from DEX."""
import struct
import sys
import zipfile


def strings_and_methods(data):
    def uint(offset):
        return struct.unpack_from('<I', data, offset)[0]

    strings = []
    for i in range(uint(56)):
        offset = uint(uint(60) + 4 * i)
        while data[offset] & 128:
            offset += 1
        offset += 1
        strings.append(data[offset:data.index(0, offset)].decode('utf-8', errors='replace'))
    types = [strings[uint(uint(68) + 4 * i)] for i in range(uint(64))]
    methods = []
    for i in range(uint(88)):
        owner, _, name = struct.unpack_from('<HHI', data, uint(92) + 8 * i)
        methods.append((types[owner], strings[name]))
    return types, methods


def publisher_log_calls(data, methods, types):
    """Conservatively scan publisher code for static Log invocations.

    The strict smoke audit checks the entire DEX method table. A full Unity APK
    may retain unrelated platform/Unity diagnostics under its own keep rules.
    This optional mode checks publisher call sites instead, including RootEncoder.
    """
    def uint(offset):
        return struct.unpack_from('<I', data, offset)[0]

    def uleb(offset):
        value = shift = 0
        while True:
            byte = data[offset]
            offset += 1
            value |= (byte & 127) << shift
            if byte < 128:
                return value, offset
            shift += 7

    violations = []
    for index in range(uint(96)):
        definition = uint(100) + index * 32
        owner = types[uint(definition)]
        if not owner.startswith(('Lcom/pedro/', 'Lcom/raidrift/live/')):
            continue
        cursor = uint(definition + 24)
        if not cursor:
            continue
        counts = []
        for _ in range(4):
            count, cursor = uleb(cursor)
            counts.append(count)
        for _ in range(counts[0] + counts[1]):
            _, cursor = uleb(cursor)
            _, cursor = uleb(cursor)
        for count in counts[2:]:
            method_index = 0
            for _ in range(count):
                delta, cursor = uleb(cursor)
                method_index += delta
                _, cursor = uleb(cursor)
                code, cursor = uleb(cursor)
                if not code:
                    continue
                words = struct.unpack_from('<' + str(uint(code + 12)) + 'H', data, code + 16)
                # Both normal and range invoke-static encodings put the method
                # index in the next code unit. Scanning every unit also scans
                # payload words, making any rare false positive conservative.
                for i in range(len(words) - 1):
                    if words[i] & 255 not in (0x71, 0x77) or words[i + 1] >= len(methods):
                        continue
                    target = methods[words[i + 1]]
                    if target[0] == 'Landroid/util/Log;' and target[1] in LOG_WRITERS:
                        violations.append((methods[method_index], target))
    return violations


LOG_WRITERS = ('v', 'd', 'i', 'w', 'e', 'wtf', 'println')


with zipfile.ZipFile(sys.argv[1]) as apk:
    assert 'assets/licenses/Apache-2.0.txt' in apk.namelist(), 'Missing Apache license'
    found_bridge = False
    for name in apk.namelist():
        if name.startswith('classes') and name.endswith('.dex'):
            types, methods = strings_and_methods(apk.read(name))
            found_bridge |= 'Lcom/raidrift/live/LiveBridge;' in types
            logs = (publisher_log_calls(apk.read(name), methods, types) if '--publisher-only' in sys.argv
                    else [method for method in methods if method[0] == 'Landroid/util/Log;'
                          and method[1] in LOG_WRITERS])
            assert not logs, f'Unstripped Android logging in {name}: {logs}'
    assert found_bridge, 'JNI bridge removed or renamed'
scope = 'publisher call sites' if '--publisher-only' in sys.argv else 'DEX method references'
print(f'PASS: JNI class retained, license packaged, no Android log-writing {scope}')
