"""Self-update from GitHub releases (Windows, PyInstaller build only).

Once a day (and shortly after start) the agent asks the GitHub API for the
latest release. When its tag is newer than the running version it downloads
`IQOS-Agent.exe`, checks the size and the SHA-256 digest GitHub reports,
stages it next to the running executable and hands over to a small batch
script that waits for this process to exit, swaps the files and starts the
new build. Running from source (not frozen) never updates.
"""
from __future__ import annotations

import hashlib
import logging
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Callable, Optional

import requests

from iqos_agent import __version__

log = logging.getLogger(__name__)

REPO = "nikopol666/iqos-monitor"
API_LATEST = f"https://api.github.com/repos/{REPO}/releases/latest"
ASSET_NAME = "IQOS-Agent.exe"
CHECK_INTERVAL = 24 * 3600
FIRST_CHECK_DELAY = 90.0


def parse_version(text: str) -> tuple[int, ...]:
    """'v0.1.7', '0.1.7-3-gabc' and '0.1.7' all become (0, 1, 7); unparsable -> ()."""
    m = re.match(r"v?(\d+(?:\.\d+)*)", (text or "").strip())
    return tuple(int(p) for p in m.group(1).split(".")) if m else ()


def is_newer(candidate: str, current: str) -> bool:
    c, n = parse_version(candidate), parse_version(current)
    return bool(c) and bool(n) and c > n


def current_exe() -> Optional[Path]:
    """The running PyInstaller executable, or None when running from source."""
    if getattr(sys, "frozen", False) and sys.platform == "win32":
        return Path(sys.executable)
    return None


def fetch_latest(timeout: float = 15.0) -> Optional[dict]:
    """{tag, url, size, sha256} of the latest release's agent asset, or None."""
    r = requests.get(API_LATEST, headers={"Accept": "application/vnd.github+json", "User-Agent": "iqos-agent"}, timeout=timeout)
    if r.status_code == 404:
        return None
    r.raise_for_status()
    data = r.json()
    for asset in data.get("assets") or []:
        if asset.get("name") == ASSET_NAME:
            digest = str(asset.get("digest") or "")
            return {
                "tag": str(data.get("tag_name") or ""),
                "url": asset.get("browser_download_url"),
                "size": int(asset.get("size") or 0),
                "sha256": digest.split(":", 1)[1].lower() if digest.startswith("sha256:") else None,
            }
    return None


def download(url: str, dest: Path, size: int, sha256: Optional[str], timeout: float = 60.0) -> None:
    """Stream the asset to dest and verify what GitHub told us about it."""
    h = hashlib.sha256()
    total = 0
    with requests.get(url, stream=True, timeout=timeout, headers={"User-Agent": "iqos-agent"}) as r:
        r.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in r.iter_content(1 << 16):
                if chunk:
                    f.write(chunk)
                    h.update(chunk)
                    total += len(chunk)
    if size and total != size:
        raise RuntimeError(f"download size {total} != {size}")
    if sha256 and h.hexdigest() != sha256:
        raise RuntimeError("download digest mismatch")
    if total < 1_000_000:
        raise RuntimeError("download too small to be the agent")


def stage_and_restart(new_file: Path, exe: Path) -> None:
    """Hand over to a batch script that swaps the executable once we have exited."""
    old = exe.with_suffix(".old.exe")
    script = Path(tempfile.gettempdir()) / "iqos-agent-update.cmd"
    script.write_text(
        "@echo off\r\n"
        f"set PID={os.getpid()}\r\n"
        ":wait\r\n"
        'tasklist /FI "PID eq %PID%" 2>nul | find "%PID%" >nul && (timeout /t 1 /nobreak >nul & goto wait)\r\n'
        f'if exist "{old}" del /f /q "{old}"\r\n'
        f'move /y "{exe}" "{old}" >nul\r\n'
        f'move /y "{new_file}" "{exe}" >nul\r\n'
        f'start "" "{exe}"\r\n'
        'del "%~f0"\r\n',
        encoding="ascii",
    )
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) | getattr(subprocess, "DETACHED_PROCESS", 0)
    subprocess.Popen(["cmd.exe", "/c", str(script)], creationflags=flags, close_fds=True, cwd=str(exe.parent))


def cleanup_after_update() -> None:
    """Remove the previous build left behind by a successful swap."""
    exe = current_exe()
    if not exe:
        return
    old = exe.with_suffix(".old.exe")
    try:
        if old.exists():
            old.unlink()
            log.info("removed previous build %s", old.name)
    except OSError:
        pass


def check_and_apply(force: bool = False) -> str:
    """Returns 'source' (not an exe), 'up_to_date', 'staged' (restart under way) or 'error: …'."""
    exe = current_exe()
    if not exe:
        return "source"
    try:
        latest = fetch_latest()
        if not latest or not latest.get("url"):
            return "error: no release with the agent found"
        if not is_newer(latest["tag"], __version__) and not force:
            return "up_to_date"
        if not is_newer(latest["tag"], __version__):
            return "up_to_date"
        log.info("update %s -> %s", __version__, latest["tag"])
        staged = exe.with_suffix(".update.exe")
        download(latest["url"], staged, latest["size"], latest["sha256"])
        stage_and_restart(staged, exe)
        return "staged"
    except Exception as exc:  # network, disk, GitHub: all non-fatal
        log.warning("update check failed: %s", exc)
        return f"error: {exc}"


class UpdateScheduler(threading.Thread):
    """Checks shortly after start and then once a day while auto-update is on."""

    def __init__(self, enabled: Callable[[], bool], on_staged: Callable[[], None]):
        super().__init__(name="updater", daemon=True)
        self.enabled = enabled
        self.on_staged = on_staged
        self.wake = threading.Event()
        self._stop = threading.Event()

    def check_now(self) -> None:
        self.wake.set()

    def stop(self) -> None:
        self._stop.set()
        self.wake.set()

    def run(self) -> None:
        if not current_exe():
            return
        self.wake.wait(FIRST_CHECK_DELAY)
        while not self._stop.is_set():
            forced = self.wake.is_set()
            self.wake.clear()
            if forced or self.enabled():
                if check_and_apply() == "staged":
                    self.on_staged()
                    return
            self.wake.wait(CHECK_INTERVAL)
