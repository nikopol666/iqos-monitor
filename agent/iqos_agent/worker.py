"""Device discovery, per-device worker threads and server synchronisation.

One thread per connected IQOS owns the HID handle; everything on that handle
(archive reads, live ticks, diagnostics) is sequential. A manager thread
enumerates USB every 2 s, keeps a heartbeat with the server, and hands jobs
(e.g. full history download) to the device worker.

The agent keeps no database: the server says which archive IDs it lacks, the
worker reads those from the device and posts them. When the server is
unreachable nothing is stored; the next attempt simply reads again.
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Callable, Optional

from iqos_agent.archive import ServerArchive
from iqos_agent.config import Config
from iqos_agent.core import IQOSDevice, connected_devices, device_name
from iqos_agent.device_info import read_snapshot
from iqos_agent.full import sync_full
from iqos_agent.live import read_live
from iqos_agent.recent import sync_recent
from iqos_agent.settings import SettingError, apply_setting
from iqos_agent.uploader import ServerClient, ServerError

log = logging.getLogger(__name__)

ENUMERATE_INTERVAL = 2.0
HEARTBEAT_INTERVAL = 5.0
ARCHIVE_POLL_INTERVAL = 5.0  # while connected: look for new archive records this often
FLUSH_INTERVAL = 5.0         # post queued archive reads at least this often during a sync
SERVER_RETRY_DELAY = 30.0    # after the server failed mid-sync, wait this long before reading again
MAX_LIVE_FAILURES = 5


@dataclass
class DeviceStatus:
    serial: str
    name: str
    connected: bool = False
    battery: Optional[int] = None
    stick_state: Optional[str] = None
    syncing: bool = False
    sync_done: int = 0
    sync_total: Optional[int] = None
    sync_label: str = ""
    pending_upload: int = 0
    last_error: Optional[str] = None


@dataclass
class AgentStatus:
    """Shared, lock-protected snapshot for the tray icon."""
    configured: bool = False
    server_ok: Optional[bool] = None
    server_error: Optional[str] = None
    devices: dict[str, DeviceStatus] = field(default_factory=dict)
    lock: threading.Lock = field(default_factory=threading.Lock, repr=False)
    on_change: Optional[Callable[[], None]] = None

    def update(self, fn: Callable[["AgentStatus"], None]) -> None:
        with self.lock:
            fn(self)
        if self.on_change:
            try:
                self.on_change()
            except Exception:  # tray errors must not kill the worker
                log.exception("status callback failed")

    def snapshot(self) -> "AgentStatus":
        with self.lock:
            copy = AgentStatus(configured=self.configured, server_ok=self.server_ok, server_error=self.server_error)
            copy.devices = {k: DeviceStatus(**vars(v)) for k, v in self.devices.items()}
            return copy


def utc_now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


class DeviceWorker(threading.Thread):
    def __init__(self, info: dict, cfg: Config, client: Optional[ServerClient], status: AgentStatus,
                 stop_event: threading.Event):
        super().__init__(name=f"device-{info.get('serial_number')}", daemon=True)
        self.info = info
        self.serial = info["serial_number"]
        self.cfg = cfg
        self.status = status
        self.stop_event = stop_event          # set by the manager when the USB device disappears or app quits
        self.jobs: list[dict] = []
        self.jobs_lock = threading.Lock()
        self.cancelled_jobs: set[int] = set()
        self.seen_jobs: set[int] = set()  # ids already started by this worker
        self._last_live = 0.0
        self._last_flush = 0.0
        self._live_failures = 0
        self._next_index: Optional[int] = None
        self._last_archive_poll = 0.0
        self._server_retry_at = 0.0
        self._model: Optional[str] = None
        self.client: Optional[ServerClient] = None
        self.archive: Optional[ServerArchive] = None
        self.set_client(client)

    def set_client(self, client: Optional[ServerClient]) -> None:
        self.client = client
        self.archive = ServerArchive(client, self.serial) if client else None

    # -- jobs handed over by the manager ------------------------------------------------
    def offer_jobs(self, jobs: list[dict]) -> None:
        with self.jobs_lock:
            known = {j["id"] for j in self.jobs}
            for job in jobs:
                if job["status"] == "cancelled":
                    self.cancelled_jobs.add(job["id"])
                elif job["id"] not in known and job["id"] not in self.seen_jobs and job["type"] in ("full_history", "set_setting"):
                    self.jobs.append(job)

    def _pop_job(self) -> Optional[dict]:
        with self.jobs_lock:
            job = self.jobs.pop(0) if self.jobs else None
            if job is not None:
                self.seen_jobs.add(job["id"])
            return job

    # -- status helpers -----------------------------------------------------------------
    def _set(self, **fields) -> None:
        def apply(st: AgentStatus):
            ds = st.devices.setdefault(self.serial, DeviceStatus(self.serial, device_name(self.serial)))
            for k, v in fields.items():
                setattr(ds, k, v)
        self.status.update(apply)

    def _server_ok(self) -> None:
        self.status.update(lambda s: (setattr(s, "server_ok", True), setattr(s, "server_error", None)))

    def _server_failed(self, exc: Exception) -> None:
        self._server_retry_at = time.monotonic() + SERVER_RETRY_DELAY
        self.status.update(lambda s: (setattr(s, "server_ok", False), setattr(s, "server_error", str(exc))))

    # -- main loop ----------------------------------------------------------------------
    def run(self) -> None:
        dev = None
        try:
            dev = IQOSDevice(self.info)
            self._set(connected=True, last_error=None)
            log.info("%s connected", self.serial)
            self._snapshot(dev)
            self._live_tick(dev, force=True)
            self._sync_recent(dev)
            # Then stay live and serve jobs until unplugged.
            while not self.stop_event.is_set():
                job = self._pop_job()
                if job is not None:
                    if job["type"] == "set_setting":
                        self._run_set_setting(dev, job)
                    else:
                        self._run_full_history(dev, job)
                    continue
                self._live_tick(dev)
                self._poll_archive(dev)
                time.sleep(0.05)
        except Exception as exc:
            log.warning("%s worker stopped: %s", self.serial, exc)
            self._set(last_error=str(exc))
        finally:
            if dev is not None:
                try:
                    dev.close()
                except Exception:
                    pass
            self._set(connected=False, syncing=False, sync_total=None, pending_upload=0)
            if self.client:
                try:
                    self.client.post_live(self.serial, {"connected": False})
                except ServerError:
                    pass
            log.info("%s disconnected", self.serial)

    def _snapshot(self, dev) -> None:
        try:
            snap = read_snapshot(dev)
        except Exception as exc:
            log.warning("snapshot failed: %s", exc)
            return
        self._model = snap["values"].get("model")
        self._set(battery=snap["values"].get("battery_percent"))
        if self.archive:
            try:
                self.archive.post_snapshot(snap)
                self._server_ok()
            except ServerError as exc:
                log.warning("snapshot upload failed: %s", exc)
                self._server_failed(exc)

    def _sync_recent(self, dev) -> None:
        """Regular sync: last N months on first contact, afterwards only what the server lacks."""
        if not self.archive:
            log.info("%s: no server configured, archive is not synchronised", self.serial)
            return
        self._next_index = dev.next_index()
        self._set(syncing=True, sync_label="recent", sync_done=0, sync_total=None)
        try:
            sync_recent(self.archive, self.info, delay=self.cfg.read_delay, months=self.cfg.recent_months,
                        on_step=lambda idx, done, total: self._between_reads(dev, idx, done, total), dev=dev)
            self._server_ok()
        except ServerError as exc:
            log.warning("%s archive sync stopped, server unreachable: %s", self.serial, exc)
            self.archive.discard()
            self._next_index = None  # retry on the next poll once the server answers again
            self._server_failed(exc)
        finally:
            self._set(syncing=False, sync_total=None, sync_done=0, pending_upload=0)

    def _between_reads(self, dev, idx: int, done: int, total: Optional[int]) -> None:
        """Called by the sync loops after every archive index."""
        if self.stop_event.is_set():
            raise RuntimeError("device removed")
        self._set(sync_done=done, sync_total=total, pending_upload=self.archive.pending() if self.archive else 0)
        self._live_tick(dev)
        if self.archive and self.archive.pending() and time.monotonic() - self._last_flush >= FLUSH_INTERVAL:
            self._last_flush = time.monotonic()
            self.archive.flush()  # ServerError propagates and aborts the sync

    def _poll_archive(self, dev) -> None:
        """New archive records while the device stays plugged in (a stick smoked on
        the cable, a button press): fetch them right away instead of at the next connect."""
        now = time.monotonic()
        if now - self._last_archive_poll < ARCHIVE_POLL_INTERVAL or now < self._server_retry_at:
            return
        self._last_archive_poll = now
        if not self.archive:
            return
        try:
            nxt = dev.next_index()
        except Exception as exc:
            log.debug("%s archive poll failed: %s", self.serial, exc)
            return
        if self._next_index is not None and nxt <= self._next_index:
            return
        if self._next_index is not None:
            log.info("%s new archive records: next index %s -> %s", self.serial, self._next_index, nxt)
        self._sync_recent(dev)

    def _live_tick(self, dev, force: bool = False) -> None:
        now = time.monotonic()
        if not force and now - self._last_live < self.cfg.live_interval:
            return
        self._last_live = now
        try:
            live = read_live(dev)
        except Exception as exc:
            self._live_failures += 1
            if self._live_failures >= MAX_LIVE_FAILURES:
                raise RuntimeError(f"live read failing: {exc}")
            return
        if live["battery"] is None and live["lifetime_sticks"] is None:
            self._live_failures += 1
            if self._live_failures >= MAX_LIVE_FAILURES:
                raise RuntimeError("device not answering")
            return
        self._live_failures = 0
        self._set(battery=live["battery"], stick_state=live["stick_state"])
        if self.client:
            payload = {k: v for k, v in live.items() if k not in ("statuses", "read_at_utc")}
            payload["connected"] = True
            st = self.status.snapshot().devices.get(self.serial)
            if st and st.syncing:
                payload["sync_status"] = f"{st.sync_label} {st.sync_done}" + (f"/{st.sync_total}" if st.sync_total else "")
            try:
                self.client.post_live(self.serial, payload)
                self.status.update(lambda s: setattr(s, "server_ok", True))
            except ServerError as exc:
                self.status.update(lambda s: (setattr(s, "server_ok", False), setattr(s, "server_error", str(exc))))

    def _run_set_setting(self, dev, job: dict) -> None:
        job_id = job["id"]
        payload = job.get("payload") or {}
        setting = str(payload.get("setting", ""))
        value = str(payload.get("value", ""))
        log.info("%s set %s=%s (job %s)", self.serial, setting, value, job_id)
        if self.client:
            try:
                self.client.post_job(job_id, status="running")
            except ServerError:
                pass
        if job_id in self.cancelled_jobs:
            return
        try:
            result = apply_setting(dev, self._model, setting, value)
            final, message = "done", json.dumps({"setting": setting, "value": result if result is not None else value})
            log.info("%s %s now %s", self.serial, setting, result)
        except SettingError as exc:
            final, message = "failed", str(exc)
            log.warning("%s set %s failed: %s", self.serial, setting, exc)
        except Exception as exc:
            final, message = "failed", f"{type(exc).__name__}: {exc}"
            log.warning("%s set %s crashed: %s", self.serial, setting, exc)
        # Fresh diagnostics so the web shows the new state.
        self._snapshot(dev)
        if self.client:
            try:
                self.client.post_job(job_id, status=final, message=message)
            except ServerError:
                pass

    def _run_full_history(self, dev, job: dict) -> None:
        job_id = job["id"]
        log.info("%s full history job %s", self.serial, job_id)
        if not self.archive:
            return
        self._set(syncing=True, sync_label="full", sync_done=0, sync_total=None)
        try:
            self.client.post_job(job_id, status="running", progress_done=0)
        except ServerError:
            pass
        last_report = [0.0]

        def on_step(idx, done, total):
            self._between_reads(dev, idx, done, total)
            if time.monotonic() - last_report[0] > 2.0:
                last_report[0] = time.monotonic()
                try:
                    reply = self.client.post_job(job_id, status="running", progress_done=done, progress_total=total)
                    if (reply.get("job") or {}).get("status") == "cancelled":
                        self.cancelled_jobs.add(job_id)
                except ServerError:
                    pass

        def should_stop():
            return job_id in self.cancelled_jobs or self.stop_event.is_set()

        try:
            self._next_index = dev.next_index()
            ok = sync_full(self.archive, self.info, delay=self.cfg.read_delay, on_step=on_step,
                           dev=dev, should_stop=should_stop)
            self._server_ok()
            if self.stop_event.is_set():
                final, message = "queued", "device disconnected; resumes on reconnect"
            elif job_id in self.cancelled_jobs:
                final, message = "cancelled", None
            elif ok:
                final, message = "done", None
            else:
                final, message = "failed", "incomplete; reconnect to resume"
        except ServerError as exc:
            self.archive.discard()
            final, message = "queued", f"server unreachable: {exc}"
            log.warning("full history paused, server unreachable: %s", exc)
            self._server_failed(exc)
        except Exception as exc:
            if self.stop_event.is_set() or isinstance(exc, OSError) or "read error" in str(exc).lower():
                # USB dropped mid-download: keep the job queued, the next connection resumes it.
                final, message = "queued", "device disconnected; resumes on reconnect"
                log.warning("full history interrupted (%s); job %s stays queued", exc, job_id)
                self.stop_event.set()
            else:
                final, message = "failed", str(exc)
                log.warning("full history failed: %s", exc)
            self.archive.discard()
        finally:
            self._set(syncing=False, sync_total=None, sync_done=0, pending_upload=0)
        try:
            st = self.status.snapshot().devices.get(self.serial)
            self.client.post_job(job_id, status=final, message=message,
                                 progress_done=st.sync_done if st else 0)
        except ServerError:
            pass


class AgentManager(threading.Thread):
    """Enumerates devices, runs workers, keeps the heartbeat."""

    def __init__(self, cfg: Config, status: AgentStatus):
        super().__init__(name="agent-manager", daemon=True)
        self.cfg = cfg
        self.status = status
        self.client: Optional[ServerClient] = None
        self.workers: dict[str, tuple[DeviceWorker, threading.Event]] = {}
        self.quit_event = threading.Event()
        self._last_heartbeat = 0.0
        self.apply_config(cfg)

    def apply_config(self, cfg: Config) -> None:
        self.cfg = cfg
        if cfg.configured:
            self.client = ServerClient(cfg.normalized_url(), cfg.api_key, cfg.agent_name)
        else:
            self.client = None
        self.status.update(lambda s: setattr(s, "configured", cfg.configured))
        for worker, _ in self.workers.values():
            worker.set_client(self.client)
            worker.cfg = cfg

    def stop(self) -> None:
        self.quit_event.set()
        for _, ev in self.workers.values():
            ev.set()

    def run(self) -> None:
        while not self.quit_event.is_set():
            try:
                self._tick()
            except Exception:
                log.exception("manager tick failed")
            self.quit_event.wait(ENUMERATE_INTERVAL)

    def _tick(self) -> None:
        try:
            present = {d["serial_number"]: d for d in connected_devices()}
        except Exception as exc:
            log.warning("USB enumeration failed: %s", exc)
            present = {}
        # Stop workers whose device vanished; start workers for new devices.
        for serial, (worker, ev) in list(self.workers.items()):
            if serial not in present or not worker.is_alive():
                ev.set()
                if not worker.is_alive():
                    del self.workers[serial]
                    self.status.update(lambda s, serial=serial: s.devices.pop(serial, None))
        for serial, info in present.items():
            if serial not in self.workers:
                ev = threading.Event()
                worker = DeviceWorker(info, self.cfg, self.client, self.status, ev)
                self.workers[serial] = (worker, ev)
                worker.start()
        if self.client and time.monotonic() - self._last_heartbeat >= HEARTBEAT_INTERVAL:
            self._heartbeat(present)

    def _heartbeat(self, present: dict) -> None:
        self._last_heartbeat = time.monotonic()
        devices = [{"serial": s, "connected": True} for s in present]
        try:
            reply = self.client.heartbeat(devices)
        except ServerError as exc:
            self.status.update(lambda s: (setattr(s, "server_ok", False), setattr(s, "server_error", str(exc))))
            return
        self.status.update(lambda s: (setattr(s, "server_ok", True), setattr(s, "server_error", None)))
        by_serial: dict[str, list[dict]] = {}
        for job in reply.get("jobs", []):
            by_serial.setdefault(job["serial"], []).append(job)
        for serial, jobs in by_serial.items():
            entry = self.workers.get(serial)
            if entry:
                entry[0].offer_jobs(jobs)
        # Names assigned in the web settings show up in the tray.
        for serial, data in (reply.get("devices") or {}).items():
            name = data.get("name")
            if name:
                def apply(st: AgentStatus, serial=serial, name=name):
                    if serial in st.devices:
                        st.devices[serial].name = name
                self.status.update(apply)
