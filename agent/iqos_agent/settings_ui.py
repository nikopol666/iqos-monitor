"""Small Tkinter settings window (server address, API key, language, autostart)."""
from __future__ import annotations

import threading
import tkinter as tk
from tkinter import ttk, messagebox
from typing import Callable

from iqos_agent import autostart
from iqos_agent.config import Config, save_config
from iqos_agent.i18n import LANGUAGE_NAMES, Translator
from iqos_agent.uploader import ServerClient, ServerError


def open_settings(root: tk.Tk, cfg: Config, tr: Translator, on_saved: Callable[[Config], None]) -> tk.Toplevel:
    win = tk.Toplevel(root)
    win.title(tr("settings_title"))
    win.resizable(False, False)
    win.attributes("-topmost", True)
    frame = ttk.Frame(win, padding=14)
    frame.grid(sticky="nsew")

    url_var = tk.StringVar(value=cfg.server_url)
    key_var = tk.StringVar(value=cfg.api_key)
    name_var = tk.StringVar(value=cfg.agent_name)
    lang_codes = ["auto"] + list(LANGUAGE_NAMES)
    lang_labels = [tr("lang_auto")] + [LANGUAGE_NAMES[c] for c in LANGUAGE_NAMES]
    lang_var = tk.StringVar(value=lang_labels[lang_codes.index(cfg.language if cfg.language in lang_codes else "auto")])
    db_var = tk.StringVar(value=cfg.db_path)
    auto_var = tk.BooleanVar(value=autostart.is_enabled())
    result_var = tk.StringVar(value="")

    def row(label: str, widget, r: int):
        ttk.Label(frame, text=label).grid(row=r, column=0, sticky="w", pady=(6, 0))
        widget.grid(row=r + 1, column=0, columnspan=2, sticky="ew")

    row(tr("server_url"), ttk.Entry(frame, textvariable=url_var, width=52), 0)
    row(tr("api_key"), ttk.Entry(frame, textvariable=key_var, width=52), 2)
    row(tr("agent_name"), ttk.Entry(frame, textvariable=name_var, width=52), 4)
    row(tr("language"), ttk.Combobox(frame, textvariable=lang_var, values=lang_labels, state="readonly"), 6)
    row(tr("db_path"), ttk.Entry(frame, textvariable=db_var, width=52), 8)
    ttk.Checkbutton(frame, text=tr("autostart"), variable=auto_var).grid(row=10, column=0, columnspan=2, sticky="w", pady=(8, 0))
    ttk.Label(frame, textvariable=result_var, wraplength=380).grid(row=11, column=0, columnspan=2, sticky="w", pady=(8, 0))

    buttons = ttk.Frame(frame)
    buttons.grid(row=12, column=0, columnspan=2, sticky="e", pady=(12, 0))

    def current() -> Config:
        new = Config(**vars(cfg))
        new.server_url = url_var.get().strip()
        new.api_key = key_var.get().strip()
        new.agent_name = name_var.get().strip() or cfg.agent_name
        new.language = lang_codes[lang_labels.index(lang_var.get())] if lang_var.get() in lang_labels else "auto"
        new.db_path = db_var.get().strip() or cfg.db_path
        return new

    def test():
        new = current()
        result_var.set("…")

        def work():
            try:
                client = ServerClient(new.normalized_url(), new.api_key, new.agent_name, timeout=5)
                client.heartbeat([])
                msg = tr("test_ok")
            except ServerError as exc:
                msg = tr("test_fail", error=str(exc))
            except Exception as exc:
                msg = tr("test_fail", error=str(exc))
            win.after(0, lambda: result_var.set(msg))

        threading.Thread(target=work, daemon=True).start()

    def save():
        new = current()
        try:
            save_config(new)
            autostart.set_enabled(auto_var.get())
        except Exception as exc:
            messagebox.showerror(tr("app"), str(exc), parent=win)
            return
        on_saved(new)
        win.destroy()

    ttk.Button(buttons, text=tr("test"), command=test).grid(row=0, column=0, padx=(0, 6))
    ttk.Button(buttons, text=tr("cancel"), command=win.destroy).grid(row=0, column=1, padx=(0, 6))
    ttk.Button(buttons, text=tr("save"), command=save).grid(row=0, column=2)
    win.update_idletasks()
    win.lift()
    win.focus_force()
    return win
