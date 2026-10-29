"""SQLite store for raw IQOS historical records; keys are serial + archive index."""
from __future__ import annotations
import csv
import datetime as dt
import json
import sqlite3
from pathlib import Path
from iqos_agent.core import check_crc, extract_datetime, device_name
from iqos_agent.record_decode import decode_puffs

DB_FOLDER = Path.home() / "Documents" / "IQOS History"
DB_PATH = DB_FOLDER / "history.sqlite3"


def connect(path=DB_PATH):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=20)
    db.execute("PRAGMA journal_mode=WAL")
    db.executescript("""
        CREATE TABLE IF NOT EXISTS devices (
            serial TEXT PRIMARY KEY,
            display_name TEXT NOT NULL,
            last_seen_utc TEXT,
            next_index INTEGER,
            initial_sync_complete INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS events (
            serial TEXT NOT NULL,
            event_id INTEGER NOT NULL,
            timestamp_candidate_utc TEXT,
            status TEXT NOT NULL,
            response_hex TEXT,
            raw_packets_json TEXT,
            fetched_at_utc TEXT NOT NULL,
            PRIMARY KEY(serial,event_id)
        );
        CREATE INDEX IF NOT EXISTS events_time ON events(serial,timestamp_candidate_utc);
        CREATE TABLE IF NOT EXISTS device_snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            serial TEXT NOT NULL,
            collected_utc TEXT NOT NULL,
            data_json TEXT NOT NULL,
            FOREIGN KEY(serial) REFERENCES devices(serial)
        );
        CREATE INDEX IF NOT EXISTS device_snapshots_latest ON device_snapshots(serial,id);
        CREATE TABLE IF NOT EXISTS observations (
            serial TEXT NOT NULL,
            event_id INTEGER NOT NULL,
            end_notice_utc TEXT,
            puffs_estimate INTEGER,
            source TEXT NOT NULL,
            PRIMARY KEY(serial,event_id)
        );
    """)
    # v0.1 installations already have a devices table without this column.
    columns={row[1] for row in db.execute("PRAGMA table_info(devices)")}
    if 'initial_sync_complete' not in columns:
        db.execute("ALTER TABLE devices ADD COLUMN initial_sync_complete INTEGER NOT NULL DEFAULT 0")
        db.commit()
    # Recent history is a separate checkpoint from the legacy/full scan marker.
    # Existing v0.3 full-archive progress remains intact.
    columns={row[1] for row in db.execute("PRAGMA table_info(devices)")}
    for col,kind in [('recent_next_index','INTEGER'),('recent_months','INTEGER'),
                     ('recent_floor_index','INTEGER'),('recent_clock_warning','INTEGER')]:
        if col not in columns:
            db.execute(f"ALTER TABLE devices ADD COLUMN {col} {kind}")
    # Server upload bookkeeping (agent mode). NULL = not yet acknowledged by server.
    event_columns={row[1] for row in db.execute("PRAGMA table_info(events)")}
    if 'uploaded_at_utc' not in event_columns:
        db.execute("ALTER TABLE events ADD COLUMN uploaded_at_utc TEXT")
        db.execute("CREATE INDEX IF NOT EXISTS events_pending_upload ON events(serial,uploaded_at_utc)")
    snapshot_columns={row[1] for row in db.execute("PRAGMA table_info(device_snapshots)")}
    if 'uploaded_at_utc' not in snapshot_columns:
        db.execute("ALTER TABLE device_snapshots ADD COLUMN uploaded_at_utc TEXT")
    db.commit()
    return db


def utc_now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def save_device(db, serial, next_index=None):
    db.execute("""INSERT INTO devices(serial,display_name,last_seen_utc,next_index)
                  VALUES (?,?,?,?)
                  ON CONFLICT(serial) DO UPDATE SET
                    display_name=excluded.display_name,
                    last_seen_utc=excluded.last_seen_utc,
                    next_index=coalesce(excluded.next_index,devices.next_index)""",
               (serial,device_name(serial),utc_now(),next_index))
    db.commit()


def get_device_sync_state(db, serial):
    """next_index is an acknowledged high-water mark only after a completed sync."""
    row=db.execute('''SELECT next_index,initial_sync_complete
                      FROM devices WHERE serial=?''' , (serial,)).fetchone()
    if row is None:
        return None,False
    return row[0],bool(row[1])


def mark_initial_complete(db, serial, next_index):
    save_device(db, serial, next_index)
    db.execute("UPDATE devices SET initial_sync_complete=1 WHERE serial=?",(serial,))
    db.commit()


def reset_initial_complete(db, serial):
    db.execute("UPDATE devices SET initial_sync_complete=0,next_index=NULL WHERE serial=?",(serial,))
    db.commit()


def get_status(db, serial, index):
    row=db.execute('SELECT status FROM events WHERE serial=? AND event_id=?',
                   (serial,index)).fetchone()
    return row[0] if row else None


def save_event(db, serial, event_id, status, frame=b'', packets=()):
    timestamp = extract_datetime(frame) if status == 'ok' else None
    packet_json = json.dumps([p.hex() for p in packets]) if packets else None
    db.execute("""INSERT INTO events(serial,event_id,timestamp_candidate_utc,status,
                        response_hex,raw_packets_json,fetched_at_utc)
                  VALUES (?,?,?,?,?,?,?)
                  ON CONFLICT(serial,event_id) DO UPDATE SET
                    timestamp_candidate_utc=excluded.timestamp_candidate_utc,
                    status=excluded.status,
                    response_hex=excluded.response_hex,
                    raw_packets_json=coalesce(excluded.raw_packets_json,events.raw_packets_json),
                    fetched_at_utc=excluded.fetched_at_utc,
                    uploaded_at_utc=NULL
                  WHERE events.status NOT IN ('ok','empty')""",
               (serial,event_id,timestamp,status,frame.hex() if frame else '',
                packet_json,utc_now()))
    db.commit()
    return timestamp


def import_json_files(db, paths):
    stats={"files":0,"events":0,"invalid":0}
    for filepath in paths:
        try:
            data=json.loads(Path(filepath).read_text(encoding='utf-8-sig'))
        except (ValueError,OSError):
            stats['invalid']+=1
            continue
        serial=data.get('serial')
        if not serial or not isinstance(data.get('results'),list):
            stats['invalid']+=1
            continue
        stats['files']+=1
        save_device(db,serial)
        for item in data['results']:
            index=item.get('id')
            if not isinstance(index,int) or not (0 <= index <= 0xFFFFFF):
                continue
            try:
                frame=bytes.fromhex(item.get('response_hex') or '')
                raw_packets=[bytes.fromhex(x) for x in item.get('raw_in', [])]
            except (ValueError,TypeError):
                continue
            status=item.get('status','unknown')
            if frame and check_crc(frame):
                if status == 'ok' and len(frame) == 13:
                    status='empty'
            elif status in ('ok','empty'):
                status='bad_crc'
            save_event(db,serial,index,status,frame,raw_packets)
            stats['events']+=1
    return stats


def export_csv(db, output_path):
    output_path=Path(output_path)
    output_path.parent.mkdir(parents=True,exist_ok=True)
    with output_path.open('w',encoding='utf-8-sig',newline='') as file:
        writer=csv.writer(file,delimiter=';')
        writer.writerow(['device_name','serial','archive_id','time_candidate_utc',
                         'end_notice_utc_observed','puffs_estimate_from_counter_delta','observation_source',
                         'puff_count_candidate_from_raw','puff_event_pairs_raw_hex',
                         'status','response_hex','raw_packets_hex_json','fetched_at_utc'])
        for row in db.execute("""SELECT d.display_name,e.serial,e.event_id,
                                    e.timestamp_candidate_utc,o.end_notice_utc,o.puffs_estimate,o.source,
                                    e.status,e.response_hex,e.raw_packets_json,e.fetched_at_utc
                                  FROM events e JOIN devices d ON d.serial=e.serial
                                  LEFT JOIN observations o ON o.serial=e.serial AND o.event_id=e.event_id
                                  ORDER BY e.serial,e.event_id DESC"""):
            try:
                trace=decode_puffs(bytes.fromhex(row[8] or '')) if row[7]=='ok' else None
            except ValueError:
                trace=None
            writer.writerow([*row[:7],
                             trace.count if trace else '',
                             ' '.join(trace.event_pairs) if trace else '',
                             *row[7:]])
    return output_path


def stats(db):
    return db.execute("""SELECT d.display_name,e.serial,e.status,count(*)
                        FROM events e JOIN devices d ON e.serial=d.serial
                        GROUP BY e.serial,e.status ORDER BY e.serial,e.status""").fetchall()


def save_snapshot(db,serial,snapshot):
    db.execute("""INSERT INTO device_snapshots(serial,collected_utc,data_json)
                  VALUES(?,?,?)""", (serial,snapshot['collected_utc'],
                                      json.dumps(snapshot,ensure_ascii=False)))
    db.commit()

def latest_snapshots(db):
    items={}
    for serial,name,data in db.execute("""
        SELECT s.serial,d.display_name,s.data_json
        FROM device_snapshots s JOIN devices d ON d.serial=s.serial
        WHERE s.id=(SELECT MAX(t.id) FROM device_snapshots t WHERE t.serial=s.serial)
    """):
        items[serial]={'name':name,'serial':serial,**json.loads(data)}
    return list(items.values())


def recent_state(db, serial):
    row=db.execute("SELECT recent_next_index,recent_months,recent_floor_index,recent_clock_warning FROM devices WHERE serial=?", (serial,)).fetchone()
    return row if row else (None,None,None,None)


def save_recent_state(db, serial, next_index, months, floor_index, clock_warning):
    save_device(db,serial)
    db.execute("""UPDATE devices SET recent_next_index=?,recent_months=?,
               recent_floor_index=?,recent_clock_warning=? WHERE serial=?""",
               (next_index,months,floor_index,int(clock_warning),serial))
    db.commit()


def get_event_summary(db, serial, index):
    return db.execute('SELECT status,timestamp_candidate_utc FROM events WHERE serial=? AND event_id=?',
                      (serial,index)).fetchone()


def import_observations(db, filepath):
    """Optional, user-observed end notifications/puff counter deltas.

    These fields are explicitly NOT inferred from the archive binary.
    """
    filepath=Path(filepath)
    if not filepath.exists():
        return 0
    import json
    records=json.loads(filepath.read_text(encoding='utf-8-sig'))
    count=0
    for entry in records:
        serial=entry['serial']; index=int(entry['event_id'])
        if not serial or index < 0: continue
        save_device(db,serial)
        db.execute("INSERT OR IGNORE INTO observations(serial,event_id,end_notice_utc,puffs_estimate,source) VALUES(?,?,?,?,?)",
                   (serial,index,entry.get('end_notice_utc'),entry.get('puffs_estimate'),entry['source']))
        count+=1
    db.commit()
    return count


def pending_upload(db, serial, limit=200):
    """Events the server has not acknowledged yet, newest first."""
    return db.execute("""SELECT event_id,status,timestamp_candidate_utc,response_hex,raw_packets_json,fetched_at_utc
                         FROM events WHERE serial=? AND uploaded_at_utc IS NULL
                         ORDER BY event_id DESC LIMIT ?""", (serial,limit)).fetchall()


def mark_uploaded(db, serial, event_ids):
    if not event_ids:
        return
    now=utc_now()
    db.executemany("UPDATE events SET uploaded_at_utc=? WHERE serial=? AND event_id=?",
                   [(now,serial,int(i)) for i in event_ids])
    db.commit()


def pending_upload_count(db, serial):
    return db.execute("SELECT count(*) FROM events WHERE serial=? AND uploaded_at_utc IS NULL",(serial,)).fetchone()[0]


def latest_pending_snapshot(db, serial):
    """Newest local snapshot not yet sent to the server: (id, data_json) or None."""
    return db.execute("""SELECT id,data_json FROM device_snapshots
                         WHERE serial=? AND uploaded_at_utc IS NULL ORDER BY id DESC LIMIT 1""",
                      (serial,)).fetchone()


def mark_snapshots_uploaded(db, serial, up_to_id):
    db.execute("UPDATE device_snapshots SET uploaded_at_utc=? WHERE serial=? AND id<=? AND uploaded_at_utc IS NULL",
               (utc_now(),serial,int(up_to_id)))
    db.commit()


def count_stored(db, serial, low, high):
    """Number of archive IDs in [low, high] already stored with a good status."""
    return db.execute("SELECT count(*) FROM events WHERE serial=? AND event_id BETWEEN ? AND ? AND status IN ('ok','empty')",
                      (serial, int(low), int(high))).fetchone()[0]
