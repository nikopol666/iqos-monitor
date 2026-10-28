import { authenticateAgent, unauthorized } from "@/lib/auth";
import { badRequest, json, readJson, validSerial } from "@/lib/api";
import { ensureDevice, updateLive, type IncomingLive } from "@/lib/ingest";

/** One-second live tick while the device is connected (or a disconnect notice). */
export async function POST(request: Request, ctx: RouteContext<"/api/agent/devices/[serial]/live">) {
  const identity = authenticateAgent(request);
  if (!identity) return unauthorized();
  const { serial } = await ctx.params;
  if (!validSerial(serial)) return badRequest("invalid serial");
  const body = await readJson<IncomingLive>(request);
  if (!body || typeof body !== "object") return badRequest("invalid json");
  ensureDevice(serial);
  updateLive(serial, identity.id, body);
  return json({ ok: true });
}
