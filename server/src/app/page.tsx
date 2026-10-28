import { listDevicesLabeled, overview } from "@/lib/queries";
import { shortTermStats } from "@/lib/shortterm";
import { OverviewClient } from "@/components/overview-client";
import { ShortTermClient } from "@/components/shortterm-client";

export default async function OverviewPage() {
  const devices = overview();
  const labeled = listDevicesLabeled();
  const stats = shortTermStats(labeled.map((d) => d.serial));
  const week = devices.length ? <ShortTermClient initial={{ ...stats, devices: labeled.map((d) => ({ serial: d.serial, name: d.name, color: d.color })) }} /> : null;
  return <OverviewClient initial={devices} middle={week} />;
}
