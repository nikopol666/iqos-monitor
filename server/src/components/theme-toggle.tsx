"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";

import { THEME_COOKIE, type ThemePref } from "@/lib/theme";

function applyTheme(pref: ThemePref) {
  const root = document.documentElement;
  if (pref === "auto") delete root.dataset.theme;
  else root.dataset.theme = pref;
}

/** Cycles system → light → dark; stored in a cookie so SSR renders the right theme. */
export function ThemeToggle({ initial }: { initial: ThemePref }) {
  const { t } = useI18n();
  const [pref, setPref] = useState<ThemePref>(initial);

  useEffect(() => {
    applyTheme(pref);
  }, [pref]);

  function next() {
    const order: ThemePref[] = ["auto", "light", "dark"];
    const value = order[(order.indexOf(pref) + 1) % order.length];
    setPref(value);
    document.cookie = `${THEME_COOKIE}=${value}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  }

  const label = pref === "light" ? t.settings.themeLight : pref === "dark" ? t.settings.themeDark : t.settings.themeAuto;
  const Icon = pref === "light" ? Sun : pref === "dark" ? Moon : Monitor;
  return (
    <button type="button" className="ui-btn h-8 px-2 text-xs" onClick={next} title={`${t.nav.theme}: ${label}`} aria-label={`${t.nav.theme}: ${label}`}>
      <Icon size={15} aria-hidden />
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}
