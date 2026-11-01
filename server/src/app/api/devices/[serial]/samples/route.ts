import { badRequest, clampInt, json, notFound, validSerial } from "@/lib/api";
import { getDevice, liveSamplesSince } from "@/lib/queries";

export const dynamic = "force-dynamic";

/**
 * Live samples (one row per change) with the research fields from extra_json
 * flattened, oldest first. `?since=<ISO>` and `?limit=` (max 20000).
 */
export async function GET(request: Request, ctx: RouteContext<"/api/devices/[serial]/samples">) {
  const { serial } = await ctx.params;
  if (!validSerial(serial)) return badRequest("invalid serial");
  if (!getDevice(serial)) return notFound();
  const url = new URL(request.url);
  const since = url.searchParams.get("since");
  const limit = clampInt(url.searchParams.get("limit"), 1, 20000, 5000);
  const rows = liveSamplesSince(serial, since, limit).map((s) => {
    let extra: Record<string, unknown> = {};
    try {
      extra = s.extraJson ? (JSON.parse(s.extraJson) as Record<string, unknown>) : {};
    } catch {
      /* keep empty */
    }
    return { id: s.id, at_utc: s.atUtc, battery: s.battery, stick_state: s.stickState, lifetime_sticks: s.lifetimeSticks, lifetime_puffs: s.lifetimePuffs, ...extra };
  });
  return json({ serial, count: rows.length, samples: rows });
}
