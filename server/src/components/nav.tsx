"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { Activity, BarChart3, Settings } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";
import { SUPPORTED_LOCALES, DICTIONARIES } from "@/lib/i18n";

export function Nav({ override }: { override: string | null }) {
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
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="font-semibold tracking-tight">
          {t.app.title}
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
        <div className="ml-auto">
          <label className="flex items-center gap-2 text-xs text-text-2">
            <span className="hidden sm:inline">{t.nav.language}</span>
            <select
              className="ui-input h-8 text-xs"
              value={override ?? ""}
              disabled={busy}
              onChange={(e) => changeLang(e.target.value)}
              aria-label={t.nav.language}
            >
              <option value="">{t.settings.languageAuto}</option>
              {SUPPORTED_LOCALES.map((code) => (
                <option key={code} value={code}>
                  {DICTIONARIES[code].localeName}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </header>
  );
}
