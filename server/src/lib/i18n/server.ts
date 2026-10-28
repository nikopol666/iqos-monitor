import { cookies, headers } from "next/headers";
import { LOCALE_COOKIE, getDictionary, resolveLocale, type Dictionary } from "./index";

export async function getLocale(): Promise<string> {
  const cookieStore = await cookies();
  const headerStore = await headers();
  return resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value, headerStore.get("accept-language"));
}

export async function getT(): Promise<{ locale: string; t: Dictionary }> {
  const locale = await getLocale();
  return { locale, t: getDictionary(locale) };
}
