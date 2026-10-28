import json, tempfile, sqlite3
from pathlib import Path
from iqos_agent.core import Reply
from iqos_agent.storage import connect, get_device_sync_state, get_status, save_device, save_event
from iqos_agent.full import sync_one, args_parse

SERIAL='DEVICEA0000001'
info={'serial_number':SERIAL}

class Fake:
    observed=[]
    stop_at=None
    errors={}
    count=10
    def __init__(self,info): self.serial=info['serial_number']; self.calls=0
    def next_index(self): return Fake.count
    def read(self,idx):
        Fake.observed.append(idx)
        if Fake.stop_at is not None and idx == Fake.stop_at:
            raise KeyboardInterrupt
        if idx in Fake.errors:
            return Reply(Fake.errors[idx])
        return Reply('empty',b'abc') if idx % 3 == 1 else Reply('ok',b'abc')
    def close(self): pass

# Test fully unbounded first sync even with holes and existing imported JSON.
with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as d:
    db=connect(Path(d)/'db.sqlite3')
    save_device(db,SERIAL,10)  # v0.1 metadata value, but no completion flag.
    save_event(db,SERIAL,8,'ok',b'abc')
    ok=sync_one(db,info,full=True,desired=None,delay=0.0,device_factory=Fake)
    assert ok
    assert Fake.observed == [9,7,6,5,4,3,2,1,0],Fake.observed
    assert get_device_sync_state(db,SERIAL)==(10,True)
    for i in range(10): assert get_status(db,SERIAL,i) in ('ok','empty')
    # Same index unchanged => no new device reads.
    Fake.observed.clear(); assert sync_one(db,info,full=True,desired=None,delay=0.0,device_factory=Fake)
    assert Fake.observed == []
    # One new index => one new read.
    Fake.count=11; assert sync_one(db,info,full=True,desired=None,delay=0.0,device_factory=Fake)
    assert Fake.observed == [10]
    assert get_device_sync_state(db,SERIAL)==(11,True)
    db.close()

# Test test limit then full resume without restarting from scratch.
with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as d:
    db=connect(Path(d)/'db.sqlite3')
    Fake.observed.clear(); Fake.count=10; Fake.stop_at=None
    assert sync_one(db,info,full=True,desired=2,delay=0.0,device_factory=Fake)
    assert Fake.observed == [9,8]
    assert get_device_sync_state(db,SERIAL)==(None,False)
    Fake.observed.clear()
    assert sync_one(db,info,full=True,desired=None,delay=0.0,device_factory=Fake)
    assert Fake.observed == list(range(7,-1,-1))
    assert get_device_sync_state(db,SERIAL)==(10,True)
    db.close()

# Test physical disconnection partway through initial sync.
with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as d:
    db=connect(Path(d)/'db.sqlite3')
    Fake.observed.clear(); Fake.count=10; Fake.stop_at=5
    try: sync_one(db,info,full=True,desired=None,delay=0.0,device_factory=Fake)
    except KeyboardInterrupt: pass
    assert get_status(db,SERIAL,6) == 'ok'
    assert get_device_sync_state(db,SERIAL)==(None,False)
    Fake.observed.clear(); Fake.stop_at=None
    assert sync_one(db,info,full=True,desired=None,delay=0.0,device_factory=Fake)
    assert Fake.observed == list(range(5,-1,-1))
    assert get_device_sync_state(db,SERIAL)==(10,True)
    db.close()

# Test failure on a new incremental index does not advance highwater.
with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as d:
    db=connect(Path(d)/'db.sqlite3')
    Fake.count=3; Fake.observed.clear()
    assert sync_one(db,info,full=True,desired=None,delay=0.0,device_factory=Fake)
    assert get_device_sync_state(db,SERIAL)==(3,True)
    Fake.count=5; Fake.errors={4:'timeout'}; Fake.observed.clear()
    assert not sync_one(db,info,full=True,desired=None,delay=0.0,device_factory=Fake)
    assert get_device_sync_state(db,SERIAL)==(3,True)
    assert get_status(db,SERIAL,3)=='ok'
    assert get_status(db,SERIAL,4)=='timeout'
    Fake.errors={}; Fake.observed.clear()
    assert sync_one(db,info,full=True,desired=None,delay=0.0,device_factory=Fake)
    assert Fake.observed == [4]
    assert get_device_sync_state(db,SERIAL)==(5,True)
    db.close()

# Test migration of v0.1 schema.
with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as d:
    path=Path(d)/'db.sqlite3'
    db=sqlite3.connect(path); db.execute('CREATE TABLE devices (serial TEXT PRIMARY KEY,display_name TEXT NOT NULL,last_seen_utc TEXT,next_index INTEGER)'); db.commit();db.close()
    db=connect(path)
    assert get_device_sync_state(db,SERIAL)==(None,False)
    db.close()

# Validate CLI default of unlimited and explicit limit.
assert args_parse([]).count is None
assert not args_parse([]).full
assert args_parse([]).months==3
assert args_parse(['--full']).full
assert args_parse(['--count','150']).count==150
print('FULL ARCHIVE / RESUME / INCREMENTAL / RETRIES / MIGRATION: PASSED')
