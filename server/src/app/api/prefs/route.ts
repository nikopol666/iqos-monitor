import { cookies } from "next/headers";
import { badRequest, json, readJson } from "@/lib/api";
import { WEEK_START_COOKIE, isWeekStart } from "@/lib/prefs";

export const dynamic = "force-dynamic";

/** POST {week_start: 1..7 | null}; null clears the override (language default). */
export async function POST(request: Request) {
  const body = await readJson<{ week_start?: number | null }>(request);
  if (!body) return badRequest("invalid json");
  const store = await cookies();
  if (body.week_start == null) {
    store.delete(WEEK_START_COOKIE);
    return json({ ok: true, week_start: null });
  }
  if (!isWeekStart(body.week_start)) return badRequest("week_start must be 1..7");
  store.set(WEEK_START_COOKIE, String(body.week_start), { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  return json({ ok: true, week_start: body.week_start });
}
