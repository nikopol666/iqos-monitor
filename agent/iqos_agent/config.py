"""Agent configuration stored in %APPDATA%\\IQOS Agent\\config.json."""
from __future__ import annotations

import json
import os
import socket
from dataclasses import asdict, dataclass, field
from pathlib import Path

APP_NAME = "IQOS Agent"


def config_dir() -> Path:
    base = os.environ.get("APPDATA") or str(Path.home())
    path = Path(base) / APP_NAME
    path.mkdir(parents=True, exist_ok=True)
    return path


@dataclass
class Config:
    server_url: str = ""
    api_key: str = ""
    agent_name: str = field(default_factory=lambda: socket.gethostname() or "agent")
    language: str = "auto"          # auto | en | cs
    live_interval: float = 1.0      # seconds between live reads while connected
    recent_months: int = 3          # first sync window for a new device
    read_delay: float = 0.10        # minimum pause between archive reads

    @property
    def configured(self) -> bool:
        return bool(self.server_url.strip())

    def normalized_url(self) -> str:
        url = self.server_url.strip().rstrip("/")
        if url and not url.startswith(("http://", "https://")):
            url = "http://" + url
        return url


CONFIG_PATH = config_dir() / "config.json"


def load_config(path: Path = CONFIG_PATH) -> Config:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return Config()
    cfg = Config()
    for key, value in data.items():
        if hasattr(cfg, key) and not key.startswith("_"):
            setattr(cfg, key, value)
    return cfg


def save_config(cfg: Config, path: Path = CONFIG_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(asdict(cfg), ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)
