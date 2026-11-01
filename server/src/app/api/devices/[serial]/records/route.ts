import { badRequest, json, notFound, readJson, validSerial } from "@/lib/api";
import { getDevice } from "@/lib/queries";
import { removeRecord, restoreRecord } from "@/lib/ingest";

export const dynamic = "force-dynamic";

/** POST {event_id, action: "delete" | "block" | "restore"} – remove a faulty record or let it come back. */
export async function POST(request: Request, ctx: RouteContext<"/api/devices/[serial]/records">) {
  const { serial } = await ctx.params;
  if (!validSerial(serial)) return badRequest("invalid serial");
  if (!getDevice(serial)) return notFound();
  const body = await readJson<{ event_id?: number; action?: string }>(request);
  const eventId = Number(body?.event_id);
  if (!body || !Number.isInteger(eventId) || eventId < 0) return badRequest("event_id required");
  if (body.action === "delete") removeRecord(serial, eventId, "deleted");
  else if (body.action === "block") removeRecord(serial, eventId, "blocked");
  else if (body.action === "restore") restoreRecord(serial, eventId);
  else return badRequest("action must be delete, block or restore");
  return json({ ok: true });
}
