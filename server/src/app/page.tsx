import { listDevicesLabeled, overview } from "@/lib/queries";
import { shortTermStats } from "@/lib/shortterm";
import { OverviewClient } from "@/components/overview-client";
import { ShortTermClient } from "@/components/shortterm-client";

export default async function OverviewPage() {
  const devices = overview();
  const labeled = listDevicesLabeled();
  const stats = shortTermStats(labeled.map((d) => d.serial));
  return (
    <div className="space-y-6">
      <OverviewClient initial={devices} />
      {devices.length ? <ShortTermClient initial={{ ...stats, devices: labeled.map((d) => ({ serial: d.serial, name: d.name, color: d.color })) }} /> : null}
    </div>
  );
}
