"""The server is the only store for archive records.

The agent never keeps a database: it asks the server which archive IDs it is
still missing, reads exactly those from the device and posts them in batches.
Anything read but not yet posted when the server becomes unreachable is simply
read again on the next attempt.
"""
from __future__ import annotations

import datetime as dt
import json
from typing import Optional

from iqos_agent.core import extract_datetime

BATCH = 200


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


class ServerArchive:
    def __init__(self, client, serial: str):
        self.client = client
        self.serial = serial
        self._pending: list[dict] = []

    # -- state from the server ----------------------------------------------------------
    def sync_state(self, low: int, high: int, full: bool = False) -> dict:
        """acked_next_index, lowest_stored_index, full_history_complete and the list of
        archive IDs in [low, high] the server does not hold as 'ok' or 'empty'.
        full=True is the web's full history download: it also re-reads ids the user
        deleted (never the blocked ones)."""
        state = self.client.get_sync(self.serial, low, high, full)
        state["missing"] = [int(i) for i in state.get("missing") or []]
        return state

    # -- records read from the device ---------------------------------------------------
    def save(self, event_id: int, status: str, frame: bytes = b"", packets=()) -> Optional[str]:
        """Queue one archive read for upload; returns the decoded timestamp (ISO) if any."""
        timestamp = extract_datetime(frame) if status == "ok" and frame else None
        self._pending.append({
            "event_id": int(event_id),
            "status": status,
            "timestamp_candidate_utc": timestamp,
            "response_hex": frame.hex() if frame else "",
            "raw_packets_json": json.dumps([p.hex() for p in packets]) if packets else None,
            "fetched_at_utc": utc_now(),
        })
        return timestamp

    def pending(self) -> int:
        return len(self._pending)

    def flush(self, next_index: Optional[int] = None, range_complete: bool = False) -> int:
        """Post queued records in batches. With range_complete the last batch also carries
        the device's next index so the server can record the covered range.
        Raises ServerError; the queue is left intact so a retry sends the same records."""
        sent = 0
        while self._pending:
            batch = self._pending[:BATCH]
            last = len(self._pending) <= BATCH
            result = self.client.post_events(self.serial, batch,
                                             next_index if last else None,
                                             range_complete if last else False)
            del self._pending[:len(batch)]
            sent += len(result.get("acked") or batch)
        if sent == 0 and next_index is not None and range_complete:
            self.client.post_events(self.serial, [], next_index, True)
        return sent

    def discard(self) -> None:
        self._pending.clear()

    def post_snapshot(self, snapshot: dict) -> None:
        self.client.post_snapshot(self.serial, snapshot)
