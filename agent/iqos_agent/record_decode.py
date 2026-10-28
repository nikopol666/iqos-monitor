"""Conservative experimental decoder for history record puff events.

Validated on 26 CRC-valid real frames (both devices), including 2 controlled
sessions whose counter deltas were independently observed (+18/+14).
No time unit is inferred from individual event byte pairs.
"""
from __future__ import annotations
from dataclasses import dataclass
from typing import Optional
from iqos_agent.core import check_crc

@dataclass(frozen=True)
class PuffTrace:
    count: int
    marker: int
    event_pairs: tuple[str, ...]
    interpretation: str = 'strong_candidate'


def decode_puffs(frame: bytes) -> Optional[PuffTrace]:
    """Return puff-count candidate and raw two-byte events or None on mismatch.

    Layout observed for 0x01/0x02 SCP detailed history responses:
    - Frame[108]: 0x18 for typical session, 0x08 for other record forms
    - Frame[109]: entry count
    - Frame[110:110+2*count]: 2 bytes per event
    - 7 trailer bytes (not decoded)
    - Total frame length = 117 + 2*count
    No claim that every zero-count record is a smoking session.
    """
    if not check_crc(frame) or len(frame) < 117:
        return None
    if frame[4:8] != bytes.fromhex('01020001'):
        return None
    count = frame[109]
    if frame[108] not in (0x08, 0x18):
        return None
    if len(frame) != 117 + 2 * count:
        return None
    pairs = tuple(frame[110 + i*2 : 112 + i*2].hex() for i in range(count))
    return PuffTrace(count=count, marker=frame[108], event_pairs=pairs)
