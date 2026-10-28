import { authenticateAgent, unauthorized } from "@/lib/auth";
import { badRequest, json, readJson, validSerial } from "@/lib/api";
import { ensureDevice, saveSnapshot, type IncomingSnapshot } from "@/lib/ingest";

export async function POST(request: Request, ctx: RouteContext<"/api/agent/devices/[serial]/snapshot">) {
  const identity = authenticateAgent(request);
  if (!identity) return unauthorized();
  const { serial } = await ctx.params;
  if (!validSerial(serial)) return badRequest("invalid serial");
  const body = await readJson<IncomingSnapshot>(request);
  if (!body || typeof body !== "object") return badRequest("invalid json");
  ensureDevice(serial);
  saveSnapshot(serial, body);
  return json({ ok: true });
}
