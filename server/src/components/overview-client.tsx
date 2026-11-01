"use client";

import Link from "next/link";
import { memo, useEffect, useRef, useState } from "react";
import { BatteryCharging, BatteryMedium, Cable, Usb } from "lucide-react";
import type { DeviceOverview } from "@/lib/queries";
import { useFormat, useI18n } from "@/lib/i18n/client";
import { Badge, Empty } from "@/components/ui";
import { DeviceImage } from "@/components/device-image";
import { ShortTermClient, type ShortTermPayload } from "@/components/shortterm-client";
import { colorCss } from "@/lib/palette";
import { EtaTracker, formatEta } from "@/lib/eta";

export const OVERVIEW_USER_COOKIE = "overview_user";
export type OverviewUser = number | "all";

interface UserOpt {
  id: number;
  name: string;
  color: string;
}

/**
 * One person's overview: their connected devices, their week, their devices.
 * The chosen user is kept in a cookie so the next visit (and the server
 * render) starts on the same person. "All" exists for unassigned devices.
 */
export function OverviewClient({ initial, users, initialUser, week, includeToday }: { initial: DeviceOverview[]; users: UserOpt[]; initialUser: OverviewUser; week: ShortTermPayload | null; includeToday: boolean }) {
  const { t } = useI18n();
  const [devices, setDevices] = useState(initial);
  const [userId, setUserId] = useState<OverviewUser>(initialUser);
  const [stale, setStale] = useState(false);
  const [etas, setEtas] = useState<Record<string, number | null>>({});
  const trackers = useRef(new Map<string, EtaTracker>());

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
        const nextEtas: Record<string, number | null> = {};
        for (const d of data.devices) {
          let tr = trackers.current.get(d.serial);
          if (!tr) trackers.current.set(d.serial, (tr = new EtaTracker()));
          const e = tr.update(d.sync?.done, d.sync?.total, !!d.sync?.total);
          if (e != null) nextEtas[d.serial] = e;
        }
        setEtas((prev) => (JSON.stringify(prev) === JSON.stringify(nextEtas) ? prev : nextEtas));
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

  function choose(next: OverviewUser) {
    setUserId(next);
    rememberUser(next);
  }

  if (!devices.length) return <Empty>{t.overview.empty}</Empty>;
  const unassigned = devices.some((d) => !d.user);
  const shown = userId === "all" ? devices : devices.filter((d) => d.user?.id === userId);
  const connected = shown.filter((d) => d.connected);
  const chips: { key: OverviewUser; label: string; color: string | null }[] = [
    ...users.map((u) => ({ key: u.id as OverviewUser, label: u.name, color: u.color })),
    ...(users.length > 1 || unassigned ? [{ key: "all" as OverviewUser, label: t.common.all, color: null }] : []),
  ];

  return (
    <div className={`space-y-6 transition-opacity ${stale ? "opacity-60" : ""}`}>
      {chips.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-text-2">{t.overview.showFor}</span>
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t.overview.showFor}>
            {chips.map((c) => (
              <button
                key={String(c.key)}
                type="button"
                role="radio"
                aria-checked={userId === c.key}
                onClick={() => choose(c.key)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors ${userId === c.key ? "border-accent bg-accent text-accent-ink" : "border-border bg-surface hover:border-accent"}`}
              >
                {c.color ? <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: c.color }} aria-hidden /> : null}
                {c.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {!shown.length ? <Empty>{t.overview.empty}</Empty> : null}
      {connected.length ? (
        <section className="space-y-3">
          <h1 className="text-xl font-semibold">{t.overview.connectedNow}</h1>
          <div className="grid gap-4 md:grid-cols-2">
            {connected.map((d) => (
              <DeviceCard key={d.serial} d={d} eta={etas[d.serial] ?? null} />
            ))}
          </div>
        </section>
      ) : null}
      {shown.length ? <ShortTermClient key={String(userId)} initial={userId === initialUser ? week : null} userId={userId} initialIncludeToday={includeToday} /> : null}
      {shown.length ? (
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">{t.overview.allDevices}</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {shown.map((d) => (
              <DeviceCard key={d.serial} d={d} eta={etas[d.serial] ?? null} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/** Cookie so the server renders the same person next time. */
function rememberUser(next: OverviewUser): void {
  try {
    document.cookie = `${OVERVIEW_USER_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    /* cookie blocked: the choice lasts for this page only */
  }
}

const DeviceCard = memo(function DeviceCard({ d, eta }: { d: DeviceOverview; eta: number | null }) {
  const { t, f } = useI18n();
  const fmt = useFormat();
  const brightness = d.brightness == null ? "—" : d.brightness === 0x64 ? t.overview.brightnessHigh : d.brightness === 0x1e ? t.overview.brightnessLow : `${d.brightness}`;
  const perStick = d.today.sessions ? fmt.number(Math.round((d.today.puffs / d.today.sessions) * 10) / 10) : "—";
  const tiles = (
    <>
      {d.connected ? (
        <Metric
          label={d.charging != null ? (d.charging ? t.overview.charging : t.overview.charged) : t.overview.battery}
          value={d.lifetime.battery == null ? "—" : `${d.lifetime.battery} %`}
          icon={d.charging ? <BatteryCharging size={16} aria-hidden className="anim-bolt text-good" /> : <BatteryMedium size={16} aria-hidden className="text-good" />}
        />
      ) : (
        <Metric
          label={t.overview.lastSeenLabel}
          value={<span className="text-sm font-medium">{d.live?.disconnectedUtc ? fmt.dateTime(d.live.disconnectedUtc) : d.lastSeenUtc ? fmt.dateTime(d.lastSeenUtc) : "—"}</span>}
          icon={<Cable size={16} aria-hidden className="text-muted" />}
        />
      )}
      <Metric label={t.overview.sticksToday} value={fmt.integer(d.today.sessions)} />
      <Metric label={t.overview.puffsToday} value={fmt.integer(d.today.puffs)} />
      <Metric label={t.overview.puffsPerStickToday} value={perStick} />
    </>
  );
  return (
    <Link
      href={`/devices/${d.serial}`}
      className="ui-card relative block overflow-hidden p-4 transition-colors hover:border-accent sm:p-5"
      style={{ borderTopColor: colorCss(d.color), borderTopWidth: 3 }}
    >
      <div className="flex gap-3 sm:gap-4">
        <DeviceImage variant={d.variant} color={d.color} name={d.name} size={150} connected={d.connected} syncing={!!d.sync} charging={d.charging} battery={d.lifetime.battery} className="hidden sm:flex" />
        <DeviceImage variant={d.variant} color={d.color} name={d.name} size={96} connected={d.connected} syncing={!!d.sync} charging={d.charging} battery={d.lifetime.battery} className="sm:hidden" />
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
          <div className="mt-3 hidden grid-cols-2 gap-2 text-sm sm:grid">{tiles}</div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:hidden">{tiles}</div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-2">
        <span>
          {t.overview.lifetime}: {f(t.overview.todaySticks, { n: fmt.integer(d.lifetime.sticks) })} · {f(t.overview.todayPuffs, { n: fmt.integer(d.lifetime.puffs) })}
          {d.lifetime.seconds != null ? ` · ${fmt.number(Math.round((d.lifetime.seconds / 3600) * 10) / 10)} h` : ""}
        </span>
        {d.connected ? (
          <span>
            {t.overview.brightness}: {brightness}
          </span>
        ) : null}
        {!d.connected ? (
          <span className="text-muted">
            {d.live?.disconnectedUtc ? f(t.overview.offlineSince, { time: fmt.dateTime(d.live.disconnectedUtc) }) : d.lastSeenUtc ? f(t.overview.lastSeen, { time: fmt.dateTime(d.lastSeenUtc) }) : t.overview.neverConnected}
          </span>
        ) : null}
        {d.sync ? (
          <span className="text-accent">
            {d.sync.total ? f(t.overview.syncing, { done: d.sync.done, total: d.sync.total }) : `${t.overview.syncingShort} · ${d.sync.done}`}
            {d.sync.total ? ` · ${Math.min(100, Math.round((d.sync.done / d.sync.total) * 100))} %` : ""}
            {eta != null ? ` · ${f(t.overview.etaLeft, { time: formatEta(eta) })}` : ""}
          </span>
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
