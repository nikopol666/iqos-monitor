"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { DeviceOverview } from "@/lib/queries";
import { colorCss } from "@/lib/palette";
import { variantImage } from "@/lib/variants";
import { useI18n } from "@/lib/i18n/client";
import { ArrowDownUp } from "lucide-react";

/** Header strip: every connected device as a small animated badge (polls every 2 s). */
export function ConnectedStrip() {
  const { t, f } = useI18n();
  const [devices, setDevices] = useState<DeviceOverview[]>([]);

  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/live", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { devices: DeviceOverview[] };
        if (!active) return;
        const next = data.devices.filter((d) => d.connected);
        setDevices((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
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
    <div className="w-full overflow-x-auto [scrollbar-width:none]">
      <div className="mx-auto flex w-max max-w-full items-center gap-1.5">
      {devices.map((d) => {
        return (
          <Link
            key={d.serial}
            href={`/devices/${d.serial}`}
            className="anim-pop flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border border-border bg-surface-2 py-0.5 pl-1 pr-2.5 text-xs hover:border-accent"
            title={`${d.name} · ${t.overview.connected}`}
          >
            <span className="relative flex h-7 w-5 items-end justify-center">
              <span className="anim-breathe absolute inset-0 rounded-full blur-md" style={{ background: colorCss(d.color) }} aria-hidden />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={variantImage(d.variant)} alt="" className="relative h-7 w-auto object-contain" draggable={false} />
            </span>
            <span className="hidden max-w-[8rem] truncate sm:inline lg:hidden xl:inline xl:max-w-[12rem]">{d.name}</span>
            {d.sync ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-1.5 py-0.5 text-accent" title={d.sync.total ? f(t.overview.syncing, { done: d.sync.done, total: d.sync.total }) : t.overview.syncingShort}>
                <ArrowDownUp size={12} className="anim-transfer" aria-hidden />
                <span className="tabular">{d.sync.total ? `${Math.min(100, Math.round((d.sync.done / d.sync.total) * 100))} %` : d.sync.done}</span>
              </span>
            ) : (
              <span className="anim-pulse-dot h-2 w-2 rounded-full bg-good" aria-hidden />
            )}
          </Link>
        );
      })}
      </div>
    </div>
  );
}
