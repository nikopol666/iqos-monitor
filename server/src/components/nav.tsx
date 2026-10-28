"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Activity, BarChart3, Settings } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { SUPPORTED_LOCALES, DICTIONARIES } from "@/lib/i18n";
import { ThemeToggle } from "@/components/theme-toggle";
import type { ThemePref } from "@/lib/theme";
import { ConnectedStrip } from "@/components/connected-strip";

export function Nav({ override, theme }: { override: string | null; theme: ThemePref }) {
  const { t } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const links = [
    { href: "/", label: t.nav.overview, icon: Activity },
    { href: "/stats", label: t.nav.stats, icon: BarChart3 },
    { href: "/settings", label: t.nav.settings, icon: Settings },
  ];
  async function changeLang(value: string) {
    setBusy(true);
    try {
      await fetch("/api/lang", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ locale: value || null }) });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <header className="sticky top-0 z-20 border-b border-border bg-surface/90 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-3 sm:gap-3 sm:px-6">
        <Link href="/" className="shrink-0 font-semibold tracking-tight">
          <span className="sm:hidden">IQOS</span>
          <span className="hidden sm:inline">{t.app.title}</span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          {links.map(({ href, label, icon: Icon }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 ${active ? "bg-surface-2 text-text" : "text-text-2 hover:text-text"}`}
              >
                <Icon size={16} aria-hidden />
                <span className="hidden sm:inline">{label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="mx-auto min-w-0">
          <ConnectedStrip />
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <ThemeToggle initial={theme} />
          <select
            className="ui-input h-8 w-auto max-w-[6.5rem] text-xs sm:max-w-none"
            value={override ?? ""}
            disabled={busy}
            onChange={(e) => changeLang(e.target.value)}
            aria-label={t.nav.language}
            title={t.nav.language}
          >
            <option value="">{t.settings.languageAuto}</option>
            {SUPPORTED_LOCALES.map((code) => (
              <option key={code} value={code}>
                {DICTIONARIES[code].localeName}
              </option>
            ))}
          </select>
        </div>
      </div>
    </header>
  );
}
