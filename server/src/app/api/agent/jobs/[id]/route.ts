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
  if (!body || typeof body !== "object" || Array.isArray(body)) return badRequest("invalid json");
  if (body.status !== undefined && (typeof body.status !== "string" || !STATUSES.has(body.status))) return badRequest("invalid status");
  if (body.progress_total != null && (typeof body.progress_total !== "number" || !Number.isFinite(body.progress_total))) return badRequest("invalid progress_total");
  if (body.message != null && typeof body.message !== "string") return badRequest("invalid message");
  const job = updateJob(jobId, body);
  if (!job) return notFound();
  return json({ ok: true, job });
}
