import { eq } from "drizzle-orm";
import { authenticateAgent, unauthorized } from "@/lib/auth";
import { badRequest, json, validSerial } from "@/lib/api";
import { ensureDevice, missingIds } from "@/lib/ingest";
import { getDb, schema } from "@/db";

export const dynamic = "force-dynamic";

const MAX_RANGE = 2_000_000;

/**
 * Sync state for an agent: which archive IDs in [low, high] the server still
 * lacks, plus the range it has acknowledged. The agent holds no database, so
 * this answer decides what it reads from the device. `full=1` (full history
 * download) also re-reads ids the user deleted, never the blocked ones.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/agent/devices/[serial]/sync">) {
  const identity = authenticateAgent(request);
  if (!identity) return unauthorized();
  const { serial } = await ctx.params;
  if (!validSerial(serial)) return badRequest("invalid serial");
  const url = new URL(request.url);
  const fullHistory = url.searchParams.get("full") === "1";
  const low = Number(url.searchParams.get("low") ?? 0);
  const high = Number(url.searchParams.get("high"));
  if (!Number.isInteger(low) || !Number.isInteger(high) || low < 0 || high < low || high > 0xffffff) return badRequest("low/high required");
  if (high - low > MAX_RANGE) return badRequest("range too large");
  ensureDevice(serial);
  const device = getDb().select().from(schema.devices).where(eq(schema.devices.serial, serial)).get();
  return json({
    ok: true,
    acked_next_index: device?.ackedNextIndex ?? null,
    lowest_stored_index: device?.lowestStoredIndex ?? null,
    full_history_complete: !!device?.fullHistoryComplete,
    missing: missingIds(serial, low, high, fullHistory),
  });
}
