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
    values['battery_percent']=u16(payloads.get('battery',b''),0)
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
    return {'values':values,'statuses':statuses,'frames':frames,
            'collected_utc':dt.datetime.now(dt.timezone.utc).isoformat()}
