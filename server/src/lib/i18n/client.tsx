"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Dictionary } from "./en";
import { fmt } from "./index";

interface I18nValue {
  t: Dictionary;
  locale: string;
  tz: string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ value, children }: { value: I18nValue; children: ReactNode }) {
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue & { f: typeof fmt } {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("I18nProvider missing");
  return { ...ctx, f: fmt };
}

/** Intl formatting helpers bound to the current locale and display zone. */
export function useFormat() {
  const { locale, tz } = useI18n();
  const intlLocale = locale === "cs" ? "cs-CZ" : "en-GB";
  const dateTime = new Intl.DateTimeFormat(intlLocale, { timeZone: tz, dateStyle: "medium", timeStyle: "short" });
  const dateTimeSec = new Intl.DateTimeFormat(intlLocale, { timeZone: tz, dateStyle: "medium", timeStyle: "medium" });
  const date = new Intl.DateTimeFormat(intlLocale, { timeZone: tz, dateStyle: "medium" });
  const shortDate = new Intl.DateTimeFormat(intlLocale, { timeZone: "UTC", day: "numeric", month: "numeric" });
  const time = new Intl.DateTimeFormat(intlLocale, { timeZone: tz, timeStyle: "short" });
  const number = new Intl.NumberFormat(intlLocale, { maximumFractionDigits: 2 });
  const integer = new Intl.NumberFormat(intlLocale, { maximumFractionDigits: 0 });
  return {
    intlLocale,
    dateTime: (iso: string | null | undefined) => (iso ? dateTime.format(new Date(iso)) : "—"),
    dateTimeSec: (iso: string | null | undefined) => (iso ? dateTimeSec.format(new Date(iso)) : "—"),
    date: (iso: string | null | undefined) => (iso ? date.format(new Date(iso)) : "—"),
    dateKey: (key: string) => date.format(new Date(key + "T12:00:00Z")),
    shortDateKey: (key: string) => shortDate.format(new Date(key + "T12:00:00Z")),
    time: (iso: string | null | undefined) => (iso ? time.format(new Date(iso)) : "—"),
    number: (n: number | null | undefined) => (n == null ? "—" : number.format(n)),
    integer: (n: number | null | undefined) => (n == null ? "—" : integer.format(n)),
  };
}
