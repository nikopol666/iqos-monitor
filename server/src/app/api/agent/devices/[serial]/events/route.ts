import { authenticateAgent, unauthorized } from "@/lib/auth";
import { badRequest, json, readJson, validSerial } from "@/lib/api";
import { ensureDevice, ingestEvents, setAckedNextIndex, type IncomingEvent } from "@/lib/ingest";

interface EventsBody {
  events?: IncomingEvent[];
  /** Device metadata next_index observed by the agent during this sync. */
  next_index?: number | null;
  /** True when the agent finished covering [lowest, next_index) without gaps. */
  range_complete?: boolean;
}

export async function POST(request: Request, ctx: RouteContext<"/api/agent/devices/[serial]/events">) {
  const identity = authenticateAgent(request);
  if (!identity) return unauthorized();
  const { serial } = await ctx.params;
  if (!validSerial(serial)) return badRequest("invalid serial");
  const body = await readJson<EventsBody>(request);
  if (!body || !Array.isArray(body.events)) return badRequest("events[] required");
  if (body.events.length > 500) return badRequest("max 500 events per batch");
  ensureDevice(serial);
  const result = ingestEvents(serial, body.events);
  if (body.range_complete && typeof body.next_index === "number" && body.next_index > 0) {
    setAckedNextIndex(serial, body.next_index);
  }
  return json({ ok: true, ...result });
}
