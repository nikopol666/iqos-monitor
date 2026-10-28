export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim();
  if (clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) {
    throw new Error("invalid hex string");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

export function u16le(b: Uint8Array, at: number): number | null {
  return b.length >= at + 2 ? b[at] | (b[at + 1] << 8) : null;
}

export function u24le(b: Uint8Array, at: number): number | null {
  return b.length >= at + 3 ? b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) : null;
}

export function u32le(b: Uint8Array, at: number): number | null {
  if (b.length < at + 4) return null;
  // >>> 0 keeps the value unsigned.
  return (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
}

export function asciiPayload(b: Uint8Array): string | null {
  let s = "";
  for (const c of b) if (c >= 32 && c < 127) s += String.fromCharCode(c);
  s = s.trim();
  return s || null;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
