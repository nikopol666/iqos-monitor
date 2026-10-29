"""Device discovery, per-device worker threads and server synchronisation.

One thread per connected IQOS owns the HID handle; everything on that handle
(archive reads, live ticks, diagnostics) is sequential. A manager thread
enumerates USB every 2 s, keeps a heartbeat with the server, and hands jobs
(e.g. full history download) to the device worker.
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import threading
import time
from dataclasses import dataclass, field
from typing import Callable, Optional

from iqos_agent.config import Config
from iqos_agent.core import IQOSDevice, connected_devices, device_name
from iqos_agent.device_info import read_snapshot
from iqos_agent.full import sync_full
from iqos_agent.live import read_live
from iqos_agent.recent import sync_recent
from iqos_agent.settings import SettingError, apply_setting
from iqos_agent.storage import (connect, import_observations, pending_upload_count,
                                save_device, save_snapshot)
from iqos_agent.uploader import ServerClient, ServerError, flush_pending, flush_snapshot

log = logging.getLogger(__name__)

ENUMERATE_INTERVAL = 2.0
HEARTBEAT_INTERVAL = 5.0
UPLOAD_INTERVAL = 5.0
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
        self.client = client
        self.status = status
        self.stop_event = stop_event          # set by the manager when the USB device disappears or app quits
        self.jobs: list[dict] = []
        self.jobs_lock = threading.Lock()
        self.cancelled_jobs: set[int] = set()
        self.seen_jobs: set[int] = set()  # ids already started by this worker
        self._last_live = 0.0
        self._last_upload = 0.0
        self._live_failures = 0
        self._next_index: Optional[int] = None
        self._model: Optional[str] = None

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

    # -- main loop ----------------------------------------------------------------------
    def run(self) -> None:
        db = connect(self.cfg.db_path)
        dev = None
        try:
            dev = IQOSDevice(self.info)
            save_device(db, self.serial)
            self._set(connected=True, last_error=None)
            log.info("%s connected", self.serial)
            self._snapshot(db, dev)
            self._live_tick(dev, force=True)
            # Regular sync: last N months (first time) or incremental since then.
            self._next_index = dev.next_index()
            self._set(syncing=True, sync_label="recent")
            ok = sync_recent(db, self.info, delay=self.cfg.read_delay, months=self.cfg.recent_months,
                             on_step=lambda idx, done, total: self._between_reads(db, dev, idx, done, total),
                             skip_snapshot=True, dev=dev)
            self._set(syncing=False, sync_total=None, sync_done=0)
            self._upload(db, range_complete=ok)
            # Then stay live and serve jobs until unplugged.
            while not self.stop_event.is_set():
                job = self._pop_job()
                if job is not None:
                    if job["type"] == "set_setting":
                        self._run_set_setting(db, dev, job)
                    else:
                        self._run_full_history(db, dev, job)
                    continue
                self._live_tick(dev)
                self._maybe_upload(db)
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
            self._set(connected=False, syncing=False, sync_total=None)
            if self.client:
                try:
                    self.client.post_live(self.serial, {"connected": False})
                except ServerError:
                    pass
            db.close()
            log.info("%s disconnected", self.serial)

    def _snapshot(self, db, dev) -> None:
        try:
            snap = read_snapshot(dev)
            save_snapshot(db, self.serial, snap)
            self._model = snap["values"].get("model")
            self._set(battery=snap["values"].get("battery_percent"))
            if self.client:
                flush_snapshot(self.client, db, self.serial)
        except ServerError as exc:
            log.warning("snapshot upload failed: %s", exc)
        except Exception as exc:
            log.warning("snapshot failed: %s", exc)

    def _between_reads(self, db, dev, idx: int, done: int, total: Optional[int]) -> None:
        """Called by the sync loops after every archive index."""
        if self.stop_event.is_set():
            raise RuntimeError("device removed")
        self._set(sync_done=done, sync_total=total)
        self._live_tick(dev)
        self._maybe_upload(db)

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

    def _maybe_upload(self, db) -> None:
        if time.monotonic() - self._last_upload >= UPLOAD_INTERVAL:
            self._upload(db)

    def _upload(self, db, range_complete: bool = False) -> None:
        self._last_upload = time.monotonic()
        if not self.client:
            return
        try:
            n = flush_pending(self.client, db, self.serial,
                              next_index=self._next_index if range_complete else None,
                              range_complete=range_complete)
            if n:
                log.info("%s uploaded %d events", self.serial, n)
            self._set(pending_upload=pending_upload_count(db, self.serial))
            self.status.update(lambda s: setattr(s, "server_ok", True))
        except ServerError as exc:
            log.warning("upload failed: %s", exc)
            self.status.update(lambda s: (setattr(s, "server_ok", False), setattr(s, "server_error", str(exc))))

    def _run_set_setting(self, db, dev, job: dict) -> None:
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
        self._snapshot(db, dev)
        if self.client:
            try:
                self.client.post_job(job_id, status=final, message=message)
            except ServerError:
                pass

    def _run_full_history(self, db, dev, job: dict) -> None:
        job_id = job["id"]
        log.info("%s full history job %s", self.serial, job_id)
        self._set(syncing=True, sync_label="full", sync_done=0, sync_total=None)
        if self.client:
            try:
                self.client.post_job(job_id, status="running", progress_done=0)
            except ServerError:
                pass
        last_report = [0.0]

        def on_step(idx, done, total):
            self._between_reads(db, dev, idx, done, total)
            if self.client and time.monotonic() - last_report[0] > 2.0:
                last_report[0] = time.monotonic()
                try:
                    self.client.post_job(job_id, status="running", progress_done=done, progress_total=total)
                except ServerError:
                    pass

        def should_stop():
            return job_id in self.cancelled_jobs or self.stop_event.is_set()

        try:
            self._next_index = dev.next_index()
            ok = sync_full(db, self.info, delay=self.cfg.read_delay, on_step=on_step,
                           skip_snapshot=True, dev=dev, should_stop=should_stop)
            self._upload(db, range_complete=ok)
            final = "cancelled" if job_id in self.cancelled_jobs else ("done" if ok else "failed")
            message = None if ok else "incomplete; reconnect to resume"
        except Exception as exc:
            ok = False
            if self.stop_event.is_set() or isinstance(exc, OSError) or "read error" in str(exc).lower():
                # USB dropped mid-download: keep the job queued, the next connection resumes it.
                final = "queued"
                message = "device disconnected; resumes on reconnect"
                log.warning("full history interrupted (%s); job %s stays queued", exc, job_id)
                self.stop_event.set()
            else:
                final = "failed"
                message = str(exc)
                log.warning("full history failed: %s", exc)
        finally:
            self._set(syncing=False, sync_total=None, sync_done=0)
        if self.client:
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
        self._initial_flush_done = False
        self.apply_config(cfg)

    def apply_config(self, cfg: Config) -> None:
        self.cfg = cfg
        if cfg.configured:
            self.client = ServerClient(cfg.normalized_url(), cfg.api_key, cfg.agent_name)
        else:
            self.client = None
        self._initial_flush_done = False
        self.status.update(lambda s: setattr(s, "configured", cfg.configured))
        for worker, _ in self.workers.values():
            worker.client = self.client
            worker.cfg = cfg

    def stop(self) -> None:
        self.quit_event.set()
        for _, ev in self.workers.values():
            ev.set()

    def run(self) -> None:
        db = connect(self.cfg.db_path)
        try:
            from pathlib import Path
            import_observations(db, Path(__file__).with_name("known_observations.json"))
        except Exception:
            pass
        while not self.quit_event.is_set():
            try:
                self._tick(db)
            except Exception:
                log.exception("manager tick failed")
            self.quit_event.wait(ENUMERATE_INTERVAL)
        db.close()

    def _tick(self, db) -> None:
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
        if self.client and not self._initial_flush_done:
            self._flush_offline(db)
        if self.client and time.monotonic() - self._last_heartbeat >= HEARTBEAT_INTERVAL:
            self._heartbeat(present)

    def _flush_offline(self, db) -> None:
        """Push archives stored locally for devices that are not plugged in."""
        self._initial_flush_done = True
        serials = [row[0] for row in db.execute("SELECT serial FROM devices")]
        for serial in serials:
            if serial in self.workers:
                continue
            try:
                if flush_snapshot(self.client, db, serial):
                    log.info("%s: uploaded stored diagnostics snapshot", serial)
                n = flush_pending(self.client, db, serial)
                if n:
                    log.info("%s: uploaded %d stored events (offline device)", serial, n)
            except ServerError as exc:
                log.warning("offline upload failed: %s", exc)
                self._initial_flush_done = False
                self.status.update(lambda s: (setattr(s, "server_ok", False), setattr(s, "server_error", str(exc))))
                return
        self.status.update(lambda s: setattr(s, "server_ok", True))

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
