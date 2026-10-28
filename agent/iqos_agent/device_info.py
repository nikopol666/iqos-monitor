"""Conservative, read-only diagnostics from IQOS Scope and measured Windows USB captures.

The app ONLY issues the classic read queries already demonstrated in user-supplied
captures. Unsupported settings remain unsupported (no speculative reads/writes).
All raw SCP frames are retained so the interpretations can be corrected later.
"""
from __future__ import annotations
import datetime as dt
from iqos_agent.core import FrameCollector

# These exact hex commands have previously succeeded or produced a read-only error
# on both physical devices, as captured in iqos_readonly.py output.
READ_COMMANDS = {
    'firmware': 'c0000000',
    'serial': 'c0000309',
    'model': 'c90022ee',
    'battery': 'c00024fc',
    'sensor_83': 'c90320df',
    'sensor_84': 'c00021e7',
    'counters': 'c90221cd',
    'session': 'c90121f2',
    'stick_state': 'c00120f5',
    'error_state': 'c00220ca',
    'brightness': 'c00223c3',
    'vibration': 'c90023e9',
    'flexbattery': 'c90025fb',
    # Read-only probes taken from hauntedfail/iqos (BLE) – same SCP frames over USB.
    # On ILUMA i ONE over USB only flexpuff answers; the rest return an error bit.
    'flexpuff': 'c905220300000017',   # as the official app reads it (D2 05 22 03 works too)
    'autostart': 'c007240100000022',  # ILUMA i ONE answers on C0, not C9
    'pause_mode': 'c007240200000018',
    'smart_gesture': 'c00405050100006c',   # as the official app reads it (byte 4 = state)
    'lock': 'c000041c',
    'vib_heat': 'c007040c000000b8',
    'vib_almost': 'c007040e00000094',
    'vib_ready': 'c007040d000000ae',
    'vib_end': 'c007040f00000082',
    'holder_firmware': 'c9000000',
    'epoch': 'c003003f',
    'conversion': 'c00020e0',
    # Candidates for the real battery register (official app reads these; values unverified).
    'status_60': 'c0016032',
    'status_long': 'c0010015',
}


def crc8(payload: bytes) -> int:
    result=0
    for b in payload:
        result ^= b
        for _ in range(8):
            result=(((result << 1) ^ (7 if result & 128 else 0)) & 255)
    return result


def decode_classic(frame: bytes, command: bytes):
    """Parse a reply to an already verified short classic register query."""
    if len(frame)<5 or not (frame[2] & 0x80):
        return 'invalid', b''
    if (frame[2] & 3, frame[3]) != (command[1] & 3,command[2]):
        return 'unmatched', b''
    if crc8(frame[2:-1])!=frame[-1]:
        return 'bad_crc', b''
    if frame[2] & 0x20:
        return 'unsupported', b''
    return 'ok',frame[4:-1]


def read_classic(dev, command: bytes, timeout: float=1.2):
    """Use the open hidapi handle, without changing device settings."""
    import time
    packet=(b'\x3f'+bytes([len(command)])+command).ljust(64,b'\x00')
    for _ in range(100):
        if not dev.device.read(64):
            break
    if dev.device.write(packet)!=64:
        return 'write_error', b'', b''
    collector=FrameCollector()
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        b=bytes(dev.device.read(64))
        if not b:
            time.sleep(.005)
            continue
        frame=collector.feed(b)
        if not frame or len(frame)<5:
            continue
        if (frame[2] & 3,frame[3])!=(command[1]&3,command[2]):
            continue
        status,data=decode_classic(frame,command)
        return status,data,frame
    return 'timeout',b'',b''


def u16(b,at):
    return int.from_bytes(b[at:at+2],'little') if len(b)>=at+2 else None


def u32(b,at):
    return int.from_bytes(b[at:at+4],'little') if len(b)>=at+4 else None


EVENT_LOG_ENTRIES = 40


def event_log_command(index: int) -> bytes:
    body = bytes([0xC9, 0x05, 0x02, index, 0x00, 0x00, 0x00])
    return body + bytes([crc8(body[1:])])


def read_event_log(dev, count: int = EVENT_LOG_ENTRIES) -> list:
    """Undecoded device event log the official app reads (c9 05 02 <index>); read-only."""
    import time as _time
    entries = []
    for index in range(count):
        status, payload, frame = read_classic(dev, event_log_command(index), timeout=1.2)
        if status != 'ok' or len(payload) < 12:
            entries.append({'index': index, 'status': status})
            continue
        ts = int.from_bytes(payload[2:6], 'little')
        entries.append({'index': index, 'status': 'ok', 'raw': payload.hex(),
                        'time_utc': (dt.datetime(2010, 1, 1, tzinfo=dt.timezone.utc) + dt.timedelta(seconds=ts)).isoformat() if ts else None,
                        'type': payload[6], 'data': payload[7:].hex()})
        _time.sleep(0.02)
    return entries


def read_snapshot(dev):
    """Return JSON-friendly snapshot with validated and tentative fields separated."""
    frames={}; values={}; statuses={}; payloads={}
    for key,hex_command in READ_COMMANDS.items():
        status,payload,frame=read_classic(dev,bytes.fromhex(hex_command))
        statuses[key]=status
        frames[key]=frame.hex() if frame else ''
        if status=='ok': payloads[key]=payload
        time_to_sleep=.04
        import time
        time.sleep(time_to_sleep)

    def ascii_payload(key):
        p=payloads.get(key,b'')
        return ''.join(chr(b) for b in p if 32<=b<127).strip() or None

    values['serial_readback']=ascii_payload('serial')
    values['model']=ascii_payload('model')
    values['firmware_raw']=payloads.get('firmware',b'').hex() or None
    fw=payloads.get('firmware',b'')
    values['firmware_version']=f'{fw[2]}.{fw[3]}.{fw[4]}' if len(fw)>=5 else None   # app shows 150.6.1 for 96 06 01
    # Register C0/00/24 follows the LED brightness (0x1E low / 0x64 high) in the
    # official-app capture; it is kept under its old key for compatibility but
    # must not be shown as battery.
    s60=payloads.get('status_60',b'')
    values['battery_percent']=s60[2] if len(s60)>=4 else None      # candidate: reg C0/01/60 byte 2
    values['battery_temp_c']=s60[3] if len(s60)>=4 else None
    values['battery_raw']=u16(s60,0) if len(s60)>=2 else None
    values['brightness_level']=payloads['battery'][0] if payloads.get('battery') else None
    values['charging']=(payloads['stick_state'][0]==1) if payloads.get('stick_state') else None
    values['status_60_raw']=payloads.get('status_60',b'').hex() or None
    values['status_long_raw']=payloads.get('status_long',b'').hex() or None
    values['stick_state_code']=payloads.get('stick_state',b'')[:1].hex() or None
    values['error_state_code']=u16(payloads.get('error_state',b''),0)
    c=payloads.get('counters',b'')
    values['lifetime_sticks_candidate']=u32(c,0)
    values['lifetime_puffs_candidate']=u32(c,10)
    quarter_seconds=u32(c,6)
    values['lifetime_seconds_candidate']=(quarter_seconds/4) if quarter_seconds is not None else None
    if values['lifetime_sticks_candidate'] and values['lifetime_puffs_candidate'] is not None:
        values['average_puffs_per_stick_candidate']=round(
            values['lifetime_puffs_candidate']/values['lifetime_sticks_candidate'],2)
    else:
        values['average_puffs_per_stick_candidate']=None
    values['sensor_83_raw_value']=u16(payloads.get('sensor_83',b''),0)
    values['sensor_84_raw_value']=u16(payloads.get('sensor_84',b''),0)
    values['last_session_raw']=payloads.get('session',b'').hex() or None
    values['brightness_raw']=payloads.get('brightness',b'').hex() or None
    values['vibration_raw']=payloads.get('vibration',b'').hex() or None
    values['flexbattery_raw']=payloads.get('flexbattery',b'').hex() or None
    fp=payloads.get('flexpuff',b'')
    values['flexpuff_enabled']=(fp[1]==1) if len(fp)>=2 and fp[0]==0x03 else None
    au=payloads.get('autostart',b'')
    values['autostart_enabled']=(au[1]==1) if len(au)>=2 and au[0]==0x01 else None
    pm=payloads.get('pause_mode',b'')
    values['pause_mode_enabled']=(pm[1]==1) if len(pm)>=2 and pm[0]==0x02 else None
    sg=payloads.get('smart_gesture',b'')
    values['smart_gesture_enabled']=(sg[4]==1) if len(sg)>=5 and sg[0]==0x05 else None
    lk=payloads.get('lock',b'')
    values['locked']=(lk[0]==0x02) if len(lk)>=1 else None
    for vib_key in ('vib_heat','vib_almost','vib_ready','vib_end'):
        row=payloads.get(vib_key,b'')
        values[vib_key+'_enabled']=({0x1D:True,0x01:False}.get(row[11]) if len(row)>=12 else None)
    values['holder_firmware_raw']=payloads.get('holder_firmware',b'').hex() or None
    values['epoch_raw']=payloads.get('epoch',b'').hex() or None
    values['conversion_raw']=payloads.get('conversion',b'').hex() or None
    try:
        values['event_log']=[e for e in read_event_log(dev) if e.get('time_utc')]
    except Exception as exc:  # the log is research data; never block the snapshot
        values['event_log_error']=str(exc)
    return {'values':values,'statuses':statuses,'frames':frames,
            'collected_utc':dt.datetime.now(dt.timezone.utc).isoformat()}
