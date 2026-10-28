"""HTTP client for the IQOS Monitor server plus local upload bookkeeping."""
from __future__ import annotations

import json
import logging
import platform
from typing import Any, Optional

import requests

from iqos_agent import __version__
from iqos_agent.storage import (latest_pending_snapshot, mark_snapshots_uploaded,
                                mark_uploaded, pending_upload)

log = logging.getLogger(__name__)


class ServerError(Exception):
    pass


class ServerClient:
    def __init__(self, base_url: str, api_key: str, agent_name: str, timeout: float = 8.0):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update({
            "X-Api-Key": api_key,
            "X-Agent-Name": agent_name,
            "X-Agent-Host": platform.node(),
            "X-Agent-Version": __version__,
            "Content-Type": "application/json",
        })
        self.last_error: Optional[str] = None

    def _post(self, path: str, payload: Any) -> dict:
        url = self.base_url + path
        try:
            response = self.session.post(url, data=json.dumps(payload), timeout=self.timeout)
        except requests.RequestException as exc:
            self.last_error = str(exc)
            raise ServerError(str(exc)) from exc
        if response.status_code == 401:
            self.last_error = "unauthorized (API key)"
            raise ServerError(self.last_error)
        if response.status_code >= 400:
            self.last_error = f"HTTP {response.status_code}: {response.text[:200]}"
            raise ServerError(self.last_error)
        self.last_error = None
        try:
            return response.json()
        except ValueError as exc:
            raise ServerError("invalid JSON from server") from exc

    def heartbeat(self, devices: list[dict]) -> dict:
        return self._post("/api/agent/heartbeat", {"devices": devices})

    def post_events(self, serial: str, events: list[dict], next_index: Optional[int] = None,
                    range_complete: bool = False) -> dict:
        payload = {"events": events}
        if next_index is not None:
            payload["next_index"] = next_index
            payload["range_complete"] = bool(range_complete)
        return self._post(f"/api/agent/devices/{serial}/events", payload)

    def post_snapshot(self, serial: str, snapshot: dict) -> dict:
        return self._post(f"/api/agent/devices/{serial}/snapshot", snapshot)

    def post_live(self, serial: str, live: dict) -> dict:
        return self._post(f"/api/agent/devices/{serial}/live", live)

    def post_job(self, job_id: int, **patch) -> dict:
        return self._post(f"/api/agent/jobs/{job_id}", patch)


def flush_pending(client: ServerClient, db, serial: str, batch: int = 200,
                  next_index: Optional[int] = None, range_complete: bool = False) -> int:
    """Upload every local event the server has not acknowledged. Returns count."""
    total = 0
    while True:
        rows = pending_upload(db, serial, batch)
        if not rows:
            break
        events = [{
            "event_id": row[0],
            "status": row[1],
            "timestamp_candidate_utc": row[2],
            "response_hex": row[3],
            "raw_packets_json": row[4],
            "fetched_at_utc": row[5],
        } for row in rows]
        last = len(rows) < batch
        result = client.post_events(serial, events, next_index if last else None, range_complete if last else False)
        acked = result.get("acked") or []
        mark_uploaded(db, serial, acked)
        total += len(acked)
        if not acked:
            # Server rejected everything; avoid a hot loop.
            log.warning("server acknowledged no events for %s", serial)
            break
        if last:
            break
    if total == 0 and next_index is not None and range_complete:
        # Nothing pending but the range state still needs to reach the server.
        client.post_events(serial, [], next_index, True)
    return total


def flush_snapshot(client: ServerClient, db, serial: str) -> bool:
    """Send the newest local diagnostics snapshot the server has not seen."""
    row = latest_pending_snapshot(db, serial)
    if row is None:
        return False
    snapshot = json.loads(row[1])
    client.post_snapshot(serial, snapshot)
    mark_snapshots_uploaded(db, serial, row[0])
    return True
