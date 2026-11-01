import { badRequest, json } from "@/lib/api";
import { avgSessionSeconds, listDevicesLabeled as listDevices, statsFor } from "@/lib/queries";
import { isDateKey, addDays, todayKey } from "@/lib/time";
import type { GroupBy } from "@/lib/stats";

export const dynamic = "force-dynamic";

/**
 * GET /api/stats?from=YYYY-MM-DD&to=YYYY-MM-DD&group=day|week|month&device=S1,S2&user=ID
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const today = todayKey();
  const from = url.searchParams.get("from") || addDays(today, -89);
  const to = url.searchParams.get("to") || today;
  const group = (url.searchParams.get("group") || "day") as GroupBy;
  if (!isDateKey(from) || !isDateKey(to) || from > to) return badRequest("invalid range");
  if (!["day", "week", "month"].includes(group)) return badRequest("invalid group");
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
  // Suspect-clock records are hidden unless suspect=1 is passed.
  const excludeSuspect = url.searchParams.get("suspect") !== "1";
  const result = statsFor({ serials, from, to, groupBy: group, excludeSuspect });
  const sessionLength = avgSessionSeconds(serials, from, to);
  return json({
    ...result,
    sessionLength,
    serials,
    excludeSuspect,
    devices: all.filter((d) => serials.includes(d.serial)).map((d) => ({ serial: d.serial, name: d.name, color: d.color })),
  });
}
