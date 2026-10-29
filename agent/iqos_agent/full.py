"""IQOS history collector: three months by default; optional full USB archive.

Only previously captured read operations are ever sent. Each record is committed
individually so a disconnect or Ctrl+C does not lose earlier reads.
"""
from __future__ import annotations
import argparse
import sys
import time
from pathlib import Path
from iqos_agent.core import IQOSDevice, NAMES, device_name, connected_devices
from iqos_agent.storage import (DB_FOLDER, connect, export_csv, get_device_sync_state,
                          get_status, import_json_files, mark_initial_complete,
                          save_device, save_event, save_snapshot, stats)

GOOD = ('ok', 'empty')
RETRIES = 2                 # Up to 3 attempts total for transient errors.
MAX_CONSECUTIVE_ERRORS = 8  # Prevent endless timeouts after USB trouble.


def args_parse(argv=None):
    parser = argparse.ArgumentParser(description='IQOS History – read-only USB archivator')
    parser.add_argument('--count', type=int, default=None,
                        help='Volitelny LIMIT NOVYCH cteni na zarizeni (vychozi: cela historie)')
    parser.add_argument('--device', default='all',
                        help='all, jmeno znameho zarizeni (fialova/modra) nebo seriove cislo')
    parser.add_argument('--full', action='store_true',
                        help='Rucne precist celou dostupnou historii vcetne starych dat')
    parser.add_argument('--months', type=int, default=3,
                        help='Bezna synchronizace: posledni N kalendarni mesice (vychozi 3)')
    parser.add_argument('--import-dir', type=Path, help='Import drive zachycenych JSON souboru')
    parser.add_argument('--csv', action='store_true', help='Exportovat historii do CSV')
    parser.add_argument('--no-read', action='store_true', help='Pouze import/export bez USB')
    parser.add_argument('--db', type=Path, default=DB_FOLDER / 'history.sqlite3')
    parser.add_argument('--delay', type=float, default=0.10,
                        help='Minimalni prodleva mezi USB dotazy (vychozi 0.10 sekundy)')
    args = parser.parse_args(argv)
    if not 1 <= args.months <= 36:
        parser.error('--months musi byt 1..36')
    if args.count is not None and not (1 <= args.count <= 1000000):
        parser.error('--count must be 1..1000000 (or omit for entire archive)')
    if args.delay < 0.05:
        parser.error('--delay must be at least 0.05 sec')
    return args


def sync_full(db, info, desired=None, delay=0.10, device_factory=IQOSDevice,
              on_step=None, skip_snapshot=False, dev=None, should_stop=None):
    """First sync scans ALL indices down to zero, including gaps.

    Previously fetched IDs are skipped. A completed full sync saves an
    acknowledged next-index boundary, enabling later incremental reads.
    Incomplete full and incremental scans retain their original boundary
    and resume remaining indices next time.
    """
    serial = info['serial_number']
    name = device_name(serial)
    print(f'\n=== {name} ===', flush=True)
    own_device = dev is None
    if own_device:
        dev = device_factory(info)
    processed = new_full = new_empty = errors = skipped = 0
    consecutive_errors = 0
    try:
        next_index = dev.next_index()
        if not 1 <= next_index <= 0x1000000:
            raise RuntimeError('Metadata returned invalid next history index')

        prior_next, initial_complete = get_device_sync_state(db, serial)
        if initial_complete and prior_next is not None and next_index < prior_next:
            raise RuntimeError(
                f'Index historie klesl z {prior_next} na {next_index}. '
                'Mozny reset/cyklovani archivu; synchronizace zastavena, aby '
                'nedoslo k zamene ID starych zaznamu.')
        save_device(db, serial)  # Do not advance the acknowledged high-water mark yet!
        # Scope-style read-only diagnostics captured on both devices. A problem
        # with diagnostics must not block a complete archival download.
        if hasattr(dev, 'device') and not skip_snapshot:
            try:
                from iqos_agent.device_info import read_snapshot
                snap=read_snapshot(dev)
                save_snapshot(db,serial,snap)
                print('Diagnostika:',snap['values'].get('battery_percent'),'% baterie;',
                      'celozivotni pocitadlo:',snap['values'].get('lifetime_sticks_candidate'),
                      flush=True)
            except Exception as exc:
                print('Diagnostiku nelze nacist (archiv pokracuje):',str(exc),flush=True)

        # Fully completed archive: fetch only IDs created since the last sync.
        # Incomplete / upgraded v0.1 archive: fill in *everything*, down to zero.
        bottom = prior_next if initial_complete and prior_next is not None else 0
        start = next_index - 1
        todo = max(0, start - bottom + 1)
        # Progress is reported against what this run still has to read, not the whole archive.
        from iqos_agent.storage import count_stored
        remaining = max(0, todo - count_stored(db, serial, bottom, start)) if todo else 0
        if initial_complete:
            print(f'Prubezna synchronizace: nove indexy {bottom} az {start}', flush=True)
        else:
            print(f'Prvni kompletni synchronizace: indexy {start} az 0', flush=True)
        print(f'Metadata: next_index={next_index}; rozsah={todo} indexu. '
              f'Prazdna ID se take kontroluji.', flush=True)
        if desired is not None:
            print(f'Pozor: testovaci limit = {desired} NOVYCH dotazu.', flush=True)

        completed_range = True
        for idx in range(start, bottom - 1, -1):
            if should_stop is not None and should_stop():
                completed_range = False
                print('Zastaveno na zadost uzivatele.', flush=True)
                break
            if get_status(db, serial, idx) in GOOD:
                skipped += 1
                if on_step is not None and (skipped % 50 == 0):
                    on_step(idx, processed, remaining)
                continue
            if desired is not None and processed >= desired:
                completed_range = False
                print('Dosazen volitelny limit. Zbytek nacteme priste.', flush=True)
                break

            # Retry temporary errors; never loop infinitely on a broken device.
            for attempt in range(RETRIES + 1):
                reply = dev.read(idx)
                if reply.status in GOOD:
                    break
                if attempt < RETRIES:
                    time.sleep(max(0.25, delay) * (attempt + 1))
            timestamp = save_event(db, serial, idx, reply.status, reply.frame,
                                   reply.packets)
            processed += 1
            if reply.status == 'ok':
                new_full += 1
                consecutive_errors = 0
            elif reply.status == 'empty':
                new_empty += 1
                consecutive_errors = 0
            else:
                errors += 1
                consecutive_errors += 1

            if processed <= 5 or processed % 100 == 0 or reply.status not in GOOD:
                print(f'  id={idx:<8} {reply.status:<13} {timestamp or ""} '
                      f'(nove {processed}, ulozene/preskocene {skipped})', flush=True)
            if consecutive_errors >= MAX_CONSECUTIVE_ERRORS:
                completed_range = False
                print('STOP: opakovane chyby USB. Dosavadni data zustavaji ulozena. '
                      'Zkontroluj kabel a spust synchronizaci znovu.', flush=True)
                break
            time.sleep(delay)
            if on_step is not None:
                on_step(idx, processed, remaining)

        # An error for a scanned ID means the range is not yet fully archived;
        # keep the old boundary so a new run retries it (and any missed IDs).
        if errors:
            completed_range = False
        if completed_range:
            mark_initial_complete(db, serial, next_index)
            print('HOTOVO: cely dostupny rozsah je v databazi. '
                  'Pristi spusteni stahne pouze nova ID.', flush=True)
        else:
            print('NEUPLNE: dostupne zaznamy jsou ulozene; '
                  'dalsi spusteni navaze a doplni chybejici ID.', flush=True)
        print(f'Souhrn: nacteno {processed}; detailni {new_full}; '
              f'prazdne {new_empty}; preskoceno {skipped}; chyby {errors}', flush=True)
        return completed_range or errors == 0  # Limit is an expected partial run.
    finally:
        if own_device:
            dev.close()


def sync_one(db, info, desired=None, delay=0.10, device_factory=IQOSDevice,
             full=False, months=3, cutoff_override=None):
    if full:
        return sync_full(db,info,desired,delay,device_factory)
    from iqos_agent.recent import sync_recent
    return sync_recent(db,info,desired,delay,months,device_factory,cutoff_override)


def main(argv=None, device_factory=IQOSDevice, enumerate_devices=connected_devices):
    args = args_parse(argv)
    db = connect(args.db)
    failures = 0
    no_device = False
    interrupted = False
    try:
        # Two hand-verified experiments. Imported as annotations, NOT decoded
        # directly from event frames. Existing user edits are never overwritten.
        from iqos_agent.storage import import_observations
        import_observations(db,Path(__file__).with_name('known_observations.json'))
        if args.import_dir:
            files = sorted(args.import_dir.glob('*.json'))
            result = import_json_files(db, files)
            print('Import:', result, 'from', args.import_dir, flush=True)
        if not args.no_read:
            try:
                devices = enumerate_devices()
            except ImportError:
                print('CHYBA: Chybi hidapi. Nainstaluj: py -3 -m pip install hidapi',
                      file=sys.stderr)
                return 2
            serial_by_name = {v.lower(): k for k, v in NAMES.items()}
            if args.device != 'all':
                serial = serial_by_name.get(args.device.lower(), args.device)
                devices = [d for d in devices if d.get('serial_number') == serial]
            if not devices:
                no_device = True
                print('Zadne odpovidajici IQOS neni pripojeno. '
                      'Import i export zustavaji dostupne.', flush=True)
            else:
                for info in devices:
                    try:
                        if not sync_one(db, info, args.count, args.delay, device_factory,
                                        full=args.full, months=args.months):
                            failures += 1
                    except KeyboardInterrupt:
                        interrupted = True
                        print('\nPreruseno. Ulozene zaznamy zustavaji v databazi.', flush=True)
                        break
                    except Exception as exc:
                        failures += 1
                        print('CHYBA zarizeni:', type(exc).__name__, str(exc), file=sys.stderr)
    except KeyboardInterrupt:
        interrupted = True
        print('\nPreruseno. Ulozene zaznamy zustavaji v databazi.', flush=True)
    finally:
        # Export even after interrupted scans; the DB is always the source of truth.
        if args.csv:
            output = args.db.parent / 'export_history.csv'
            print('CSV:', export_csv(db, output), flush=True)
        print('\nSQLite:', args.db, flush=True)
        print('Stored counts:', stats(db), flush=True)
        db.close()
    return 130 if interrupted else 1 if failures or no_device else 0


if __name__ == '__main__':
    raise SystemExit(main())
