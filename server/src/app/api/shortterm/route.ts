import { json } from "@/lib/api";
import { listDevicesLabeled } from "@/lib/queries";
import { shortTermStats } from "@/lib/shortterm";

export const dynamic = "force-dynamic";

/** Today / this week / last 7 days for the overview page. */
export async function GET() {
  const devices = listDevicesLabeled();
  const stats = shortTermStats(devices.map((d) => d.serial));
  return json({ ...stats, devices: devices.map((d) => ({ serial: d.serial, name: d.name, color: d.color })) });
}
