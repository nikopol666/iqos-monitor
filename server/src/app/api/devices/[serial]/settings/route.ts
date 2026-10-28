import { and, desc, eq, inArray } from "drizzle-orm";
import { badRequest, json, notFound, readJson, validSerial } from "@/lib/api";
import { createJob } from "@/lib/ingest";
import { getDevice, latestSnapshot } from "@/lib/queries";
import { getDb, schema } from "@/db";

export const dynamic = "force-dynamic";

/** Settings the agent can write with frames verified from the official app. */
const WRITABLE: Record<string, string[]> = {
  flexpuff: ["on", "off"],
  brightness: ["low", "high"],
  autostart: ["on", "off"],
};

export interface SettingsView {
  model: string | null;
  readAtUtc: string | null;
  values: { flexpuff: string | null; brightness: string | null; autostart: string | null; smart_gesture: string | null; pause_mode: string | null };
  statuses: Record<string, string>;
  jobs: { id: number; setting: string; value: string; status: string; message: string | null; updatedUtc: string }[];
}

function onOff(v: unknown): string | null {
  return v === true ? "on" : v === false ? "off" : null;
}

export function settingsView(serial: string): SettingsView {
  const snap = latestSnapshot(serial);
  const values = snap ? (JSON.parse(snap.valuesJson) as Record<string, unknown>) : {};
  const statuses = snap ? (JSON.parse(snap.statusesJson) as Record<string, string>) : {};
  const level = typeof values.brightness_level === "number" ? values.brightness_level : null;
  const jobs = getDb()
    .select()
    .from(schema.agentJobs)
    .where(and(eq(schema.agentJobs.serial, serial), eq(schema.agentJobs.type, "set_setting"), inArray(schema.agentJobs.status, ["queued", "running", "done", "failed"])))
    .orderBy(desc(schema.agentJobs.id))
    .limit(6)
    .all()
    .map((j) => {
      const p = (j.payloadJson ? JSON.parse(j.payloadJson) : {}) as { setting?: string; value?: string };
      return { id: j.id, setting: p.setting ?? "", value: p.value ?? "", status: j.status, message: j.message, updatedUtc: j.updatedUtc };
    });
  return {
    model: typeof values.model === "string" ? values.model : null,
    readAtUtc: snap?.collectedUtc ?? null,
    values: {
      flexpuff: onOff(values.flexpuff_enabled),
      brightness: level === 0x64 ? "high" : level === 0x1e ? "low" : null,
      autostart: onOff(values.autostart_enabled),
      smart_gesture: onOff(values.smart_gesture_enabled),
      pause_mode: onOff(values.pause_mode_enabled),
    },
    statuses,
    jobs,
  };
}

export async function GET(_request: Request, ctx: RouteContext<"/api/devices/[serial]/settings">) {
  const { serial } = await ctx.params;
  if (!validSerial(serial)) return badRequest("invalid serial");
  if (!getDevice(serial)) return notFound();
  return json(settingsView(serial));
}

/** POST {setting, value} → queues a set_setting job for the agent. */
export async function POST(request: Request, ctx: RouteContext<"/api/devices/[serial]/settings">) {
  const { serial } = await ctx.params;
  if (!validSerial(serial)) return badRequest("invalid serial");
  if (!getDevice(serial)) return notFound();
  const body = await readJson<{ setting?: string; value?: string }>(request);
  const setting = body?.setting ?? "";
  const value = String(body?.value ?? "").toLowerCase();
  if (!(setting in WRITABLE) || !WRITABLE[setting].includes(value)) return badRequest("unsupported setting or value");
  const job = createJob(serial, "set_setting", { setting, value });
  return json({ ok: true, job });
}
