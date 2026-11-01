import { cookies } from "next/headers";
import { listDevicesLabeled, listUsers, overview } from "@/lib/queries";
import { shortTermStats } from "@/lib/shortterm";
import { OverviewClient, OVERVIEW_USER_COOKIE, type OverviewUser } from "@/components/overview-client";
import { SHORT_TODAY_COOKIE } from "@/components/shortterm-client";

/**
 * The overview is one person's page: it shows that user's devices and week.
 * The choice is remembered in a cookie so the server renders the right user
 * straight away; other pages keep their own user filters.
 */
export default async function OverviewPage() {
  const devices = overview();
  const users = listUsers().map((u) => ({ id: u.id, name: u.name, color: u.color }));
  const store = await cookies();
  const raw = store.get(OVERVIEW_USER_COOKIE)?.value;
  const includeToday = store.get(SHORT_TODAY_COOKIE)?.value === "1";
  let selected: OverviewUser = "all";
  if (raw === "all") selected = "all";
  else if (raw && users.some((u) => u.id === Number(raw))) selected = Number(raw);
  else if (users.length === 1) selected = users[0].id;
  else if (users.length > 1) selected = devices.find((d) => d.connected && d.user)?.user?.id ?? users[0].id;
  const labeled = listDevicesLabeled().filter((d) => selected === "all" || d.userId === selected);
  const stats = shortTermStats(labeled.map((d) => d.serial), undefined, includeToday);
  const week = { ...stats, devices: labeled.map((d) => ({ serial: d.serial, name: d.name, color: d.color })) };
  return <OverviewClient initial={devices} users={users} initialUser={selected} week={week} includeToday={includeToday} />;
}
