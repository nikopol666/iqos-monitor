import { notFound } from "next/navigation";
import { deviceOverview, eventPage, getDevice, latestSnapshot, recentLiveSamples } from "@/lib/queries";
import { DeviceClient } from "@/components/device-client";

export default async function DevicePage({ params }: PageProps<"/devices/[serial]">) {
  const { serial } = await params;
  const device = getDevice(serial);
  if (!device) notFound();
  const snapshot = latestSnapshot(serial);
  return (
    <DeviceClient
      initial={deviceOverview(device)}
      snapshot={
        snapshot
          ? {
              collectedUtc: snapshot.collectedUtc,
              values: JSON.parse(snapshot.valuesJson) as Record<string, string | number | null>,
              statuses: JSON.parse(snapshot.statusesJson) as Record<string, string>,
            }
          : null
      }
      firstPage={eventPage(serial, 0, 100, undefined, true)}
      totalAll={eventPage(serial, 0, 1).total}
      samples={recentLiveSamples(serial, 40)}
    />
  );
}
