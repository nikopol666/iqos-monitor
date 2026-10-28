import { eq } from "drizzle-orm";
import { badRequest, json, notFound, readJson, validSerial } from "@/lib/api";
import { getDb, schema } from "@/db";
import { listDevices } from "@/lib/queries";
import { DEVICE_VARIANTS, defaultColorFor, isVariant } from "@/lib/variants";
import { PALETTE, isColorValue } from "@/lib/palette";
import { colorsInUse } from "@/lib/ingest";

export const dynamic = "force-dynamic";

export async function GET() {
  return json({ devices: listDevices(), variants: DEVICE_VARIANTS, palette: PALETTE });
}

/**
 * Rename a device, assign it to a user (null = unassigned), change its finish
 * or chart colour. The colour follows the finish until the user sets one;
 * `reset_color: true` returns to the finish default.
 */
export async function PATCH(request: Request) {
  const body = await readJson<{ serial?: string; name?: string; user_id?: number | null; color?: string; variant?: string; reset_color?: boolean }>(request);
  if (!body || !validSerial(body.serial)) return badRequest("serial required");
  const db = getDb();
  const current = db.select().from(schema.devices).where(eq(schema.devices.serial, body.serial)).get();
  if (!current) return notFound();
  const patch: Partial<schema.Device> = {};
  if (typeof body.name === "string") patch.name = body.name.trim().slice(0, 60);
  if (body.user_id === null) patch.userId = null;
  else if (Number.isInteger(body.user_id)) {
    const user = db.select().from(schema.users).where(eq(schema.users.id, body.user_id!)).get();
    if (!user) return badRequest("unknown user");
    patch.userId = body.user_id!;
  }
  let variant = current.variant;
  if (body.variant !== undefined) {
    if (!isVariant(body.variant)) return badRequest("unknown variant");
    variant = body.variant;
    patch.variant = variant;
    if (!current.colorCustom) patch.color = defaultColorFor(variant, colorsInUse(current.serial));
  }
  if (body.reset_color) {
    patch.color = defaultColorFor(variant, colorsInUse(current.serial));
    patch.colorCustom = 0;
  } else if (body.color !== undefined) {
    if (!isColorValue(body.color)) return badRequest("invalid colour");
    patch.color = body.color;
    patch.colorCustom = body.color === defaultColorFor(variant, colorsInUse(current.serial)) ? 0 : 1;
  }
  if (!Object.keys(patch).length) return badRequest("nothing to update");
  db.update(schema.devices).set(patch).where(eq(schema.devices.serial, body.serial)).run();
  const device = db.select().from(schema.devices).where(eq(schema.devices.serial, body.serial)).get();
  return json({ ok: true, device });
}
