"""Minimal Standard MIDI File reader: absolute-time events in seconds, merged across tracks."""
import struct


def read_var(data, i):
    value = 0
    while True:
        b = data[i]
        i += 1
        value = (value << 7) | (b & 0x7F)
        if not b & 0x80:
            return value, i


def read(path):
    data = open(path, 'rb').read()
    assert data[:4] == b'MThd'
    length, fmt, ntracks, division = struct.unpack('>IHHH', data[4:14])
    pos = 8 + length
    raw = []  # (tick, order, kind, payload)
    order = 0
    for _ in range(ntracks):
        assert data[pos:pos + 4] == b'MTrk', data[pos:pos + 4]
        tlen = struct.unpack('>I', data[pos + 4:pos + 8])[0]
        i, end = pos + 8, pos + 8 + tlen
        tick, status = 0, 0
        while i < end:
            delta, i = read_var(data, i)
            tick += delta
            b = data[i]
            if b == 0xFF:
                kind = data[i + 1]
                n, i = read_var(data, i + 2)
                raw.append((tick, order, 'meta', (kind, data[i:i + n])))
                i += n
            elif b in (0xF0, 0xF7):
                n, i2 = read_var(data, i + 1)
                body = data[i2:i2 + n]
                raw.append((tick, order, 'sysex', (b'\xF0' + body) if b == 0xF0 else body))
                i = i2 + n
            else:
                if b & 0x80:
                    status = b
                    i += 1
                size = 1 if status & 0xF0 in (0xC0, 0xD0) else 2
                raw.append((tick, order, 'msg', bytes([status]) + data[i:i + size]))
                i += size
            order += 1
        pos = end
    raw.sort(key=lambda e: (e[0], e[1]))
    # Ticks to seconds through the tempo map.
    tempo, last_tick, seconds = 500000, 0, 0.0
    events = []
    for tick, _, kind, payload in raw:
        seconds += (tick - last_tick) * tempo / 1e6 / division
        last_tick = tick
        if kind == 'meta':
            if payload[0] == 0x51:
                tempo = int.from_bytes(payload[1], 'big')
            continue
        events.append((seconds, kind, payload))
    return events
