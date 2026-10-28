"""Read-only IQOS ILUMA i ONE USB history reader.

Two request types only, both captured from the official IQOS application:
- metadata of the history archive
- detailed archive record for a given index

Unknown registers or settings writes are intentionally not supported.
"""
from __future__ import annotations

import datetime as dt
import time
from dataclasses import dataclass
from typing import Optional

VID = 0x2759
PID = 0x0003
# Display names come from the server (heartbeat); locally a device is its serial.
NAMES: dict[str, str] = {}


def device_name(serial: Optional[str]) -> str:
    return NAMES.get(serial or "", serial or "unknown")
METADATA_REQUEST = bytes.fromhex("c01002010175d6")
BASE_TIME = dt.datetime(2010, 1, 1, tzinfo=dt.timezone.utc)


def crc16(data: bytes) -> int:
    crc = 0
    for byte in data:
        crc ^= byte << 8
        for _ in range(8):
            crc = ((crc << 1) ^ (0x755B if crc & 0x8000 else 0)) & 0xFFFF
    return crc


def history_request(index: int) -> bytes:
    if not 0 <= index <= 0xFFFFFF:
        raise ValueError("History index does not fit into 3 bytes")
    body = bytes.fromhex("c0100701020001") + index.to_bytes(3, "little")
    return body + crc16(body[1:]).to_bytes(2, "little")


class FrameCollector:
    def __init__(self):
        self.buffer = bytearray()
        self.next_fragment = None

    def feed(self, packet: bytes) -> Optional[bytes]:
        if len(packet) < 4:
            return None
        length = packet[1]
        if length + 2 > len(packet):
            return None
        if packet[0] == 0x3F:
            return b"\x00" + packet[2:2 + length] if length >= 4 else None
        if packet[0] != 0x40 or length < 2:
            return None
        fragment = packet[2]
        index = fragment & 0x7F
        if fragment & 0x80:
            self.buffer.clear()
            self.next_fragment = index
        if self.next_fragment != index:
            self.buffer.clear()
            self.next_fragment = None
            return None
        self.buffer.extend(packet[3:2 + length])
        if index == 0:
            result = b"\x00" + bytes(self.buffer)
            self.buffer.clear()
            self.next_fragment = None
            return result
        self.next_fragment = index - 1
        return None


def check_crc(frame: bytes) -> bool:
    return (
        len(frame) >= 12
        and bool(frame[2] & 0x10)
        and len(frame) == frame[3] + 6
        and crc16(frame[2:-2]) == int.from_bytes(frame[-2:], "little")
    )


def extract_datetime(frame: bytes) -> Optional[str]:
    """Candidate timestamp, corroborated by two precisely timed tests.

    This does NOT imply every archive entry is one smoked stick.
    """
    if len(frame) < 23 or not check_crc(frame) or frame[2] & 0x20:
        return None
    seconds = int.from_bytes(frame[19:23], "little")
    if seconds == 0:
        return None
    when = BASE_TIME + dt.timedelta(seconds=seconds)
    if when > dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=2):
        return None
    return when.isoformat()


@dataclass
class Reply:
    status: str
    frame: bytes = b""
    packets: tuple[bytes, ...] = ()


class IQOSDevice:
    def __init__(self, info: dict):
        import hid
        self.serial = info.get("serial_number")
        self.device = hid.device()
        self.device.open_path(info["path"])
        self.device.set_nonblocking(True)

    def close(self):
        self.device.close()

    def request(self, body: bytes, address: bytes, index: Optional[int] = None,
                timeout: float = 3.0) -> Reply:
        packet = (bytes((0x3F, len(body))) + body).ljust(64, b"\x00")
        # Discard leftover status frames from previous requests; does not issue any commands.
        for _ in range(100):
            if not self.device.read(64):
                break
        if self.device.write(packet) != 64:
            return Reply("write_error")
        collector = FrameCollector()
        packets = []
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            incoming = bytes(self.device.read(64))
            if not incoming:
                time.sleep(0.005)
                continue
            packets.append(incoming)
            frame = collector.feed(incoming)
            if frame is None:
                continue
            # Ignore background traffic and only accept matching SCP response.
            if len(frame) < 12 or not (frame[2] & 0x10) or frame[4:6] != address:
                continue
            if index is not None and frame[8:11] != index.to_bytes(3, "little"):
                continue
            if not check_crc(frame):
                return Reply("bad_crc", frame, tuple(packets))
            if frame[2] & 0x20:
                return Reply("device_error", frame, tuple(packets))
            return Reply("empty" if len(frame) == 13 else "ok", frame, tuple(packets))
        return Reply("timeout", packets=tuple(packets))

    def next_index(self) -> int:
        reply = self.request(METADATA_REQUEST, b"\x01\x01")
        if reply.status != "ok" or len(reply.frame) < 13:
            raise RuntimeError("Nelze nacist metadata historie (" + reply.status + ")")
        return int.from_bytes(reply.frame[10:13], "little")

    def read(self, index: int) -> Reply:
        return self.request(history_request(index), b"\x01\x02", index=index)


def connected_devices():
    """Every IQOS HID interface with a serial number (no whitelist)."""
    import hid
    seen = set()
    result = []
    for entry in hid.enumerate(VID, PID):
        serial = entry.get("serial_number")
        if not serial or serial in seen:
            continue
        seen.add(serial)
        result.append(entry)
    return result
