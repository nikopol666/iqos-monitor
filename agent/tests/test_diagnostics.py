"""Offline checks with user's real USB HID frames; no physical USB operations."""
from __future__ import annotations
import json
from pathlib import Path
from iqos_agent.device_info import READ_COMMANDS, decode_classic, read_snapshot, crc8

ROOT = Path(__file__).resolve().parents[2] / 'test-vectors'
class Handle:
    def __init__(self, readmap):
        self.readmap=readmap
        self.pending=[]
        self.writes=[]
    def write(self, data):
        self.writes.append(bytes(data))
        body=bytes(data[2:2+data[1]])
        self.pending=list(self.readmap.get(body.hex(), []))
        return 64
    def read(self,n):
        return list(self.pending.pop(0)) if self.pending else []
class FakeDevice:
    def __init__(self,readmap): self.device=Handle(readmap)
for color,stamp,stick,puffs in [('fialova','201331',1077,14736),('modra','201341',15204,201053)]:
    logs=[json.loads(x) for x in (ROOT/f'{color}_20261026_{stamp}.jsonl').read_text().splitlines()]
    pairs={}
    trans={}
    for rec in logs:
        if rec.get('kind')=='tx': trans[rec['phase']]=rec['command']
        if rec.get('kind')=='rx': pairs.setdefault(rec['phase'],[]).append(bytes.fromhex(rec['raw']))
    aliases={'life_data_raw':'sensor_84','reg_83_raw':'sensor_83','counters_raw':'counters','session_raw':'session'}
    readmap={}
    for phase,command in trans.items():
        key=aliases.get(phase,phase)
        if key in READ_COMMANDS:
            assert READ_COMMANDS[key]==command,(color,key,READ_COMMANDS[key],command)
            readmap[command]=pairs[phase]
    fake=FakeDevice(readmap)
    snap=read_snapshot(fake)
    v=snap['values']
    assert v['brightness_level']==0x64,(color,v)   # reg 0x24 = LED brightness (high)
    assert v['battery_percent'] is None             # reg 0x60 not in these captures
    assert v['lifetime_sticks_candidate']==stick,(color,v)
    assert v['lifetime_puffs_candidate']==puffs,(color,v)
    assert v['model']=='42PT',(color,v)
    assert v['serial_readback']==('DEVICEA0000001' if color=='fialova' else 'DEVICEB0000002')
    assert snap['statuses']['brightness']=='unsupported'
    assert snap['statuses']['vibration']=='unsupported'
    assert snap['statuses']['flexbattery']=='unsupported'
    assert len(fake.device.writes)==len(READ_COMMANDS)
    assert all(p[0]==0x3f for p in fake.device.writes)
    print(color,'snapshot ok:',v['lifetime_sticks_candidate'],v['lifetime_puffs_candidate'])
print('SNAPSHOT READ-ONLY CAPTURE TESTS PASSED')
