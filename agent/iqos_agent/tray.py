"""System tray icon (pystray) with a hidden Tk root for the settings window."""
from __future__ import annotations

import logging
import threading
import tkinter as tk
from tkinter import messagebox
import webbrowser

import pystray
from PIL import Image, ImageDraw

from iqos_agent import autostart
from iqos_agent.config import Config, load_config
from iqos_agent.i18n import Translator
from iqos_agent.settings_ui import open_settings
from iqos_agent.updater import UpdateScheduler, check_and_apply, cleanup_after_update
from iqos_agent.worker import AgentManager, AgentStatus
from iqos_agent import __version__

log = logging.getLogger(__name__)

COLORS = {
    "idle": (120, 120, 120),
    "connected": (34, 160, 70),
    "syncing": (42, 120, 214),
    "error": (208, 59, 59),
}


def make_icon(color: tuple[int, int, int], badge: bool = False) -> Image.Image:
    size = 64
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    # Stylised device body: rounded rectangle with a lit ring.
    draw.rounded_rectangle((14, 6, 50, 58), radius=12, fill=color)
    draw.ellipse((22, 14, 42, 34), fill=(255, 255, 255, 230))
    draw.ellipse((27, 19, 37, 29), fill=color)
    if badge:
        draw.ellipse((40, 40, 60, 60), fill=(208, 59, 59))
    return img


class TrayApp:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.tr = Translator(cfg.language)
        self.status = AgentStatus(on_change=self._refresh)
        self.manager = AgentManager(cfg, self.status)
        self.root = tk.Tk()
        self.root.withdraw()
        self.icon = pystray.Icon("iqos-agent", make_icon(COLORS["idle"]), self.tr("app"), menu=self._menu())
        self._settings_win = None
        self._refresh_pending = False
        self.updater = UpdateScheduler(enabled=lambda: self.cfg.auto_update, on_staged=self._restart_for_update)

    # -- menu ---------------------------------------------------------------------------
    def _menu(self) -> pystray.Menu:
        return pystray.Menu(
            pystray.MenuItem(lambda item: self._status_line(), None, enabled=False),
            pystray.MenuItem(lambda item: self._device_lines(), None, enabled=False, visible=lambda item: bool(self.status.snapshot().devices)),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem(self.tr("menu_open_web"), self._open_web, enabled=lambda item: self.cfg.configured),
            pystray.MenuItem(self.tr("menu_settings"), self._settings),
            pystray.MenuItem(self.tr("menu_autostart"), self._toggle_autostart, checked=lambda item: autostart.is_enabled()),
            pystray.MenuItem(self.tr("menu_check_updates"), self._check_updates),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem(self.tr("menu_quit"), self._quit),
        )

    def _status_line(self) -> str:
        st = self.status.snapshot()
        if not st.configured:
            return self.tr("status_not_configured")
        if st.server_ok is False:
            return self.tr("status_server_down")
        if not st.devices:
            return self.tr("status_idle")
        return self.tr("app")

    def _device_lines(self) -> str:
        st = self.status.snapshot()
        parts = []
        for d in st.devices.values():
            if d.syncing:
                parts.append(self.tr("status_syncing", name=d.name, done=d.sync_done, total=d.sync_total or "?"))
            else:
                line = self.tr("status_connected", name=d.name)
                if d.battery is not None:
                    line += " · " + self.tr("battery", pct=d.battery)
                parts.append(line)
        return "\n".join(parts) or self.tr("status_idle")

    # -- actions (run on pystray's thread; UI work is marshalled to Tk) ------------------
    def _open_web(self, icon=None, item=None):
        if self.cfg.configured:
            webbrowser.open(self.cfg.normalized_url())

    def _settings(self, icon=None, item=None):
        self.root.after(0, self._open_settings_window)

    def _open_settings_window(self):
        if self._settings_win is not None and self._settings_win.winfo_exists():
            self._settings_win.lift()
            return
        self._settings_win = open_settings(self.root, self.cfg, self.tr, self._on_saved)

    def _on_saved(self, cfg: Config):
        self.cfg = cfg
        self.tr.set_language(cfg.language)
        self.manager.apply_config(cfg)
        self.icon.title = self.tr("app")
        self.icon.menu = self._menu()
        self._refresh()

    def _toggle_autostart(self, icon=None, item=None):
        autostart.set_enabled(not autostart.is_enabled())

    def _check_updates(self, icon=None, item=None):
        def work():
            result = check_and_apply(force=True)
            if result == "staged":
                self.root.after(0, self._restart_for_update)
                return
            if result == "source":
                msg = self.tr("update_source")
            elif result == "up_to_date":
                msg = self.tr("update_up_to_date", version=__version__)
            else:
                msg = self.tr("update_error", error=result.removeprefix("error: "))
            self.root.after(0, lambda: messagebox.showinfo(self.tr("app"), msg))

        threading.Thread(target=work, daemon=True).start()

    def _restart_for_update(self):
        """The new build is staged and a helper waits for us to exit."""
        log.info("restarting for update")
        self._quit()

    def _quit(self, icon=None, item=None):
        self.manager.stop()
        self.icon.stop()
        self.root.after(0, self.root.quit)

    # -- icon state ---------------------------------------------------------------------
    def _refresh(self):
        st = self.status.snapshot()
        if not st.configured or st.server_ok is False:
            color, badge = COLORS["error"] if st.configured else COLORS["idle"], st.configured
        elif any(d.syncing for d in st.devices.values()):
            color, badge = COLORS["syncing"], False
        elif st.devices:
            color, badge = COLORS["connected"], False
        else:
            color, badge = COLORS["idle"], False
        try:
            self.icon.icon = make_icon(color, badge)
            title = self._status_line()
            lines = self._device_lines() if st.devices else ""
            self.icon.title = (title + ("\n" + lines if lines else ""))[:127]
            self.icon.update_menu()
        except Exception:
            pass

    # -- lifecycle ----------------------------------------------------------------------
    def run(self):
        cleanup_after_update()
        self.manager.start()
        self.updater.start()
        self.icon.run_detached()
        if not self.cfg.configured:
            self.root.after(300, self._open_settings_window)
        self.root.mainloop()
        self.manager.stop()


def main_tray():
    cfg = load_config()
    TrayApp(cfg).run()
