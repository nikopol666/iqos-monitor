import { clampInt, json } from "@/lib/api";
import { listDevicesLabeled } from "@/lib/queries";
import { shortTermStats } from "@/lib/shortterm";

export const dynamic = "force-dynamic";

/** Today / this week / last 7 days for the overview page; `?user=<id>` limits it to that user's devices, `?today=1` lets the 7-day window end today instead of yesterday. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const userParam = params.get("user");
  const userId = userParam && userParam !== "all" ? Number(userParam) : null;
  const devices = listDevicesLabeled().filter((d) => userId == null || d.userId === userId);
  const stats = shortTermStats(devices.map((d) => d.serial), undefined, params.get("today") === "1", clampInt(params.get("week_start"), 1, 7, 1));
  return json({ ...stats, devices: devices.map((d) => ({ serial: d.serial, name: d.name, color: d.color })) });
}
