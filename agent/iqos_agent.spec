# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec: single-file, windowed (no console) tray application.
from PyInstaller.utils.hooks import collect_submodules

block_cipher = None

a = Analysis(
    ["iqos_agent/__main__.py"],
    pathex=["."],
    binaries=[],
    datas=[("iqos_agent/known_observations.json", "iqos_agent")],
    hiddenimports=collect_submodules("pystray") + ["PIL.ImageDraw", "tkinter", "tkinter.ttk", "winreg"],
    hookspath=[],
    runtime_hooks=[],
    excludes=["matplotlib", "numpy", "scipy", "pandas"],
    cipher=block_cipher,
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="IQOS-Agent",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    icon=None,
)
