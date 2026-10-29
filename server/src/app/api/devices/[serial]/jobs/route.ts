import { eq } from "drizzle-orm";
import { badRequest, json, notFound, readJson, validSerial } from "@/lib/api";
import { createJob, latestJob, openFullHistoryJob, updateJob } from "@/lib/ingest";
import { getDevice } from "@/lib/queries";
import { getDb, schema } from "@/db";

export const dynamic = "force-dynamic";

/** Web UI: queue a "download full history" job for the device. */
export async function POST(request: Request, ctx: RouteContext<"/api/devices/[serial]/jobs">) {
  const { serial } = await ctx.params;
  if (!validSerial(serial)) return badRequest("invalid serial");
  if (!getDevice(serial)) return notFound();
  const body = (await readJson<{ type?: string }>(request)) ?? {};
  if (body.type && body.type !== "full_history") return badRequest("unsupported job type");
  const job = createJob(serial, "full_history");
  return json({ ok: true, job });
}

export async function GET(_request: Request, ctx: RouteContext<"/api/devices/[serial]/jobs">) {
  const { serial } = await ctx.params;
  if (!validSerial(serial)) return badRequest("invalid serial");
  const jobs = getDb().select().from(schema.agentJobs).where(eq(schema.agentJobs.serial, serial)).orderBy(schema.agentJobs.id).all();
  return json({ jobs, latest: latestJob(serial) ?? null });
}

/** Cancel the open job (agent sees status 'cancelled' on its next heartbeat). */
export async function DELETE(_request: Request, ctx: RouteContext<"/api/devices/[serial]/jobs">) {
  const { serial } = await ctx.params;
  if (!validSerial(serial)) return badRequest("invalid serial");
  const job = openFullHistoryJob(serial);
  if (!job) return notFound("no open job");
  return json({ ok: true, job: updateJob(job.id, { status: "cancelled" }) });
}
