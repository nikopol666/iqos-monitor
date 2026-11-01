"""HTTP client for the IQOS Monitor server."""
from __future__ import annotations

import json
import logging
import platform
from typing import Any, Optional

import requests

from iqos_agent import __version__

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

    def _request(self, method: str, path: str, payload: Any = None, params: Optional[dict] = None) -> dict:
        url = self.base_url + path
        try:
            response = self.session.request(method, url, params=params,
                                            data=json.dumps(payload) if payload is not None else None,
                                            timeout=self.timeout)
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

    def _post(self, path: str, payload: Any) -> dict:
        return self._request("POST", path, payload)

    def heartbeat(self, devices: list[dict]) -> dict:
        return self._post("/api/agent/heartbeat", {"devices": devices})

    def get_sync(self, serial: str, low: int, high: int, full: bool = False) -> dict:
        """Which archive IDs in [low, high] the server still lacks, plus its range state.
        full=True (full history download) also lists ids the user deleted, never blocked ones."""
        params = {"low": low, "high": high}
        if full:
            params["full"] = 1
        return self._request("GET", f"/api/agent/devices/{serial}/sync", params=params)

    def post_events(self, serial: str, events: list[dict], next_index: Optional[int] = None,
                    range_complete: bool = False) -> dict:
        payload: dict[str, Any] = {"events": events}
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
