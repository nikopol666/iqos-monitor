import { eq } from "drizzle-orm";
import { badRequest, json, notFound, readJson } from "@/lib/api";
import { getDb, nowUtc, schema } from "@/db";
import { listUsers } from "@/lib/queries";

export const dynamic = "force-dynamic";

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export async function GET() {
  return json({ users: listUsers() });
}

export async function POST(request: Request) {
  const body = await readJson<{ name?: string; color?: string }>(request);
  const name = body?.name?.trim();
  if (!name || name.length > 60) return badRequest("name required");
  const color = body?.color && COLOR_RE.test(body.color) ? body.color : "#2563eb";
  const user = getDb().insert(schema.users).values({ name, color, createdAtUtc: nowUtc() }).returning().get();
  return json({ ok: true, user });
}

export async function PATCH(request: Request) {
  const body = await readJson<{ id?: number; name?: string; color?: string }>(request);
  if (!body || !Number.isInteger(body.id)) return badRequest("id required");
  const patch: Partial<schema.User> = {};
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim().slice(0, 60);
  if (typeof body.color === "string" && COLOR_RE.test(body.color)) patch.color = body.color;
  if (!Object.keys(patch).length) return badRequest("nothing to update");
  const db = getDb();
  db.update(schema.users).set(patch).where(eq(schema.users.id, body.id!)).run();
  const user = db.select().from(schema.users).where(eq(schema.users.id, body.id!)).get();
  if (!user) return notFound();
  return json({ ok: true, user });
}

export async function DELETE(request: Request) {
  const body = await readJson<{ id?: number }>(request);
  if (!body || !Number.isInteger(body.id)) return badRequest("id required");
  const db = getDb();
  db.update(schema.devices).set({ userId: null }).where(eq(schema.devices.userId, body.id!)).run();
  db.delete(schema.users).where(eq(schema.users.id, body.id!)).run();
  return json({ ok: true });
}
