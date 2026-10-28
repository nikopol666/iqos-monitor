"""Offline tests: 3-month sync, suspect clock, resume, manual full, annotation export."""
import datetime as dt
import json
import tempfile
from pathlib import Path
from iqos_agent.core import Reply, check_crc, crc16
from iqos_agent.storage import connect, recent_state, get_status, import_observations, save_event, export_csv
from iqos_agent.recent import sync_recent
from iqos_agent.full import sync_full
from iqos_agent.view import build

ROOT = Path(__file__).resolve().parents[2] / 'test-vectors'
ORIGINAL=json.loads((ROOT/'fialova_post_use_20261026_201913.json').read_text())['results'][0]['response_hex']
START=dt.datetime(2026,10,26,18,0,tzinfo=dt.timezone.utc)
OLD=dt.datetime(2026,5,3,10,0,tzinfo=dt.timezone.utc)
CUT=dt.datetime(2026,7,26,0,0,tzinfo=dt.timezone.utc)

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

info={'serial_number':'DEVICEA0000001'}
with tempfile.TemporaryDirectory() as d:
    folder=Path(d)
    db=connect(folder/'test.sqlite3')
    Fake.seen=[]
    assert sync_recent(db,info,delay=0.0,device_factory=Fake,cutoff_override=CUT)
    assert Fake.seen[0]==329 and Fake.seen[-1]==204, (Fake.seen[0],Fake.seen[-1])
    recent_next,mo,floor,warning=recent_state(db,info['serial_number'])
    assert (recent_next,mo,floor,warning)==(330,3,204,1)
    assert get_status(db,info['serial_number'],203) is None
    Fake.count=331;Fake.seen=[]
    assert sync_recent(db,info,delay=0.0,device_factory=Fake,cutoff_override=CUT)
    assert Fake.seen==[330],Fake.seen
    assert recent_state(db,info['serial_number'])[0]==331
    # Manual full must fill older IDs while preserving the recent-sync checkpoint.
    Fake.seen=[]
    assert sync_full(db,info,delay=0.0,device_factory=Fake)
    assert Fake.seen[0]==203 and Fake.seen[-1]==0
    assert get_status(db,info['serial_number'],0)=='ok'
    assert recent_state(db,info['serial_number'])[0]==331
    # Import the user's two measured ending alerts/counter differences.
    assert import_observations(db,Path(__file__).resolve().parents[1] / 'iqos_agent' / 'known_observations.json')==2
    # Seed measured event (we haven't fetched 1076 in the small fake archive).
    save_event(db,info['serial_number'],1076,'ok',frame(1076,dt.datetime(2026,10,26,19,2,tzinfo=dt.timezone.utc)))
    output=build(db,folder/'viewer.html').read_text(encoding='utf-8')
    assert 'Upozornění na konec' in output and 'Potáhnutí' in output
    assert '2026-10-26T19:06:16+00:00' in output
    assert 'Zobrazit kompletní uložený archiv' in output
    export=export_csv(db,folder/'export.csv').read_text(encoding='utf-8-sig')
    assert 'puffs_estimate_from_counter_delta' in export
    assert ';18;' in export
    db.close()

# User can interrupt and resume an incomplete window with no hidden progress.
with tempfile.TemporaryDirectory() as d:
    db=connect(Path(d)/'db.sqlite3');Fake.count=330;Fake.seen=[]
    assert sync_recent(db,info,desired=10,delay=0.0,device_factory=Fake,cutoff_override=CUT)
    assert recent_state(db,info['serial_number'])[0] is None
    assert len(Fake.seen)==10
    Fake.seen=[]
    assert sync_recent(db,info,delay=0.0,device_factory=Fake,cutoff_override=CUT)
    assert Fake.seen[0]==319
    assert recent_state(db,info['serial_number'])[0]==330
    db.close()
print('RECENT / CLOCK GAP / RESUME / FULL / OBSERVATIONS / HTML / CSV: PASSED')
