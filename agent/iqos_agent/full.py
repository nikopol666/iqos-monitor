"""Exhaustive archive download ("full history" job from the web).

Only previously captured read operations are ever sent. The server reports
which IDs below the device's next index it still lacks; those are read from
the newest down to zero and posted in batches, so a disconnect or a cancel
loses at most the current batch and the next run continues with what is
still missing.
"""
from __future__ import annotations
import time
from iqos_agent.core import IQOSDevice, device_name

GOOD = ('ok', 'empty')
RETRIES = 2                 # Up to 3 attempts total for transient errors.
MAX_CONSECUTIVE_ERRORS = 8  # Prevent endless timeouts after USB trouble.
FLUSH_EVERY = 20


def sync_full(archive, info, desired=None, delay=0.10, device_factory=IQOSDevice,
              on_step=None, dev=None, should_stop=None):
    """Read every ID in [0, next_index) the server does not hold yet.

    Returns True only when the whole range is covered without errors; a
    cancelled, limited or interrupted run returns False and resumes later.
    Raises ServerError when the server stops answering.
    """
    serial = info['serial_number']
    print(f'\n=== {device_name(serial)} ===', flush=True)
    own_device = dev is None
    if own_device:
        dev = device_factory(info)
    processed = new_full = new_empty = errors = 0
    consecutive_errors = 0
    try:
        next_index = dev.next_index()
        if not 1 <= next_index <= 0x1000000:
            raise RuntimeError('Metadata returned invalid next history index')
        start = next_index - 1
        state = archive.sync_state(0, start)
        acked = state.get('acked_next_index')
        if state.get('full_history_complete') and acked is not None and next_index < acked:
            raise RuntimeError(
                f'Index historie klesl z {acked} na {next_index}. '
                'Mozny reset/cyklovani archivu; synchronizace zastavena, aby '
                'nedoslo k zamene ID starych zaznamu.')
        missing = sorted(state['missing'], reverse=True)
        remaining = len(missing)
        skipped = (start + 1) - remaining
        print(f'Metadata: next_index={next_index}; serveru chybi {remaining} z {start + 1} indexu.', flush=True)
        if desired is not None:
            print(f'Pozor: testovaci limit = {desired} NOVYCH dotazu.', flush=True)

        completed_range = True
        for idx in missing:
            if should_stop is not None and should_stop():
                completed_range = False
                print('Zastaveno na zadost uzivatele.', flush=True)
                break
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
            timestamp = archive.save(idx, reply.status, reply.frame, reply.packets)
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
                      f'(nove {processed}, na serveru/preskocene {skipped})', flush=True)
            if processed % FLUSH_EVERY == 0:
                archive.flush()
            if consecutive_errors >= MAX_CONSECUTIVE_ERRORS:
                completed_range = False
                print('STOP: opakovane chyby USB. Odeslana data zustavaji na serveru. '
                      'Zkontroluj kabel a spust synchronizaci znovu.', flush=True)
                break
            time.sleep(delay)
            if on_step is not None:
                on_step(idx, processed, remaining)

        # An error for a scanned ID means the range is not yet fully archived;
        # the server keeps its old boundary so a new run retries it.
        if errors:
            completed_range = False
        archive.flush(next_index=next_index if completed_range else None, range_complete=completed_range)
        if completed_range:
            print('HOTOVO: cely dostupny rozsah je na serveru. '
                  'Pristi spusteni stahne pouze nova ID.', flush=True)
        else:
            print('NEUPLNE: odeslane zaznamy jsou na serveru; '
                  'dalsi spusteni navaze a doplni chybejici ID.', flush=True)
        print(f'Souhrn: nacteno {processed}; detailni {new_full}; '
              f'prazdne {new_empty}; preskoceno {skipped}; chyby {errors}', flush=True)
        return completed_range
    finally:
        if own_device:
            dev.close()
