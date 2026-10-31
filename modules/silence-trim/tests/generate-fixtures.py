#!/usr/bin/env python3
"""Deterministic, private-free MP4 fixtures for the production local ALAC reader.
All generated media and ffprobe/PCM reference data stay in .local-cache.
"""
from array import array
import hashlib
import json
import math
from pathlib import Path
import struct
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / '.local-cache' / 'silence-mp4-fixtures'
OUT.mkdir(parents=True, exist_ok=True)
RATE = 48000
CHANNELS = 2
DURATION = 60
FIRST_SOUND = 1.2
LAST_SOUND = 58.0


def run(args, binary=False):
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError(result.stderr.decode()[-5000:])
    return result.stdout if binary else result.stdout.decode()


def boxes(path):
    result = []
    with path.open('rb') as file:
        size = path.stat().st_size
        offset = 0
        while offset + 8 <= size:
            file.seek(offset)
            raw = file.read(16)
            length, kind = struct.unpack('>I4s', raw[:8])
            if length == 1:
                length = struct.unpack('>Q', raw[8:16])[0]
            if length == 0:
                length = size - offset
            if length < 8 or offset + length > size:
                raise RuntimeError(f'Invalid generated MP4 box at {offset}')
            result.append({'type': kind.decode('ascii'), 'offset': offset, 'size': length})
            offset += length
    return result


def reference_window(path, start, duration):
    pcm = run(['ffmpeg', '-v', 'error', '-ss', str(start), '-i', str(path), '-map', '0:a:0',
               '-t', str(duration), '-ac', str(CHANNELS), '-ar', str(RATE), '-c:a', 'pcm_f32le', '-f', 'f32le', '-'], True)
    values = array('f')
    values.frombytes(pcm)
    if sys.byteorder != 'little':
        values.byteswap()
    frames = len(values) // CHANNELS
    width = RATE // 100
    audible = []
    for first in range(0, frames, width):
        end = min(first + width, frames)
        energy = sum(value * value for value in values[first * CHANNELS:end * CHANNELS]) / ((end - first) * CHANNELS)
        if energy >= 10 ** (-60 / 10):
            audible.append((start + first / RATE, start + end / RATE))
    name = path.stem + ('.head.f32le' if start == 0 else '.tail.f32le')
    (OUT / name).write_bytes(pcm)
    return {'start_sec': start, 'duration_sec': frames / RATE, 'pcm': name,
            'first_audible_sec': audible[0][0] if audible else None,
            'last_audible_end_sec': audible[-1][1] if audible else None,
            'pcm_sha256': hashlib.sha256(pcm).hexdigest()}


# A deterministic test card, not a user's artwork or downloaded resource.
cover = OUT / 'test-cover.ppm'
cover.write_bytes(b'P6\n128 128\n255\n' + bytes(channel for y in range(128) for x in range(128)
                                             for channel in (x * 2, y * 2, (x ^ y) * 2)))
expr = "if(between(t,1.2,58),0.2*sin(2*PI*440*t),0)"
source = f"aevalsrc='{expr}|-{expr}':s={RATE}:d={DURATION}"
variants = [
    ('alac16-head.m4a', 'alac', 's16p', ['-movflags', '+faststart'], False, False),
    ('alac16-tail.m4a', 'alac', 's16p', [], False, False),
    ('alac24-head-cover-padding.m4a', 'alac', 's32p', ['-moov_size', '1048576'], True, False),
    ('alac24-tail-cover-padding.m4a', 'alac', 's32p', [], True, True),
    ('aac-negative.m4a', 'aac', 'fltp', ['-movflags', '+faststart'], False, False),
]
manifest = {'rate': RATE, 'channels': CHANNELS, 'duration_sec': DURATION,
            'known_first_sound_sec': FIRST_SOUND, 'known_last_sound_sec': LAST_SOUND,
            'threshold_db': -60, 'window_ms': 10, 'files': []}
for name, codec, sample_fmt, mux_flags, with_cover, trailing_padding in variants:
    path = OUT / name
    args = ['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', source]
    if with_cover:
        args += ['-i', str(cover)]
    args += ['-map', '0:a:0', '-c:a', codec, '-sample_fmt', sample_fmt]
    if codec == 'aac':
        args += ['-b:a', '192k']
    if with_cover:
        args += ['-map', '1:v:0', '-c:v', 'png', '-disposition:v:0', 'attached_pic',
                 '-metadata:s:v:0', 'title=Deterministic fixture cover', '-metadata:s:v:0', 'comment=Cover (front)']
    args += ['-metadata', 'title=Silence boundary fixture', '-metadata', 'artist=Fixture generator',
             '-metadata', 'comment=' + ('padding metadata ' * 256), *mux_flags, str(path)]
    run(args)
    if trailing_padding:
        with path.open('ab') as file:
            file.write(struct.pack('>I4s', 524288, b'free'))
            file.write(bytes(524288 - 8))
    streams = json.loads(run(['ffprobe', '-v', 'error', '-show_streams', '-show_data', '-of', 'json', str(path)]))['streams']
    audio = next(stream for stream in streams if stream['codec_type'] == 'audio')
    if audio['codec_name'] != codec:
        raise RuntimeError('The fixture is not the requested codec')
    if codec == 'alac' and int(audio['bits_per_raw_sample']) != (16 if sample_fmt == 's16p' else 24):
        raise RuntimeError('The ALAC depth was not produced as requested')
    packets = json.loads(run(['ffprobe', '-v', 'error', '-select_streams', 'a:0', '-show_packets', '-show_data_hash', 'sha256',
                             '-show_entries', 'packet=pts_time,duration_time,pos,size,data_hash', '-of', 'json', str(path)]))['packets']
    record = {'file': name, 'codec': codec, 'bytes': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
              'audio': audio, 'cover': any(stream['codec_type'] == 'video' for stream in streams), 'boxes': boxes(path),
              'packet_count': len(packets), 'packets_file': name + '.packets.json',
              'head': reference_window(path, 0, 3), 'tail': reference_window(path, 56, 4)}
    if codec == 'alac':
        assert abs(record['head']['first_audible_sec'] - FIRST_SOUND) < .011
        assert abs(record['tail']['last_audible_end_sec'] - LAST_SOUND) < .011
    (OUT / record['packets_file']).write_text(json.dumps(packets, indent=2) + '\n')
    (OUT / (name + '.packets.tsv')).write_text(''.join(f"{round(float(packet['pts_time']) * 1000000)}\t{packet['size']}\t{packet['data_hash'].split(':', 1)[1].lower()}\n" for packet in packets))
    manifest['files'].append(record)
    print(f'{name}: {codec}/{audio.get("bits_per_raw_sample", "?")} bit, {len(packets)} packets, {path.stat().st_size} bytes')
# Small, otherwise valid moov atoms must not turn a forged count into an
# enormous Media3 allocation. Keep the leaf sizes and file length unchanged.
def table_offset(data, target, start=0, end=None):
    end = len(data) if end is None else end
    while start + 8 <= end:
        size, kind = struct.unpack_from('>I4s', data, start)
        if size < 8 or start + size > end:
            raise RuntimeError('Invalid test source container')
        if kind == target:
            return start
        if kind in (b'moov', b'trak', b'mdia', b'minf', b'stbl', b'edts'):
            found = table_offset(data, target, start + 8, start + size)
            if found is not None:
                return found
        start += size
    return None

manifest['corruptions'] = []
original = (OUT / 'alac16-head.m4a').read_bytes()
for kind, count_relative in ((b'stsz', 16), (b'elst', 12), (b'stco', 12)):
    offset = table_offset(original, kind)
    if offset is None:
        raise RuntimeError('Expected table missing from the deterministic source')
    corrupt = bytearray(original)
    struct.pack_into('>I', corrupt, offset + count_relative, 0x7fffffff)
    name = 'corrupt-' + kind.decode() + '-count.m4a'
    (OUT / name).write_bytes(corrupt)
    manifest['corruptions'].append({'file': name, 'table': kind.decode(), 'table_offset': offset,
                                    'forged_entry_count': 0x7fffffff, 'expected': 'reject-before-media3-allocation'})
(OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(f'Fixture manifest: {OUT / "manifest.json"}')
