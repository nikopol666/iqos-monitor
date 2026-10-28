/** CRC-8, polynomial 0x07, init 0 – classic (short) IQOS frames. */
export function crc8(data: Uint8Array): number {
  let crc = 0;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = ((crc << 1) ^ (crc & 0x80 ? 0x07 : 0)) & 0xff;
    }
  }
  return crc;
}

/** CRC-16, polynomial 0x755B, init 0 – extended (SCP) IQOS frames. */
export function crc16(data: Uint8Array): number {
  let crc = 0;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = ((crc << 1) ^ (crc & 0x8000 ? 0x755b : 0)) & 0xffff;
    }
  }
  return crc;
}
