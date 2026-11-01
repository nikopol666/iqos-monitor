import { cookies, headers } from "next/headers";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n";
import { WEEK_START_COOKIE, resolveWeekStart, type WeekStart } from "@/lib/prefs";

/** Week start for this request: cookie override, otherwise the language's convention. */
export async function getWeekStart(): Promise<WeekStart> {
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value, (await headers()).get("accept-language"));
  return resolveWeekStart(store.get(WEEK_START_COOKIE)?.value, locale);
}

export async function getWeekStartOverride(): Promise<string | null> {
  return (await cookies()).get(WEEK_START_COOKIE)?.value ?? null;
}
