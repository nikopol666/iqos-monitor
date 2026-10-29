"""Full archive download against an in-memory server: holes, limit, cancel, USB drop, retries."""
from iqos_agent.archive import ServerArchive
from iqos_agent.core import Reply
from iqos_agent.full import sync_full
from tests.fakeserver import FakeServer

SERIAL='DEVICEA0000001'
info={'serial_number':SERIAL}

class Fake:
    observed=[]
    stop_at=None
    errors={}
    count=10
    def __init__(self,info): self.serial=info['serial_number']
    def next_index(self): return Fake.count
    def read(self,idx):
        Fake.observed.append(idx)
        if Fake.stop_at is not None and idx == Fake.stop_at:
            raise KeyboardInterrupt
        if idx in Fake.errors:
            return Reply(Fake.errors[idx])
        return Reply('empty',b'abc') if idx % 3 == 1 else Reply('ok',b'abc')
    def close(self): pass

def fresh():
    server=FakeServer()
    return server, ServerArchive(server,SERIAL)

# Everything the server lacks is read, newest first; stored IDs are skipped.
server,archive=fresh()
server.post_events(SERIAL,[{'event_id':8,'status':'ok','timestamp_candidate_utc':None}])
Fake.observed.clear(); Fake.count=10
assert sync_full(archive,info,delay=0.0,device_factory=Fake)
assert Fake.observed == [9,7,6,5,4,3,2,1,0],Fake.observed
assert server.acked[SERIAL]==10
for i in range(10): assert server.status(SERIAL,i) in ('ok','empty')
# Same index unchanged => no new device reads.
Fake.observed.clear(); assert sync_full(archive,info,delay=0.0,device_factory=Fake)
assert Fake.observed == []
# One new index => one new read.
Fake.count=11; assert sync_full(archive,info,delay=0.0,device_factory=Fake)
assert Fake.observed == [10]
assert server.acked[SERIAL]==11

# Read limit, then resume without starting over.
server,archive=fresh()
Fake.observed.clear(); Fake.count=10; Fake.stop_at=None
assert not sync_full(archive,info,desired=2,delay=0.0,device_factory=Fake)
assert Fake.observed == [9,8]
assert server.acked.get(SERIAL) is None
Fake.observed.clear()
assert sync_full(archive,info,delay=0.0,device_factory=Fake)
assert Fake.observed == list(range(7,-1,-1))
assert server.acked[SERIAL]==10

# Cancel from the web stops promptly and reports an incomplete run.
server,archive=fresh()
Fake.observed.clear(); Fake.count=10
assert not sync_full(archive,info,delay=0.0,device_factory=Fake,should_stop=lambda: len(Fake.observed)>=3)
assert Fake.observed == [9,8,7]
assert server.acked.get(SERIAL) is None and len(server.events[SERIAL])==3

# USB drop partway: records posted so far stay on the server; the next run continues.
server,archive=fresh()
Fake.observed.clear(); Fake.count=10; Fake.stop_at=5
try: sync_full(archive,info,delay=0.0,device_factory=Fake)
except KeyboardInterrupt: pass
archive.flush()
assert server.status(SERIAL,6) == 'ok'
assert server.acked.get(SERIAL) is None
Fake.observed.clear(); Fake.stop_at=None
assert sync_full(archive,info,delay=0.0,device_factory=Fake)
assert Fake.observed == list(range(5,-1,-1))
assert server.acked[SERIAL]==10

# A read error on a new index does not advance the acked boundary; it is retried next run.
server,archive=fresh()
Fake.count=3; Fake.observed.clear()
assert sync_full(archive,info,delay=0.0,device_factory=Fake)
assert server.acked[SERIAL]==3
Fake.count=5; Fake.errors={4:'timeout'}; Fake.observed.clear()
assert not sync_full(archive,info,delay=0.0,device_factory=Fake)
assert server.acked[SERIAL]==3
assert server.status(SERIAL,3)=='ok'
assert server.status(SERIAL,4)=='timeout'
Fake.errors={}; Fake.observed.clear()
assert sync_full(archive,info,delay=0.0,device_factory=Fake)
assert Fake.observed == [4]
assert server.acked[SERIAL]==5
print('FULL ARCHIVE / RESUME / CANCEL / USB DROP / RETRIES: PASSED')
