import { cookies } from "next/headers";
import { badRequest, json, readJson } from "@/lib/api";
import { LOCALE_COOKIE, SUPPORTED_LOCALES, hasLocale } from "@/lib/i18n";

export const dynamic = "force-dynamic";

/** POST {locale: "cs" | "en" | null}; null clears the override (browser default). */
export async function POST(request: Request) {
  const body = await readJson<{ locale?: string | null }>(request);
  if (!body) return badRequest("invalid json");
  const store = await cookies();
  if (body.locale === null || body.locale === "") {
    store.delete(LOCALE_COOKIE);
    return json({ ok: true, locale: null });
  }
  if (!hasLocale(body.locale)) return badRequest("unsupported locale", { supported: SUPPORTED_LOCALES });
  store.set(LOCALE_COOKIE, body.locale, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  return json({ ok: true, locale: body.locale });
}
