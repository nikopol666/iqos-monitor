import { listDevicesLabeled as listDevices, listUsers } from "@/lib/queries";
import { StatsClient } from "@/components/stats-client";
import { addDays, todayKey } from "@/lib/time";

export default async function StatsPage() {
  const devices = listDevices().map((d) => ({ serial: d.serial, name: d.name, userId: d.userId, color: d.color }));
  const users = listUsers().map((u) => ({ id: u.id, name: u.name, color: u.color }));
  const today = todayKey();
  return <StatsClient devices={devices} users={users} defaultFrom={addDays(today, -89)} defaultTo={today} />;
}
