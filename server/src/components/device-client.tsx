"use client";

import { useEffect, useState } from "react";
import { Download, Usb, Cable, X } from "lucide-react";
import type { DeviceOverview, EventPage } from "@/lib/queries";
import type { LiveSample } from "@/db/schema";
import { useFormat, useI18n } from "@/lib/i18n/client";
import { Badge, Card, CardTitle, Notice } from "@/components/ui";
import { DeviceImage } from "@/components/device-image";
import { DeviceSettings } from "@/components/device-settings";
import type { SettingsView } from "@/app/api/devices/[serial]/settings/route";

interface SnapshotView {
  collectedUtc: string;
  values: Record<string, string | number | null>;
  statuses: Record<string, string>;
}

export function DeviceClient({ initial, snapshot, firstPage, totalAll, samples, settings }: { initial: DeviceOverview; snapshot: SnapshotView | null; firstPage: EventPage; totalAll: number; samples: LiveSample[]; settings: SettingsView }) {
  const { t, f } = useI18n();
  const fmt = useFormat();
  const [d, setD] = useState(initial);
  const [page, setPage] = useState(firstPage);
  const [showInvalid, setShowInvalid] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState(false);

  async function reloadRecords(invalid: boolean) {
    setShowInvalid(invalid);
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/devices/${initial.serial}/events?offset=0&limit=100${invalid ? "" : "&valid=1"}`, { cache: "no-store" });
      setPage((await res.json()) as EventPage);
    } finally {
      setLoadingMore(false);
    }
  }

  // Live refresh of the card (1 s) via the shared overview endpoint.
  useEffect(() => {
    let active = true;
    const id = setInterval(async () => {
      try {
        const res = await fetch("/api/live", { cache: "no-store" });
        const data = (await res.json()) as { devices: DeviceOverview[] };
        const mine = data.devices.find((x) => x.serial === initial.serial);
        if (active && mine) setD(mine);
      } catch {
        /* keep last state */
      }
    }, 1000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [initial.serial]);

  async function startFullHistory() {
    setBusy(true);
    try {
      await fetch(`/api/devices/${d.serial}/jobs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "full_history" }) });
    } finally {
      setBusy(false);
    }
  }
  async function cancelJob() {
    setBusy(true);
    try {
      await fetch(`/api/devices/${d.serial}/jobs`, { method: "DELETE" });
    } finally {
      setBusy(false);
    }
  }
  async function loadMore() {
    setLoadingMore(true);
    try {
      const res = await fetch(`/api/devices/${d.serial}/events?offset=${page.items.length}&limit=100${showInvalid ? "" : "&valid=1"}`, { cache: "no-store" });
      const next = (await res.json()) as EventPage;
      setPage({ total: next.total, items: [...page.items, ...next.items] });
    } finally {
      setLoadingMore(false);
    }
  }

  const v = snapshot?.values ?? {};
  const rows: [string, React.ReactNode][] = [
    [t.device.model, v.model ?? d.model ?? "—"],
    [t.device.serial, <span key="s" className="font-mono">{d.serial}</span>],
    [t.device.firmware, <span key="f" className="font-mono text-xs">{v.firmware_raw ?? "—"}</span>],
    [t.device.battery, d.lifetime.battery == null ? "—" : d.lifetime.battery === 100 ? t.overview.brightnessHigh : d.lifetime.battery === 30 ? t.overview.brightnessLow : String(d.lifetime.battery)],
    [t.device.lifetimeSticks, fmt.integer(d.lifetime.sticks)],
    [t.device.lifetimePuffs, fmt.integer(d.lifetime.puffs)],
    [t.device.avgPuffs, d.lifetime.sticks && d.lifetime.puffs != null ? fmt.number(Math.round((d.lifetime.puffs / d.lifetime.sticks) * 100) / 100) : "—"],
    [t.device.lifetimeHours, d.lifetime.seconds == null ? "—" : fmt.number(Math.round((d.lifetime.seconds / 3600) * 10) / 10)],
    [t.device.stickState, d.connected ? (d.live?.stickState ?? "—") : (v.stick_state_code ?? "—")],
    [t.device.errorCode, d.connected ? (d.live?.errorState ?? "—") : (v.error_state_code ?? "—")],
    [t.device.sensor83, v.sensor_83_raw_value ?? "—"],
    [t.device.sensor84, v.sensor_84_raw_value ?? "—"],
    [t.device.flexpuff, onOff(v.flexpuff_enabled, snapshot?.statuses.flexpuff)],
    [t.device.autostart, onOff(v.autostart_enabled, snapshot?.statuses.autostart)],
    [t.device.pauseMode, onOff(v.pause_mode_enabled, snapshot?.statuses.pause_mode)],
  ];

  function onOff(value: unknown, status: string | undefined): string {
    if (value === true) return t.common.yes;
    if (value === false) return t.common.no;
    return status === "unsupported" ? t.device.unsupportedUsb : "—";
  }

  const job = d.job;
  const progressPct = job && job.total ? Math.min(100, Math.round((job.done / job.total) * 100)) : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <DeviceImage variant={d.variant} color={d.color} name={d.name} size={110} connected={d.connected} />
        <h1 className="text-xl font-semibold">{d.name}</h1>
        {d.user ? (
          <span className="inline-flex items-center gap-1 text-sm text-text-2">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: d.user.color }} aria-hidden /> {d.user.name}
          </span>
        ) : null}
        {d.connected ? (
          <Badge tone="good">
            <Usb size={12} aria-hidden /> {t.overview.connected}
          </Badge>
        ) : (
          <Badge>
            <Cable size={12} aria-hidden /> {t.overview.offline}
          </Badge>
        )}
        {d.clockWarning ? <Badge tone="warning">⚠ {t.device.clockSuspect}</Badge> : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle right={snapshot ? <span className="text-xs text-muted">{t.device.lastSnapshot}: {fmt.dateTime(snapshot.collectedUtc)}</span> : null}>{t.device.diagnostics}</CardTitle>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
            {rows.map(([k, val]) => (
              <div key={k} className="flex justify-between gap-3 border-b border-border py-1">
                <dt className="text-text-2">{k}</dt>
                <dd className="tabular text-right font-medium">{val}</dd>
              </div>
            ))}
          </dl>
          {snapshot ? (
            <p className="mt-2 text-xs text-muted">
              brightness: {snapshot.statuses.brightness ?? "—"} · vibration: {snapshot.statuses.vibration ?? "—"} · FlexBattery: {snapshot.statuses.flexbattery ?? "—"}
            </p>
          ) : null}
        </Card>

        <Card>
          <CardTitle>{t.device.archive}</CardTitle>
          <p className="text-sm text-text-2">
            {f(t.device.storedRange, { low: d.lowestStoredIndex ?? "—", high: page.items[0]?.eventId ?? "—", next: d.ackedNextIndex ?? "—" })}
          </p>
          <div className="mt-3">
            {job ? (
              <div className="space-y-2">
                <div className="text-sm">
                  {job.status === "running" && job.total ? f(t.device.jobRunning, { done: job.done, total: job.total }) : job.status === "failed" ? f(t.device.jobFailed, { message: job.message ?? "" }) : t.device.jobQueued}
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full bg-accent transition-all" style={{ width: `${progressPct}%` }} />
                </div>
                <button type="button" className="ui-btn h-8 text-xs" onClick={cancelJob} disabled={busy}>
                  <X size={14} aria-hidden /> {t.device.cancelJob}
                </button>
              </div>
            ) : d.fullHistoryComplete ? (
              <Badge tone="good">{t.device.fullHistoryDone}</Badge>
            ) : (
              <button type="button" className="ui-btn ui-btn-primary" onClick={startFullHistory} disabled={busy}>
                <Download size={16} aria-hidden /> {t.device.fullHistory}
              </button>
            )}
            <p className="mt-2 text-xs text-muted">{t.device.fullHistoryHint}</p>
          </div>
        </Card>
      </div>

      <DeviceSettings serial={d.serial} connected={d.connected} initial={settings} />

      <Card>
        <CardTitle
          right={
            <span className="flex items-center gap-3 text-xs text-muted">
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={showInvalid} onChange={(e) => reloadRecords(e.target.checked)} />
                {t.device.showInvalid}
                {!showInvalid && totalAll > page.total ? ` (${f(t.device.invalidCount, { n: fmt.integer(totalAll - page.total) })})` : ""}
              </label>
              <span>
                {fmt.integer(page.items.length)} / {fmt.integer(page.total)}
              </span>
            </span>
          }
        >
          {t.device.records}
        </CardTitle>
        {page.items.length === 0 ? (
          <Notice tone="info">{t.device.noRecords}</Notice>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-text-2">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">{t.device.colId}</th>
                  <th className="py-1.5 pr-3 font-medium">{t.device.colTime}</th>
                  <th className="py-1.5 pr-3 text-right font-medium">{t.device.colPuffs}</th>
                  <th className="py-1.5 pr-3 font-medium">{t.device.colStatus}</th>
                  <th className="py-1.5 font-medium">{t.device.colHex}</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {page.items.map((e) => (
                  <tr key={e.eventId} className="border-t border-border align-top">
                    <td className="py-1.5 pr-3 font-mono text-xs">{e.eventId}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">
                      {fmt.dateTimeSec(e.timestampUtc)}
                      {e.clockSuspect ? <span title={t.device.clockSuspect}> ⚠</span> : null}
                    </td>
                    <td className="py-1.5 pr-3 text-right">{e.puffCount ?? "—"}</td>
                    <td className="py-1.5 pr-3 text-xs">{(t.status as Record<string, string>)[e.status] ?? e.status}</td>
                    <td className="py-1.5">
                      {e.responseHex ? (
                        <details>
                          <summary className="cursor-pointer text-xs text-accent">HEX ({Math.floor(e.responseHex.length / 2)} B)</summary>
                          <code className="block max-w-xl break-all font-mono text-[11px] text-text-2">{e.responseHex}</code>
                          {e.puffPairs && e.puffPairs.length ? (
                            <div className="mt-1 text-[11px] text-muted">
                              {t.device.puffPairs}: <code className="font-mono">{e.puffPairs.join(" ")}</code>
                            </div>
                          ) : null}
                        </details>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {page.items.length < page.total ? (
          <button type="button" className="ui-btn mt-3" onClick={loadMore} disabled={loadingMore}>
            {t.device.showMore}
          </button>
        ) : null}
      </Card>

      {samples.length ? (
        <Card>
          <CardTitle>{t.device.liveSamples}</CardTitle>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-text-2">
                <tr>
                  <th className="py-1.5 pr-3 font-medium">{t.device.colTime}</th>
                  <th className="py-1.5 pr-3 text-right font-medium">{t.device.battery}</th>
                  <th className="py-1.5 pr-3 font-medium">{t.device.stickState}</th>
                  <th className="py-1.5 pr-3 text-right font-medium">{t.device.lifetimeSticks}</th>
                  <th className="py-1.5 text-right font-medium">{t.device.lifetimePuffs}</th>
                </tr>
              </thead>
              <tbody className="tabular">
                {samples.map((s) => (
                  <tr key={s.id} className="border-t border-border">
                    <td className="py-1 pr-3 whitespace-nowrap">{fmt.dateTimeSec(s.atUtc)}</td>
                    <td className="py-1 pr-3 text-right">{s.battery ?? "—"}</td>
                    <td className="py-1 pr-3 font-mono text-xs">{s.stickState ?? "—"}</td>
                    <td className="py-1 pr-3 text-right">{fmt.integer(s.lifetimeSticks)}</td>
                    <td className="py-1 text-right">{fmt.integer(s.lifetimePuffs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
