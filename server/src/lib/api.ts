/** Small helpers shared by route handlers. */

export function json(data: unknown, init?: ResponseInit): Response {
  return Response.json(data, init);
}

export function badRequest(message: string, extra?: Record<string, unknown>): Response {
  return Response.json({ error: message, ...extra }, { status: 400 });
}

export function notFound(message = "not found"): Response {
  return Response.json({ error: message }, { status: 404 });
}

export async function readJson<T = unknown>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

const SERIAL_RE = /^[A-Z0-9]{6,32}$/i;
export function validSerial(serial: string | undefined | null): serial is string {
  return !!serial && SERIAL_RE.test(serial);
}

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "string" ? parseInt(value, 10) : typeof value === "number" ? value : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}
