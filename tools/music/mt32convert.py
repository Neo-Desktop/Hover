"""Turns a General MIDI song into what a Roland MT-32 can play, as a list of timed messages.

usage: mt32convert.py <in.mid> <out.txt>     lines: "<frame at 32 kHz> <hex bytes>"

The MT-32 predates General MIDI: 8 instrument parts listening on MIDI channels 2-9, rhythm on
channel 10, its own 128 instruments, pan the other way round and a 12-semitone pitch bend. So:
the song's 8 busiest instrument channels go to channels 2-9 (the rest is dropped, as on a real
MT-32), GM instruments become their nearest MT-32 ones, pan is mirrored and bends are scaled to
the GM range of 2 semitones.
"""
import sys
import smf

RATE = 32000

# GM program -> nearest MT-32 preset (by instrument; see the module comment).
GM_TO_MT32 = [
    0, 1, 2, 7, 3, 4, 16, 19,  # pianos
    22, 101, 101, 97, 104, 103, 102, 105,  # chromatic percussion
    8, 9, 10, 12, 14, 15, 87, 15,  # organs
    59, 60, 61, 61, 62, 62, 62, 60,  # guitars
    64, 66, 67, 70, 68, 69, 28, 29,  # basses
    52, 53, 54, 56, 49, 51, 57, 112,  # strings
    48, 50, 49, 49, 34, 34, 39, 122,  # ensembles
    88, 90, 94, 89, 92, 95, 24, 25,  # brass
    78, 79, 80, 81, 84, 85, 86, 82,  # reeds
    74, 72, 76, 77, 110, 107, 108, 73,  # pipes
    47, 44, 42, 42, 62, 39, 45, 31,  # synth leads
    32, 36, 33, 34, 35, 40, 37, 43,  # synth pads
    41, 36, 38, 37, 46, 39, 40, 32,  # synth effects
    63, 60, 105, 105, 126, 106, 52, 85,  # ethnic
    101, 102, 99, 120, 117, 113, 115, 119,  # percussive
    62, 111, 41, 124, 123, 116, 37, 114,  # sound effects
]


def convert(src, dst):
    events = smf.read(src)
    busy = {}
    for t, kind, p in events:
        if kind == 'msg' and p[0] & 0xF0 == 0x90 and p[2] > 0 and p[0] & 15 != 9:
            busy[p[0] & 15] = busy.get(p[0] & 15, 0) + 1
    kept = sorted(sorted(busy, key=lambda c: -busy[c])[:8])
    route = {c: 1 + i for i, c in enumerate(kept)}  # 0-based MIDI channels 1-8 = channels 2-9
    route[9] = 9
    lines = []
    for t, kind, p in events:
        if kind != 'msg' or p[0] < 0x80 or p[0] >= 0xF0:
            continue
        ch = p[0] & 15
        if ch not in route:
            continue
        status = p[0] & 0xF0
        data = list(p[1:])
        if status == 0xC0:
            if ch == 9:
                continue  # the MT-32's rhythm part has one kit
            data[0] = GM_TO_MT32[data[0]]
        elif status == 0xB0 and data[0] == 10:
            data[1] = 127 - data[1]
        elif status == 0xE0:
            value = (data[1] << 7 | data[0]) - 8192
            value = max(-8192, min(8191, round(value / 6))) + 8192
            data = [value & 0x7F, value >> 7]
        msg = bytes([status | route[ch]] + data)
        lines.append('%d %s' % (round(t * RATE), msg.hex()))
    with open(dst, 'w') as f:
        f.write('\n'.join(lines) + '\n')
    print('%s: channels %s kept of %s' % (src, [c + 1 for c in kept], sorted(c + 1 for c in busy)))


if __name__ == '__main__':
    convert(sys.argv[1], sys.argv[2])
