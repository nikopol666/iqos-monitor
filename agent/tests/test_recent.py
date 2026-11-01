"""Sync tests against an in-memory server: 3-month window, clock gap, resume, full download, outage."""
import datetime as dt
import json
from pathlib import Path
from iqos_agent.archive import ServerArchive
from iqos_agent.core import Reply, check_crc, crc16
from iqos_agent.recent import sync_recent
from iqos_agent.full import sync_full
from iqos_agent.uploader import ServerError
from tests.fakeserver import FakeServer

ROOT = Path(__file__).resolve().parents[2] / 'test-vectors'
if not ROOT.exists():
    print('SKIPPED: test-vectors (real device captures) are not available')
    raise SystemExit(0)
ORIGINAL=json.loads((ROOT/'device-a_post_use_20261026_201913.json').read_text())['results'][0]['response_hex']
START=dt.datetime(2026,10,26,18,0,tzinfo=dt.timezone.utc)
OLD=dt.datetime(2026,5,3,10,0,tzinfo=dt.timezone.utc)
CUT=dt.datetime(2026,7,26,0,0,tzinfo=dt.timezone.utc)
SERIAL='DEVICEA0000001'
info={'serial_number':SERIAL}

def frame(index, when):
    f=bytearray.fromhex(ORIGINAL)
    f[8:11]=index.to_bytes(3,'little')
    seconds=int((when-dt.datetime(2010,1,1,tzinfo=dt.timezone.utc)).total_seconds())
    f[19:23]=seconds.to_bytes(4,'little')
    f[-2:]=crc16(f[2:-2]).to_bytes(2,'little')
    assert check_crc(f)
    return bytes(f)

class Fake:
    count=330
    seen=[]
    stop_id=None
    def __init__(self,info):pass
    def next_index(self):return Fake.count
    def read(self,index):
        Fake.seen.append(index)
        if Fake.stop_id==index:raise KeyboardInterrupt()
        when=START if index>=325 else OLD
        return Reply('ok',frame(index,when))
    def close(self):pass

# First window scan walks down past the cutoff with the guard margin, then the
# server records the covered range; nothing below the floor is read.
server=FakeServer(); archive=ServerArchive(server,SERIAL)
Fake.seen=[]
assert sync_recent(archive,info,delay=0.0,device_factory=Fake,cutoff_override=CUT)
assert Fake.seen[0]==329 and Fake.seen[-1]==204, (Fake.seen[0],Fake.seen[-1])
assert server.acked[SERIAL]==330
assert server.status(SERIAL,204)=='ok' and server.status(SERIAL,203) is None
assert archive.pending()==0
# One new record => one read, acked index advances.
Fake.count=331;Fake.seen=[]
assert sync_recent(archive,info,delay=0.0,device_factory=Fake,cutoff_override=CUT)
assert Fake.seen==[330],Fake.seen
assert server.acked[SERIAL]==331
# A gap the server lost (e.g. restored backup) is filled on the next run.
del server.events[SERIAL][300]
Fake.seen=[]
assert sync_recent(archive,info,delay=0.0,device_factory=Fake,cutoff_override=CUT)
assert Fake.seen==[300],Fake.seen
# Full download reads only what is still missing below the floor.
Fake.seen=[]
assert sync_full(archive,info,delay=0.0,device_factory=Fake)
assert Fake.seen[0]==203 and Fake.seen[-1]==0
assert server.status(SERIAL,0)=='ok'
assert server.acked[SERIAL]==331

# An interrupted first window (read limit) is continued, not restarted: the
# server has no acked range yet, so the scan goes on below the stored IDs.
server=FakeServer(); archive=ServerArchive(server,SERIAL); Fake.count=330; Fake.seen=[]
assert sync_recent(archive,info,desired=10,delay=0.0,device_factory=Fake,cutoff_override=CUT)
assert server.acked.get(SERIAL) is None
assert len(Fake.seen)==10 and len(server.events[SERIAL])==10
Fake.seen=[]
assert sync_recent(archive,info,delay=0.0,device_factory=Fake,cutoff_override=CUT)
# Stored IDs are skipped without their timestamps, so the guard margin counts
# from the first *newly read* old record (319) instead of 324: floor 199, not 204.
assert Fake.seen[0]==319 and Fake.seen[-1]==199, (Fake.seen[0],Fake.seen[-1])
assert server.acked[SERIAL]==330

# Server outage mid-scan: ServerError propagates, nothing is kept locally, the
# next run (server back) reads the lost records again.
server=FakeServer(); archive=ServerArchive(server,SERIAL); Fake.count=330; Fake.seen=[]
class Flaky(FakeServer):
    pass
server.fail=False
calls=[0]
orig=server.post_events
def flaky_post(*a,**k):
    calls[0]+=1
    if calls[0]==2:
        raise ServerError('fake outage')
    return orig(*a,**k)
server.post_events=flaky_post
try:
    sync_recent(archive,info,delay=0.0,device_factory=Fake,cutoff_override=CUT)
    raise AssertionError('expected ServerError')
except ServerError:
    pass
archive.discard()
stored_after_outage=len(server.events[SERIAL])
assert stored_after_outage==20, stored_after_outage      # exactly one flushed batch survived
server.post_events=orig; Fake.seen=[]
assert sync_recent(archive,info,delay=0.0,device_factory=Fake,cutoff_override=CUT)
assert Fake.seen[0]==309 and Fake.seen[-1]==189, (Fake.seen[0],Fake.seen[-1])
assert server.acked[SERIAL]==330
print('RECENT / CLOCK GAP / RESUME / FULL / OUTAGE: PASSED')
