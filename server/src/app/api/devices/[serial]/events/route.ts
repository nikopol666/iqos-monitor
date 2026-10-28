import { badRequest, clampInt, json, notFound, validSerial } from "@/lib/api";
import { eventPage, getDevice } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET(request: Request, ctx: RouteContext<"/api/devices/[serial]/events">) {
  const { serial } = await ctx.params;
  if (!validSerial(serial)) return badRequest("invalid serial");
  if (!getDevice(serial)) return notFound();
  const url = new URL(request.url);
  const offset = clampInt(url.searchParams.get("offset"), 0, 10_000_000, 0);
  const limit = clampInt(url.searchParams.get("limit"), 1, 500, 100);
  const status = url.searchParams.get("status") || undefined;
  return json(eventPage(serial, offset, limit, status));
}
