import { authenticateAgent, unauthorized } from "@/lib/auth";
import { badRequest, json, notFound, readJson } from "@/lib/api";
import { updateJob, type JobUpdate } from "@/lib/ingest";

const STATUSES = new Set(["queued", "running", "done", "failed", "cancelled"]);

export async function POST(request: Request, ctx: RouteContext<"/api/agent/jobs/[id]">) {
  const identity = authenticateAgent(request);
  if (!identity) return unauthorized();
  const { id } = await ctx.params;
  const jobId = parseInt(id, 10);
  if (!Number.isInteger(jobId)) return badRequest("invalid id");
  const body = await readJson<JobUpdate>(request);
  if (!body) return badRequest("invalid json");
  if (body.status && !STATUSES.has(body.status)) return badRequest("invalid status");
  const job = updateJob(jobId, body);
  if (!job) return notFound();
  return json({ ok: true, job });
}
