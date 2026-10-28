"""Device settings writes – ONLY frames captured from the official IQOS app.

Every write below was observed on an ILUMA i ONE (model code 42PT) over USB
in `modra nastaveni.pcapng` (2026-10-28): the app sent the frame, the device
acknowledged it and a subsequent read returned the new value. Frames are
replayed byte-for-byte; nothing is composed at runtime. Writes are refused
for any other model code.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Optional

from iqos_agent.device_info import read_classic

VERIFIED_MODELS = {"42PT"}


@dataclass(frozen=True)
class SettingSpec:
    key: str
    write: dict[str, str]        # value -> command hex (without the 0x00 prefix)
    read: str                    # read-back command hex
    setting_id: Optional[int]    # first payload byte of the read reply, or None
    value_index: int             # payload byte carrying the value
    decode: dict[int, str]       # raw byte -> value name


SETTINGS: dict[str, SettingSpec] = {
    "flexpuff": SettingSpec(
        key="flexpuff",
        write={"off": "c945220300000061", "on": "c94522030100000a"},
        read="c905220300000017",
        setting_id=0x03,
        value_index=1,
        decode={0: "off", 1: "on"},
    ),
    "brightness": SettingSpec(
        key="brightness",
        write={"low": "c044241e0000009a", "high": "c044246400000034"},
        read="c00024fc",
        setting_id=None,
        value_index=0,
        decode={0x1E: "low", 0x64: "high"},
    ),
    "autostart": SettingSpec(
        key="autostart",
        write={"off": "c047240100000054", "on": "c04724010100003f"},
        read="c007240100000022",
        setting_id=0x01,
        value_index=1,
        decode={0: "off", 1: "on"},
    ),
}


class SettingError(Exception):
    pass


def read_setting(dev, spec: SettingSpec) -> Optional[str]:
    status, payload, _frame = read_classic(dev, bytes.fromhex(spec.read), timeout=1.5)
    if status != "ok":
        raise SettingError(f"read-back failed: {status}")
    if spec.setting_id is not None:
        if len(payload) < 2 or payload[0] != spec.setting_id:
            raise SettingError(f"unexpected read-back payload {payload.hex()}")
    if len(payload) <= spec.value_index:
        raise SettingError(f"short read-back payload {payload.hex()}")
    return spec.decode.get(payload[spec.value_index], f"raw:{payload[spec.value_index]:02x}")


def apply_setting(dev, model: Optional[str], setting: str, value: str) -> str:
    """Write one setting and return the value read back from the device."""
    if model not in VERIFIED_MODELS:
        raise SettingError(f"writes are only verified for {sorted(VERIFIED_MODELS)}, device reports {model!r}")
    spec = SETTINGS.get(setting)
    if spec is None:
        raise SettingError(f"unknown setting {setting!r}")
    command = spec.write.get(str(value).lower())
    if command is None:
        raise SettingError(f"unsupported value {value!r} for {setting}")
    status, _payload, frame = read_classic(dev, bytes.fromhex(command), timeout=2.0)
    if status != "ok":
        raise SettingError(f"device did not acknowledge write ({status}, {frame.hex() if frame else '-'})")
    time.sleep(0.25)
    result = read_setting(dev, spec)
    if result != str(value).lower():
        raise SettingError(f"read-back shows {result!r} after writing {value!r}")
    return result
