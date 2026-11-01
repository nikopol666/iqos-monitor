"""Conservative recent-window sync for IQOS archival event records.

Timestamps can be WRONG (particularly on devices which only recently synced
clock), so a three-month window is a best-effort time-based selection, not
proof that older IDs could not represent a more recent real-world session.
The web's "download full history" job uses the exhaustive code in full.py.

State lives on the server: it tells us which IDs it already holds and whether
a window scan was ever completed (acked_next_index). The first scan walks down
from the newest record until the cutoff; later runs only read the IDs the
server reports missing above its lowest stored record (new records and gaps).
"""
from __future__ import annotations
import calendar
import datetime as dt
import time
from iqos_agent.core import IQOSDevice, device_name

# Read past the apparent cutoff to reduce the chance that a date jump or a
# small hole accidentally truncates the archive scan.
AFTER_OLD_MIN_IDS = 120
AFTER_OLD_MAX_IDS = 240
MIN_OLD_DATED = 30
RETRIES = 2
MAX_CONSECUTIVE_ERRORS = 8
GOOD = ('ok', 'empty')
FLUSH_EVERY = 20


def recent_cutoff(months: int, now: dt.datetime | None = None) -> dt.datetime:
    if now is None:
        now=dt.datetime.now().astimezone()
    now=now.astimezone()
    target_m=now.month - months
    target_y=now.year + (target_m - 1) // 12
    target_m=(target_m - 1) % 12 + 1
    target_d=min(now.day,calendar.monthrange(target_y,target_m)[1])
    return now.replace(year=target_y,month=target_m,day=target_d,
                       hour=0,minute=0,second=0,microsecond=0).astimezone(dt.timezone.utc)


def sync_recent(archive, info, desired=None, delay=0.10, months=3,
                device_factory=IQOSDevice, cutoff_override=None, on_step=None, dev=None):
    """archive: ServerArchive (or a test double with the same interface).
    on_step(idx, processed, total_or_None) runs after every index (agent live tick).
    dev: already opened device to reuse (agent); it is not closed here then.
    Raises ServerError when the server stops answering; nothing is kept locally."""
    serial=info['serial_number']
    print(f'\n=== {device_name(serial)} | last {months} months ===',flush=True)
    own_device = dev is None
    if own_device:
        dev=device_factory(info)
    processed=skipped=filled=empty=errors=0
    consecutive_errors=0
    warned=False
    try:
        next_idx=dev.next_index()
        if not 1 <= next_idx <= 0x1000000:
            raise RuntimeError('Invalid history metadata')
        start=next_idx-1
        state=archive.sync_state(0,start)
        acked=state.get('acked_next_index')
        lowest=state.get('lowest_stored_index')
        if acked is not None and next_idx<acked:
            raise RuntimeError('History index went down: the archive may have been reset; stopping so ids are not mixed up.')
        missing=set(state['missing'])
        # A window scan counts as done only once the server recorded its range;
        # until then every connect continues the bounded scan (skipping stored IDs).
        first = acked is None or lowest is None
        cutoff=cutoff_override if cutoff_override is not None else recent_cutoff(months)
        print('Time cutoff '+cutoff.isoformat()+' UTC; the server holds every stored record.',flush=True)
        if first:
            ids=range(start,-1,-1)
            print('First window scan, plus a guard margin past the cutoff.',flush=True)
        else:
            ids=sorted((i for i in missing if i>=lowest),reverse=True)
            skipped=(start-lowest+1)-len(ids)
            print(f'Incremental sync: ids {start} down to {lowest}, the server lacks {len(ids)}.',flush=True)
        total=None if first else len(ids)
        first_old=None
        older_valid=0
        prev_valid=None
        scanned_floor=start
        incomplete=False
        for idx in ids:
            if first and idx not in missing:
                skipped+=1
                scanned_floor=idx
                continue
            if desired is not None and processed>=desired:
                incomplete=True
                print('Read limit reached; the next run continues.',flush=True)
                break
            for attempt in range(RETRIES+1):
                reply=dev.read(idx)
                if reply.status in GOOD: break
                if attempt<RETRIES:time.sleep(max(.25,delay)*(attempt+1))
            status=reply.status
            timestamp=archive.save(idx,status,reply.frame,reply.packets)
            processed+=1
            if status=='ok': filled+=1;consecutive_errors=0
            elif status=='empty':empty+=1;consecutive_errors=0
            else:errors+=1;consecutive_errors+=1
            if processed<=5 or processed%100==0 or status not in GOOD:
                print(f'  ID {idx} {status} {timestamp or ""}',flush=True)
            if processed%FLUSH_EVERY==0:
                archive.flush()
            if consecutive_errors>=MAX_CONSECUTIVE_ERRORS:
                incomplete=True
                print('Stopped after repeated USB errors; what was sent stays on the server.',flush=True)
                break
            time.sleep(delay)
            scanned_floor=idx
            if on_step is not None:
                on_step(idx, processed, total)
            if not first:
                continue
            when=None
            if timestamp:
                try: when=dt.datetime.fromisoformat(timestamp)
                except ValueError:pass
            if when is not None:
                if prev_valid and prev_valid[0]==idx+1 and abs((prev_valid[1]-when).days)>30:
                    warned=True
                    print('WARNING: unusual clock jump between ids',idx+1,'and',idx,
                          '- older records may carry wrong times.',flush=True)
                prev_valid=(idx,when)
                if when<cutoff:
                    if first_old is None:
                        first_old=idx
                        print('Cutoff reached at id',idx,
                              '- reading the guard margin.',flush=True)
                    older_valid+=1
                elif first_old is not None:
                    # Nonmonotone timestamps across IDs: can't trust one old ID.
                    print('WARNING: archive times are not monotonic at id',idx,flush=True)
                    warned=True
                    first_old=None
                    older_valid=0
            if first_old is not None:
                extra_ids=first_old-idx
                if extra_ids>=AFTER_OLD_MIN_IDS and older_valid>=MIN_OLD_DATED:
                    break
                if extra_ids>=AFTER_OLD_MAX_IDS:
                    warned=True
                    print('WARNING: guard margin exhausted; with a wrong device clock'
                          ' the window coverage is not guaranteed.',flush=True)
                    break
        complete = errors==0 and not incomplete
        archive.flush(next_index=next_idx if complete else None, range_complete=complete)
        if complete:
            print('Sync complete.',flush=True)
            if warned:
                print('WARNING: a suspicious clock was seen; a full history download '
                      'from the web can check it.',flush=True)
        else:
            print('Sync incomplete; the next run fills the missing ids.',flush=True)
        print(f'Result: read {processed}, detailed {filled}, empty {empty},'
              f' skipped {skipped}, errors {errors}; lowest id scanned {scanned_floor}.',flush=True)
        return errors==0  # --count partial sync is intentional, not a failure
    finally:
        if own_device:
            dev.close()
