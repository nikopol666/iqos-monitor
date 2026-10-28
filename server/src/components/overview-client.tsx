"use client";

import Link from "next/link";
import { memo, useEffect, useState } from "react";
import { BatteryCharging, BatteryMedium, Cable, Sun, Usb } from "lucide-react";
import type { DeviceOverview } from "@/lib/queries";
import { useFormat, useI18n } from "@/lib/i18n/client";
import { Badge, Empty } from "@/components/ui";
import { DeviceImage } from "@/components/device-image";
import { colorCss } from "@/lib/palette";

export function OverviewClient({ initial, middle }: { initial: DeviceOverview[]; middle?: React.ReactNode }) {
  const { t } = useI18n();
  const [devices, setDevices] = useState(initial);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let active = true;
    let last = JSON.stringify(initial);
    const tick = async () => {
      try {
        const res = await fetch("/api/live", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { devices: DeviceOverview[] };
        if (!active) return;
        const next = JSON.stringify(data.devices);
        // Only re-render when something actually changed.
        if (next !== last) {
          last = next;
          setDevices(data.devices);
        }
        setStale(false);
      } catch {
        if (active) setStale(true);
      }
    };
    const id = setInterval(tick, 1000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [initial]);

  if (!devices.length) return <Empty>{t.overview.empty}</Empty>;
  const connected = devices.filter((d) => d.connected);

  return (
    <div className={`space-y-6 transition-opacity ${stale ? "opacity-60" : ""}`}>
      {connected.length ? (
        <section className="space-y-3">
          <h1 className="text-xl font-semibold">{t.overview.connectedNow}</h1>
          <div className="grid gap-4 md:grid-cols-2">
            {connected.map((d) => (
              <DeviceCard key={d.serial} d={d} />
            ))}
          </div>
        </section>
      ) : null}
      {middle}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">{t.overview.allDevices}</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {devices.map((d) => (
            <DeviceCard key={d.serial} d={d} />
          ))}
        </div>
      </section>
    </div>
  );
}

const DeviceCard = memo(function DeviceCard({ d }: { d: DeviceOverview }) {
  const { t, f } = useI18n();
  const fmt = useFormat();
  const brightness = d.brightness == null ? "—" : d.brightness === 0x64 ? t.overview.brightnessHigh : d.brightness === 0x1e ? t.overview.brightnessLow : `${d.brightness}`;
  return (
    <Link
      href={`/devices/${d.serial}`}
      className="ui-card relative block overflow-hidden p-4 transition-colors hover:border-accent sm:p-5"
      style={{ borderTopColor: colorCss(d.color), borderTopWidth: 3 }}
    >
      <div className="flex gap-3 sm:gap-4">
        <DeviceImage variant={d.variant} color={d.color} name={d.name} size={150} connected={d.connected} battery={d.lifetime.battery} className="hidden sm:flex" />
        <DeviceImage variant={d.variant} color={d.color} name={d.name} size={110} connected={d.connected} battery={d.lifetime.battery} className="sm:hidden" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-block h-3 w-3 rounded-full" style={{ background: colorCss(d.color) }} aria-hidden />
                <span className="break-words text-base font-semibold leading-tight sm:text-lg">{d.name}</span>
                {d.user ? (
                  <span className="inline-flex items-center gap-1 text-xs text-text-2">
                    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: d.user.color }} aria-hidden />
                    {d.user.name}
                  </span>
                ) : (
                  <span className="text-xs text-muted">{t.common.unassigned}</span>
                )}
              </div>
              <div className="font-mono text-xs text-muted">{d.serial}</div>
            </div>
            {d.connected ? (
              <Badge tone="good">
                <Usb size={12} aria-hidden /> {t.overview.connected}
              </Badge>
            ) : (
              <Badge>
                <Cable size={12} aria-hidden /> {t.overview.offline}
              </Badge>
            )}
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 text-sm min-[420px]:grid-cols-2">
            <Metric
              label={d.connected && d.charging != null ? (d.charging ? t.overview.charging : t.overview.charged) : t.overview.battery}
              value={d.lifetime.battery == null ? "—" : `${d.lifetime.battery} %`}
              icon={d.connected && d.charging ? <BatteryCharging size={16} aria-hidden className="text-good" /> : <BatteryMedium size={16} aria-hidden className={d.connected ? "text-good" : "text-muted"} />}
            />
            <Metric label={t.overview.brightness} value={brightness} icon={<Sun size={16} aria-hidden className={d.connected ? "text-good" : "text-muted"} />} />
            <Metric label={t.overview.lifetimeSticks} value={fmt.integer(d.lifetime.sticks)} />
            <Metric label={t.overview.lifetimePuffs} value={fmt.integer(d.lifetime.puffs)} />
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-2">
        <span>
          {t.overview.today}: {f(t.overview.todaySticks, { n: fmt.integer(d.today.sessions) })} · {f(t.overview.todayPuffs, { n: fmt.integer(d.today.puffs) })}
        </span>
        {d.lifetime.seconds != null ? (
          <span>
            {t.overview.lifetimeHours}: {fmt.number(Math.round((d.lifetime.seconds / 3600) * 10) / 10)} h
          </span>
        ) : null}
        {!d.connected ? (
          <span className="text-muted">
            {d.live?.disconnectedUtc ? f(t.overview.offlineSince, { time: fmt.dateTime(d.live.disconnectedUtc) }) : d.lastSeenUtc ? f(t.overview.lastSeen, { time: fmt.dateTime(d.lastSeenUtc) }) : t.overview.neverConnected}
          </span>
        ) : null}
        {d.sync ? (
          <span className="text-accent">{d.sync.total ? f(t.overview.syncing, { done: d.sync.done, total: d.sync.total }) : `${t.overview.syncingShort} · ${d.sync.done}`}</span>
        ) : d.job ? (
          <span className="text-accent">{t.device.jobQueued}</span>
        ) : null}
      </div>
    </Link>
  );
});

function Metric({ label, value, icon }: { label: string; value: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2">
      <div className="flex items-center gap-1.5 text-xs text-text-2">
        {icon}
        {label}
      </div>
      <div className="tabular mt-0.5 text-base font-semibold">{value}</div>
    </div>
  );
}
