"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { DeviceOverview } from "@/lib/queries";
import { colorCss } from "@/lib/palette";
import { variantImage } from "@/lib/variants";
import { useI18n } from "@/lib/i18n/client";

/** Header strip: every connected device as a small animated badge (polls every 2 s). */
export function ConnectedStrip() {
  const { t } = useI18n();
  const [devices, setDevices] = useState<DeviceOverview[]>([]);

  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/live", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { devices: DeviceOverview[] };
        if (active) setDevices(data.devices.filter((d) => d.connected));
      } catch {
        /* keep last */
      }
    };
    void tick();
    const id = setInterval(tick, 2000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  if (!devices.length) return null;
  return (
    <div className="flex items-center gap-1.5">
      {devices.map((d) => {
        const level = d.lifetime.battery;
        const tone = level == null ? "var(--muted)" : level <= 15 ? "var(--critical)" : level <= 35 ? "var(--warning)" : "var(--good)";
        return (
          <Link
            key={d.serial}
            href={`/devices/${d.serial}`}
            className="anim-pop flex items-center gap-2 rounded-full border border-border bg-surface-2 py-0.5 pl-1 pr-2.5 text-xs hover:border-accent"
            title={`${d.name} · ${t.overview.connected}${level != null ? ` · ${level} %` : ""}`}
          >
            <span className="relative flex h-7 w-5 items-end justify-center">
              <span className="anim-breathe absolute inset-0 rounded-full blur-md" style={{ background: colorCss(d.color) }} aria-hidden />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={variantImage(d.variant)} alt="" className="relative h-7 w-auto object-contain" draggable={false} />
            </span>
            <span className="hidden max-w-[10rem] truncate md:inline">{d.name}</span>
            <span className="relative hidden h-1.5 w-8 overflow-hidden rounded-full bg-border sm:block" aria-hidden>
              <span className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700" style={{ width: `${level ?? 0}%`, background: tone }} />
              <span className="anim-sheen absolute inset-y-0 w-1/3" />
            </span>
            <span className="tabular">{level == null ? "—" : `${level} %`}</span>
            <span className="anim-pulse-dot h-2 w-2 rounded-full bg-good" aria-hidden />
          </Link>
        );
      })}
    </div>
  );
}
