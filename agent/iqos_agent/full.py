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
            raise RuntimeError('Metadata returned an invalid next history index')
        start = next_index - 1
        state = archive.sync_state(0, start, full=True)
        acked = state.get('acked_next_index')
        if state.get('full_history_complete') and acked is not None and next_index < acked:
            raise RuntimeError(
                f'History index went down from {acked} to {next_index}: '
                'possible archive reset or wrap; stopping so old ids are not '
                'mixed up with new records.')
        missing = sorted(state['missing'], reverse=True)
        remaining = len(missing)
        skipped = (start + 1) - remaining
        print(f'Metadata: next_index={next_index}; the server lacks {remaining} of {start + 1} ids.', flush=True)
        if desired is not None:
            print(f'Note: read limit = {desired} new ids.', flush=True)

        completed_range = True
        for idx in missing:
            if should_stop is not None and should_stop():
                completed_range = False
                print('Stopped on request.', flush=True)
                break
            if desired is not None and processed >= desired:
                completed_range = False
                print('Read limit reached; the rest next time.', flush=True)
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
                      f'(new {processed}, already on the server {skipped})', flush=True)
            if processed % FLUSH_EVERY == 0:
                archive.flush()
            if consecutive_errors >= MAX_CONSECUTIVE_ERRORS:
                completed_range = False
                print('STOP: repeated USB errors; what was sent stays on the server. '
                      'Check the cable and run again.', flush=True)
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
            print('DONE: the whole archive is on the server; '
                  'later runs read only new ids.', flush=True)
        else:
            print('INCOMPLETE: what was read is on the server; '
                  'the next run continues with the missing ids.', flush=True)
        print(f'Summary: read {processed}; detailed {new_full}; '
              f'empty {new_empty}; skipped {skipped}; errors {errors}', flush=True)
        return completed_range
    finally:
        if own_device:
            dev.close()
