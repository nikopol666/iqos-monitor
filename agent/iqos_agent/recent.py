"""Conservative recent-window sync for IQOS archival event records.

Timestamps can be WRONG (particularly on devices which only recently synced
clock), so a three-month window is a best-effort time-based selection, not
proof that older IDs could not represent a more recent real-world session.
The manual --full option uses the separate exhaustive archival code.
"""
from __future__ import annotations
import calendar
import datetime as dt
import time
from iqos_agent.core import IQOSDevice, device_name
from iqos_agent.storage import (get_event_summary, save_event, save_device,
                          recent_state, save_recent_state, save_snapshot)

# Read past the apparent cutoff to reduce the chance that a date jump or a
# small hole accidentally truncates the archive scan.
AFTER_OLD_MIN_IDS = 120
AFTER_OLD_MAX_IDS = 240
MIN_OLD_DATED = 30
RETRIES = 2
MAX_CONSECUTIVE_ERRORS = 8


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


def sync_recent(db, info, desired=None, delay=0.10, months=3,
                device_factory=IQOSDevice, cutoff_override=None, on_step=None,
                skip_snapshot=False, dev=None):
    """on_step(idx, processed, total_or_None) runs after every index (agent live tick).
    dev: already opened device to reuse (agent); it is not closed here then."""
    serial=info['serial_number']
    print('\n=== '+device_name(serial)+' | posledni '+str(months)+' mesice ===',flush=True)
    own_device = dev is None
    if own_device:
        dev=device_factory(info)
    processed=skipped=filled=empty=errors=0
    consecutive_errors=0
    warned=False
    try:
        next_idx=dev.next_index()
        if not 1 <= next_idx <= 0x1000000:
            raise RuntimeError('Chybna metadata historie')
        save_device(db,serial)
        old_next,old_months,old_floor,old_clock_warning=recent_state(db,serial)
        if old_next is not None and next_idx<old_next:
            raise RuntimeError('Index historie klesl: archiv mohl byt resetovan. Neodvozujeme identitu z ID.')
        # If the window is expanded, perform a fresh bounded scan; previous
        # entries are skipped and never discarded.
        first=(old_next is None or (old_months is not None and months>old_months))
        cutoff=cutoff_override if cutoff_override is not None else recent_cutoff(months)
        print('Casovy filtr od '+cutoff.isoformat()+' UTC. Stare raw zaznamy nemažeme.',flush=True)
        if hasattr(dev,'device') and not skip_snapshot:
            try:
                from iqos_agent.device_info import read_snapshot
                snap=read_snapshot(dev)
                save_snapshot(db,serial,snap)
                print('Diagnostika: baterie',snap['values'].get('battery_percent'),
                      '%; pocitadlo',snap['values'].get('lifetime_sticks_candidate'),flush=True)
            except Exception as e:
                print('Diagnostika nedostupna:',str(e),flush=True)
        start=next_idx-1
        bottom=0 if first else old_next
        if first:
            print('Prvni 3mesicni synchronizace, plus ochranna rezerva za hranici data.',flush=True)
        else:
            print(f'Prirustkova synchronizace: ID {start} az {bottom}.',flush=True)
        first_old=None
        older_valid=0
        prev_valid=None
        scanned_floor=start
        incomplete=False
        stopped_on_cutoff=False
        for idx in range(start,bottom-1,-1):
            entry=get_event_summary(db,serial,idx)
            if entry is not None and entry[0] in ('ok','empty'):
                status,timestamp=entry
                skipped+=1
            else:
                if desired is not None and processed>=desired:
                    incomplete=True
                    print('Dosazen volitelny limit cteni; pokracuj dalsim spustenim.',flush=True)
                    break
                for attempt in range(RETRIES+1):
                    reply=dev.read(idx)
                    if reply.status in ('ok','empty'): break
                    if attempt<RETRIES:time.sleep(max(.25,delay)*(attempt+1))
                status=reply.status
                timestamp=save_event(db,serial,idx,status,reply.frame,reply.packets)
                processed+=1
                if status=='ok': filled+=1;consecutive_errors=0
                elif status=='empty':empty+=1;consecutive_errors=0
                else:errors+=1;consecutive_errors+=1
                if processed<=5 or processed%100==0 or status not in ('ok','empty'):
                    print(f'  ID {idx} {status} {timestamp or ""}',flush=True)
                if consecutive_errors>=MAX_CONSECUTIVE_ERRORS:
                    incomplete=True
                    print('Preruseno po opakovanych USB chybach. Ulozena data zustavaji.',flush=True)
                    break
                time.sleep(delay)
            scanned_floor=idx
            if on_step is not None:
                on_step(idx, processed, None)
            if not first:
                continue
            when=None
            if timestamp:
                try: when=dt.datetime.fromisoformat(timestamp)
                except ValueError:pass
            if when is not None:
                if prev_valid and prev_valid[0]==idx+1 and abs((prev_valid[1]-when).days)>30:
                    warned=True
                    print('POZOR: neobvykly skok hodin mezi ID',idx+1,'a',idx,
                          '- stara data mohou mit CHYBNE casy.',flush=True)
                prev_valid=(idx,when)
                if when<cutoff:
                    if first_old is None:
                        first_old=idx
                        print('Dosazena casova hranice na ID',idx,
                              '- overuji jeste ochranny presah.',flush=True)
                    older_valid+=1
                elif first_old is not None:
                    # Nonmonotone timestamps across IDs: can't trust one old ID.
                    print('POZOR: casove poradi archivu neni monotoni na ID',idx,flush=True)
                    warned=True
                    first_old=None
                    older_valid=0
            if first_old is not None:
                extra_ids=first_old-idx
                if extra_ids>=AFTER_OLD_MIN_IDS and older_valid>=MIN_OLD_DATED:
                    stopped_on_cutoff=True
                    break
                if extra_ids>=AFTER_OLD_MAX_IDS:
                    stopped_on_cutoff=True
                    warned=True
                    print('POZOR: konec ochranneho presahu; u zarizeni se spatnymi'
                          ' hodinami nelze zarucit skutecne 3mesicni pokryti.',flush=True)
                    break
        if errors or incomplete:
            print('Synchronizace nekompletni; pristi spusteni doplni chybejici ID.',flush=True)
        else:
            save_recent_state(db,serial,next_idx,months,scanned_floor,
                              warned or bool(old_clock_warning))
            print('Běžná synchronizace dokončena.',flush=True)
            if warned:
                print('VAROVANI: zaznamenan mozne chybny cas. '
                      'Pro kontrolu je dostupne manualni --full.',flush=True)
        print(f'Vysledek: nove dotazy {processed}, detailni {filled}, prazdne {empty},'
              f' preskocene {skipped}, chyby {errors}; nejstarsi prohledane ID {scanned_floor}.',flush=True)
        return errors==0  # --count partial sync is intentional, not a failure
    finally:
        if own_device:
            dev.close()
