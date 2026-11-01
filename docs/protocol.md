# IQOS ILUMA i ONE over USB: what the agent reads and writes

This is the technical reference for the device communication implemented in
`agent/iqos_agent/`. Everything here was either captured from the official
IQOS desktop application (USBPcap + Wireshark) or taken from the open-source
projects listed at the end, and then checked on two physical ILUMA i ONE
devices (model `42PT`, firmware 150.6.1 / 150.7.1). Items marked **verified**
were confirmed against the official app, a timed session or a physical
measurement; **candidate** items fit the data but have no independent
confirmation yet.

## Transport

- USB HID, VID `0x2759`, PID `0x0003`, 64-byte reports.
- Host → device: report `3F <len> <body…>`, zero-padded to 64 bytes.
- Device → host, short reply: `3F <len> <frame…>`. The frame is interpreted
  with a leading `00` byte (hidapi indexing; WebHID is offset by one).
- Long replies are fragmented in reports `40 <len> <seq> <data…>`: bit 7 of
  `seq` marks the first fragment, the sequence number counts down, fragment 0
  is the last one. `FrameCollector` in `core.py` reassembles them.
- Bytes past the declared length are a background status stream and are
  ignored.

## Frames

**Classic (short) frame**
- `frame[2] & 0x80` = reply, `frame[2] & 0x20` = device error (unsupported).
- Length `5 + (0, 4, 14, 24)[(frame[2] >> 2) & 3]`.
- Last byte: CRC-8 (polynomial 0x07, init 0) over `frame[2:-1]`.
- Reply matches a command when `(frame[2] & 3, frame[3]) == (cmd[1] & 3, cmd[2])`.
- Payload is `frame[4:-1]`.

**Extended (SCP) frame**
- `frame[2] & 0x10` = extended, `frame[2] & 0x20` = error.
- Length `frame[3] + 6`.
- CRC-16 (polynomial 0x755B, init 0) over `frame[2:-2]`, little-endian at the end.
- Address `frame[4:6]`; record index `frame[8:11]` (3 bytes LE).
- An empty reply (an id without content) is 13 bytes long.

**Building a classic command**: `net` (`C0` device, `C9` second processor,
`D2` another block) + `op` + `reg` [+ 4 value bytes] + CRC-8 over every byte
after `net`.

## Registers read by the agent

| key | command | payload | status |
|---|---|---|---|
| firmware | `c0000000` | bytes 2–4 = version (e.g. `96 06 01` → 150.6.1) | verified (official app) |
| serial | `c0000309` | ASCII | verified |
| model | `c90022ee` | ASCII (`42PT`) | verified |
| battery / brightness | `c00024fc` | byte 0 = LED brightness level (`0x64` high, `0x1e` low) | verified (capture) |
| status_60 | `c0016032` | `[u16 cell voltage in 2 mV units, charge %, temperature °C]` | verified: % against the app; voltage and temperature over a full charge (3.55 V at 8 % → 4.2 V at 100 %, temperature rises while charging) |
| stick_state | `c00120f5` | byte 0: `01` charging, `00` not charging | verified |
| counters | `c90221cd` | u32 @0 heating starts (lifetime "sticks"); u32 @6 usage counter; u32 @10 puffs | verified; the usage counter ticks ≈2.35× per second of a session (see below) |
| session | `c90121f2` | last session register, see below | partly verified |
| error_state | `c00220ca` | u16 | candidate (always 0 so far) |
| sensor_83 | `c90320df` | u16 | candidate: tracks the cell voltage (r = 0.89) |
| sensor_84 | `c00021e7` | u16 | candidate: tracks the battery temperature (r ≈ 0.9) |
| flexpuff | `d205220300000017` | byte 0 of payload = enabled | verified (capture) |
| autostart | `c007240100000022` | u8 enabled | verified (capture) |
| smart_gesture | `c00405050100006c` | payload byte 4 = enabled | verified (capture) |
| lock | `c000041c` | `02 ff 00 00` locked, `00 00 00 00` unlocked | verified (capture) |
| vibrations | `c007040c/0e/0d/0f…` | payload byte 11 = `1d` on / `01` off per event | verified (capture) |
| brightness `c00223c3`, vibration `c90023e9`, flexbattery `c90025fb`, pause mode | — | rejected over USB (`unsupported`) on ILUMA i ONE | — |

**Lifetime "sticks"** counts heating starts, not smoked sticks: an aborted
heating (stick removed before the first puff) increments it and leaves an
archive record with 0 puffs. Button presses without a stick and inserting a
stick without heating create nothing.

**Usage counter**: proportional to session time, ≈2.35 ticks per second
(2.3–2.5 per session from the last-session register; 2.34 over a whole archive
when the per-record durations are summed). Not quarter-seconds as some tools
assume. The web converts with `USAGE_TICKS_PER_SECOND`.

## Last session register (`c9 01 21 f2`)

```
u16 @0   session number (= lifetime heating starts)
u16 @2   unknown
u32 @4   timestamp (seconds since 2010-01-01 UTC) of the *previous* record
u16 @8   unknown
u8  @10  0
u16 @11  length of the last session in seconds        (candidate, consistent on 8 sessions)
u16 @13  usage-counter increment of the last session  (verified: equals the measured counter delta)
```

## Archive (history) records, SCP

- Metadata: `c01002010175d6`, address `01 01`; reply holds `next_index = u24 @10`.
- Record: body `c0100701020001` + index (3 bytes LE) + CRC-16(body[1:]) LE;
  reply address `01 02`; `frame[8:11]` must equal the requested index.
- **Timestamp** `u32 @19` = seconds since 2010-01-01 UTC = the second the stick
  was inserted / heating started (verified to the second against a hand-timed
  session). Zero = no time.
- **Puffs**: `frame[108] ∈ {0x08, 0x18}`, `frame[109] = N`, then N two-byte
  pairs from offset 110, 7 trailing bytes, total length `117 + 2N`. Verified
  on 26 frames and two counted sessions (18 and 14 puffs).
- **Puff pair byte 0** = time of the puff since the session start in
  **2-second units** (verified: the last puff always lands a few seconds before
  the next record starts, capped sessions end at 360 s, the first puff comes
  ~20 s after the start, and the last-session register's length equals
  2 × last byte 0 + 2–9 s). Byte 1 is two nibbles of unknown meaning.
- A record is one heating start, not necessarily one smoked stick (0-puff
  records exist). Archive ids are not the lifetime counter on every device.
- Device clocks can be wrong: adjacent ids more than 30 days apart are flagged
  as *suspicious clock* and hidden from statistics by default.

## Settings written by the agent

Only frames captured from the official application are ever sent, each
followed by the read-back the app itself performs (`agent/iqos_agent/settings.py`).

| setting | write | acknowledgement |
|---|---|---|
| FlexPuff on/off | `d2 45 22 03 01/00 00 00 ..` | read-back of `d2 05 22 03` |
| LED brightness high/low | `c0 46 23 64/1e 00 00 00 ..` (+ `c9 44 24 …`) | read-back |
| AutoStart on/off | `c9 47 24 01 01/00 00 00 ..` | read-back |
| Smart Gesture on/off | `c0 48 05 14/07 05 01 00 00 01/00 00 ff ff ff ff ff ff 00 ..` + `c0 44 05 00 ff ff 00 c3` | `c0 c0 05 f6` |
| Lock / unlock | `c0 44 04 02 ff 00 00 5a` / `c0 44 04 00 00 00 00 5d` | `c0 c0 04 f1` |
| Find my IQOS start / stop | `c0 45 62 01 1e 00 00 0b` / `c0 45 62 00 1e 00 00 1d` | `c0 c1 62 d1` |
| Vibrations (4 events) | five rows of register 04 (`c0 4b 04 …`) + commit `c0 47 04 00 ff ff 00 da` | `c0 c3 04 ce` |
| Restart | `c9 46 00 00 00 00 00 80` + `c0 46 00 00 00 00 00 80` | device re-enumerates on USB |

Firmware updates and factory resets are never issued.

## Event log (`c9 05 02 <index>`)

The official app reads 256 entries of 15 bytes: `u32` time since 2010, a type
byte and 7 data bytes; index 0 is the newest. Type `02` is written on a
(re)start (the restart command adds one; a normal power-off does not), type
`06` is unknown. The web shows the raw entries without interpretation.

## Sources

- [iqos-bar](https://github.com/tiritfurkan/iqos-bar) and
  [iqos-scope](https://github.com/SabriEzzine/iqos-scope): the classic read
  registers and the first interpretation of the counters.
- [okhsunrog/iqos](https://github.com/okhsunrog/iqos) (`agent/usb-transport`
  branch), [hauntedfail/iqos](https://github.com/hauntedfail/iqos),
  [kuroiko0429/iqosctl](https://github.com/kuroiko0429/iqosctl): the shared
  SCP framing over BLE and USB and the settings command set.
- USB captures of the official IQOS desktop application made by the project
  authors on their own devices.
