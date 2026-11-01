"""Regression check for the observed history count/size invariant."""
import json
from pathlib import Path
from iqos_agent.record_decode import decode_puffs
from iqos_agent.core import check_crc

root = Path(__file__).resolve().parents[2] / 'test-vectors'
if not root.exists():
    print('SKIPPED: test-vectors (real device captures) are not available')
    raise SystemExit(0)
files = [
    'device-a_history_20261026_192057.json',
    'device-a_history_older_20261026_195416.json',
    'device-a_history_sample_20261026_195811.json',
    'device-a_post_use_20261026_201913.json',
    'device-b_correct_20261026_203051.json',
]
counts = {}
for name in files:
    for row in json.loads((root/name).read_text())['results']:
        data = bytes.fromhex(row['response_hex'])
        assert check_crc(data), (name, row['id'])
        result = decode_puffs(data)
        assert result is not None, (name,row['id'])
        assert result.count == (len(data)-117)//2
        counts[row['id']] = result.count
        bad=bytearray(data)
        bad[19]^=0xff
        assert decode_puffs(bytes(bad)) is None
assert counts[1076] == 18
assert counts[10487] == 14
assert counts[10486] == 0
assert counts[10485] == 15
print('DECODE PUFF COUNT:',len(counts),'real history frames verified; controlled 18/14 pass')
