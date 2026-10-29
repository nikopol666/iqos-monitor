import { json } from "@/lib/api";
import { listDevicesLabeled } from "@/lib/queries";
import { shortTermStats } from "@/lib/shortterm";

export const dynamic = "force-dynamic";

/** Today / this week / last 7 days for the overview page; `?user=<id>` limits it to that user's devices. */
export async function GET(request: Request) {
  const userParam = new URL(request.url).searchParams.get("user");
  const userId = userParam && userParam !== "all" ? Number(userParam) : null;
  const devices = listDevicesLabeled().filter((d) => userId == null || d.userId === userId);
  const stats = shortTermStats(devices.map((d) => d.serial));
  return json({ ...stats, devices: devices.map((d) => ({ serial: d.serial, name: d.name, color: d.color })) });
}
