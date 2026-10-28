"""Tray / settings strings. Default English; follows the Windows UI language."""
from __future__ import annotations

import ctypes
import locale
import sys

STRINGS: dict[str, dict[str, str]] = {
    "en": {
        "app": "IQOS Agent",
        "status_idle": "No IQOS connected",
        "status_connected": "{name}: connected",
        "status_syncing": "{name}: syncing {done}/{total}",
        "status_server_down": "Server unreachable",
        "status_not_configured": "Server not configured",
        "menu_open_web": "Open web app",
        "menu_settings": "Settings…",
        "menu_autostart": "Start with Windows",
        "menu_quit": "Quit",
        "settings_title": "IQOS Agent – settings",
        "server_url": "Server address (e.g. http://192.168.1.10:3000)",
        "api_key": "API key (from the web app, Settings → Agents)",
        "agent_name": "Agent name",
        "language": "Language",
        "lang_auto": "Windows default",
        "db_path": "Local database",
        "autostart": "Start with Windows",
        "test": "Test connection",
        "save": "Save",
        "cancel": "Cancel",
        "test_ok": "Connected: server OK",
        "test_fail": "Connection failed: {error}",
        "battery": "battery {pct} %",
        "pending": "{n} records waiting for upload",
    },
    "cs": {
        "app": "IQOS Agent",
        "status_idle": "Žádný IQOS není připojen",
        "status_connected": "{name}: připojeno",
        "status_syncing": "{name}: synchronizace {done}/{total}",
        "status_server_down": "Server nedostupný",
        "status_not_configured": "Server není nastaven",
        "menu_open_web": "Otevřít webovou aplikaci",
        "menu_settings": "Nastavení…",
        "menu_autostart": "Spouštět po přihlášení",
        "menu_quit": "Ukončit",
        "settings_title": "IQOS Agent – nastavení",
        "server_url": "Adresa serveru (např. http://192.168.1.10:3000)",
        "api_key": "API klíč (z webu, Nastavení → Agenti)",
        "agent_name": "Název agenta",
        "language": "Jazyk",
        "lang_auto": "Podle Windows",
        "db_path": "Lokální databáze",
        "autostart": "Spouštět po přihlášení",
        "test": "Otestovat spojení",
        "save": "Uložit",
        "cancel": "Zrušit",
        "test_ok": "Spojeno: server OK",
        "test_fail": "Spojení selhalo: {error}",
        "battery": "baterie {pct} %",
        "pending": "{n} záznamů čeká na odeslání",
    },
}
LANGUAGE_NAMES = {"en": "English", "cs": "Čeština"}


def windows_ui_language() -> str:
    """Two-letter code of the Windows UI language, 'en' when unknown."""
    try:
        if sys.platform == "win32":
            langid = ctypes.windll.kernel32.GetUserDefaultUILanguage()
            primary = langid & 0x3FF
            if primary == 0x05:
                return "cs"
            if primary == 0x09:
                return "en"
    except Exception:
        pass
    try:
        code = (locale.getlocale()[0] or "").lower()
        if code.startswith("cs") or code.startswith("czech"):
            return "cs"
    except Exception:
        pass
    return "en"


class Translator:
    def __init__(self, language: str = "auto"):
        self.set_language(language)

    def set_language(self, language: str) -> None:
        code = windows_ui_language() if language in ("auto", "", None) else language
        self.code = code if code in STRINGS else "en"

    def __call__(self, key: str, **kwargs) -> str:
        text = STRINGS[self.code].get(key) or STRINGS["en"].get(key, key)
        return text.format(**kwargs) if kwargs else text
