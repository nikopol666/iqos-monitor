import { badRequest, clampInt, json, notFound, validSerial } from "@/lib/api";
import { getDevice, listSnapshots } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** Diagnostics snapshots (taken on connect and after every setting change), newest first. */
export async function GET(request: Request, ctx: RouteContext<"/api/devices/[serial]/snapshots">) {
  const { serial } = await ctx.params;
  if (!validSerial(serial)) return badRequest("invalid serial");
  if (!getDevice(serial)) return notFound();
  const limit = clampInt(new URL(request.url).searchParams.get("limit"), 1, 500, 100);
  const rows = listSnapshots(serial, limit).map((s) => ({
    id: s.id,
    collected_utc: s.collectedUtc,
    values: JSON.parse(s.valuesJson) as Record<string, unknown>,
    statuses: JSON.parse(s.statusesJson) as Record<string, string>,
  }));
  return json({ serial, count: rows.length, snapshots: rows });
}
