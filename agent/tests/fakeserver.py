"""In-memory stand-in for the server API used by the sync tests."""
from __future__ import annotations

GOOD = ('ok', 'empty')


class FakeServer:
    def __init__(self):
        self.events: dict[str, dict[int, tuple[str, str | None]]] = {}
        self.acked: dict[str, int | None] = {}
        self.full_complete: dict[str, bool] = {}
        self.posts: list[tuple[str, int, int | None, bool]] = []
        self.fail = False  # raise ServerError on every call

    def _check(self):
        if self.fail:
            from iqos_agent.uploader import ServerError
            raise ServerError('fake outage')

    def status(self, serial, event_id):
        row = self.events.get(serial, {}).get(event_id)
        return row[0] if row else None

    def get_sync(self, serial, low, high):
        self._check()
        stored = {i for i, (st, _) in self.events.get(serial, {}).items() if st in GOOD}
        return {
            'ok': True,
            'acked_next_index': self.acked.get(serial),
            'lowest_stored_index': min(stored) if stored else None,
            'full_history_complete': self.full_complete.get(serial, False),
            'missing': [i for i in range(low, high + 1) if i not in stored],
        }

    def post_events(self, serial, events, next_index=None, range_complete=False):
        self._check()
        table = self.events.setdefault(serial, {})
        acked = []
        for e in events:
            current = table.get(e['event_id'])
            if current is None or current[0] not in GOOD:
                table[e['event_id']] = (e['status'], e.get('timestamp_candidate_utc'))
            acked.append(e['event_id'])
        self.posts.append((serial, len(events), next_index, bool(range_complete)))
        if range_complete and next_index:
            self.acked[serial] = max(self.acked.get(serial) or 0, next_index)
        return {'ok': True, 'acked': acked}

    def post_snapshot(self, serial, snapshot):
        self._check()
        return {'ok': True}
