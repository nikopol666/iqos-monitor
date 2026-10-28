"""Entry point: `py -m iqos_agent` (tray) or `py -m iqos_agent --console` (debug)."""
from __future__ import annotations

import argparse
import logging
import logging.handlers
import sys
import time

from iqos_agent.config import config_dir, load_config


class _LogWriter:
    """Routes print() output of the legacy sync modules into the log file."""

    def __init__(self, level=logging.INFO):
        self.level = level
        self.buffer = ""

    def write(self, text):
        self.buffer += text
        while "\n" in self.buffer:
            line, self.buffer = self.buffer.split("\n", 1)
            if line.strip():
                logging.getLogger("sync").log(self.level, line.rstrip())

    def flush(self):
        pass


def setup_logging(console: bool) -> None:
    handlers: list[logging.Handler] = [
        logging.handlers.RotatingFileHandler(config_dir() / "agent.log", maxBytes=2_000_000, backupCount=3, encoding="utf-8")
    ]
    if console and sys.stdout is not None:
        handlers.append(logging.StreamHandler(sys.stdout))
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s", handlers=handlers)
    if not console or sys.stdout is None:
        sys.stdout = _LogWriter()
        sys.stderr = _LogWriter(logging.ERROR)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="iqos_agent", description="IQOS Monitor agent")
    parser.add_argument("--console", action="store_true", help="run without tray icon, log to stdout")
    parser.add_argument("--settings", action="store_true", help="open the settings window only")
    args = parser.parse_args(argv)
    setup_logging(console=args.console)
    cfg = load_config()
    logging.getLogger(__name__).info("IQOS Agent starting; config %s", config_dir() / "config.json")
    if args.settings:
        import tkinter as tk
        from iqos_agent.i18n import Translator
        from iqos_agent.settings_ui import open_settings
        root = tk.Tk()
        root.withdraw()
        win = open_settings(root, cfg, Translator(cfg.language), lambda c: None)
        win.protocol("WM_DELETE_WINDOW", root.quit)
        root.wait_window(win)
        return 0
    if args.console:
        from iqos_agent.worker import AgentManager, AgentStatus
        status = AgentStatus()
        manager = AgentManager(cfg, status)
        manager.start()
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            manager.stop()
        return 0
    from iqos_agent.tray import main_tray
    main_tray()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
