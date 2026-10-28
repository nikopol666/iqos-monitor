import { badRequest, json } from "@/lib/api";
import { listDevicesLabeled as listDevices, recordsInRange } from "@/lib/queries";
import { isDateKey } from "@/lib/time";

export const dynamic = "force-dynamic";

/**
 * GET /api/events?from=YYYY-MM-DD&to=YYYY-MM-DD&device=S1,S2&user=ID&suspect=0
 * Timestamped records for the chart drill-down (max 1000, newest first).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to") || from;
  if (!isDateKey(from) || !isDateKey(to) || from > to) return badRequest("invalid range");
  const all = listDevices();
  let serials = all.map((d) => d.serial);
  const deviceParam = url.searchParams.get("device");
  const userParam = url.searchParams.get("user");
  if (deviceParam) {
    const wanted = new Set(deviceParam.split(",").map((s) => s.trim()).filter(Boolean));
    serials = serials.filter((s) => wanted.has(s));
  } else if (userParam) {
    const userId = parseInt(userParam, 10);
    serials = all.filter((d) => d.userId === userId).map((d) => d.serial);
  }
  const excludeSuspect = url.searchParams.get("suspect") === "0";
  const items = recordsInRange(serials, from, to, excludeSuspect);
  return json({ items, devices: all.filter((d) => serials.includes(d.serial)).map((d) => ({ serial: d.serial, name: d.name, color: d.color })) });
}
