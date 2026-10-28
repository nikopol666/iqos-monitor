import { eq } from "drizzle-orm";
import { badRequest, json, notFound, readJson, validSerial } from "@/lib/api";
import { getDb, schema } from "@/db";
import { listDevices } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  return json({ devices: listDevices() });
}

/** Rename a device and/or assign it to a user (null = unassigned). */
export async function PATCH(request: Request) {
  const body = await readJson<{ serial?: string; name?: string; user_id?: number | null }>(request);
  if (!body || !validSerial(body.serial)) return badRequest("serial required");
  const db = getDb();
  const patch: Partial<schema.Device> = {};
  if (typeof body.name === "string" && body.name.trim()) patch.name = body.name.trim().slice(0, 60);
  if (body.user_id === null) patch.userId = null;
  else if (Number.isInteger(body.user_id)) {
    const user = db.select().from(schema.users).where(eq(schema.users.id, body.user_id!)).get();
    if (!user) return badRequest("unknown user");
    patch.userId = body.user_id!;
  }
  if (!Object.keys(patch).length) return badRequest("nothing to update");
  db.update(schema.devices).set(patch).where(eq(schema.devices.serial, body.serial)).run();
  const device = db.select().from(schema.devices).where(eq(schema.devices.serial, body.serial)).get();
  if (!device) return notFound();
  return json({ ok: true, device });
}
