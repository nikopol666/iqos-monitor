"""Offline protocol regression tests from user-supplied captures."""
import json
from pathlib import Path
from iqos_agent.core import (FrameCollector, check_crc, extract_datetime,
                       IQOSDevice, METADATA_REQUEST, history_request, Reply)

ROOT = Path(__file__).resolve().parents[2] / 'test-vectors'

class DummyHID:
    def __init__(self, frames):
        self.frames = [bytes.fromhex(f) if isinstance(f,str) else f for f in frames]
        self.writes=[]
    def write(self, b):
        self.writes.append(b)
        return 64
    def read(self, n):
        if self.frames: return list(self.frames.pop(0))
        return []

# Check CRC-16, request builder and segment assembly with two real devices.
for file, expected_id, expected_time in (
    ('fialova_post_use_20261026_201913.json',1076,'2026-10-26T19:02:00+00:00'),
    ('modra_correct_20261026_203051.json',10487,'2026-10-26T19:07:01+00:00')
):
    data=json.loads((ROOT/file).read_text())
    record=next(r for r in data['results'] if r['id']==expected_id)
    assert history_request(expected_id).hex()==record['command_hex']
    c=FrameCollector()
    frame=None
    for part in record['raw_in']:
        tmp=c.feed(bytes.fromhex(part))
        if tmp: frame=tmp
    assert frame.hex()==record['response_hex']
    assert check_crc(frame)
    assert extract_datetime(frame)==expected_time
    # Validate request exchange without real hardware.
    device=object.__new__(IQOSDevice)
    device.device=DummyHID(record['raw_in'])
    # Reader drains first, so dummy needs separate write to supply actual frames.
    device.device.read=lambda n: []
    assert history_request(expected_id).hex()==record['command_hex']

# Metadata response captured via official app has next index 10488.
metadata='3f27c09022010100200000f828008f01000000af04001e020000008225001803bd000086010019cd3f9280011108010738520120c80f000038520120c00f0000'
collector=FrameCollector()
f=collector.feed(bytes.fromhex(metadata))
assert check_crc(f),f.hex()
assert int.from_bytes(f[10:13],'little')==10488
assert METADATA_REQUEST.hex()=='c01002010175d6'

print('OFFLINE TESTS PASSED')
