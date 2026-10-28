"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import { useFormat, useI18n } from "@/lib/i18n/client";
import type { SettingsView } from "@/app/api/devices/[serial]/settings/route";
import { Card, CardTitle, Notice } from "@/components/ui";

type SettingKey = "flexpuff" | "brightness" | "autostart" | "smart_gesture" | "lock" | "find" | "vib_heat" | "vib_ready" | "vib_almost" | "vib_end" | "restart";

/** Toggle controls for the settings the agent can write; polls while a change is pending. */
export function DeviceSettings({ serial, connected, initial }: { serial: string; connected: boolean; initial: SettingsView }) {
  const { t, f } = useI18n();
  const fmt = useFormat();
  const [view, setView] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);

  const pending = view.jobs.filter((j) => j.status === "queued" || j.status === "running");
  const lastResult = view.jobs.find((j) => j.status === "done" || j.status === "failed");

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/devices/${serial}/settings`, { cache: "no-store" });
      if (res.ok) {
        const next = (await res.json()) as SettingsView;
        setView((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
      }
    } catch {
      /* keep last */
    }
  }, [serial]);

  useEffect(() => {
    const id = setInterval(refresh, pending.length ? 1500 : 10_000);
    return () => clearInterval(id);
  }, [refresh, pending.length]);

  async function change(setting: SettingKey, value: string) {
    setBusy(setting);
    try {
      await fetch(`/api/devices/${serial}/settings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ setting, value }) });
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  const writable = view.model === "42PT";
  const disabled = !connected || !writable;

  // Plain render helper (not a nested component) so React keeps the buttons stable between renders.
  function renderRow({ label, setting, options, current }: { label: string; setting: SettingKey; options: { value: string; label: string }[]; current: string | null }) {
    const job = pending.find((j) => j.setting === setting);
    const target = job?.value;
    return (
      <div key={setting} className="flex flex-wrap items-center justify-between gap-2 border-b border-border py-2 last:border-0">
        <div className="text-sm">
          {label}
          {setting !== "find" && view.statuses[setting === "brightness" ? "battery" : setting] === "unsupported" ? <span className="ml-2 text-xs text-muted">{t.device.unsupportedUsb}</span> : null}
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border bg-surface-2 p-0.5">
          {options.map((o) => {
            const active = (target ?? current) === o.value;
            return (
              <button
                key={o.value}
                type="button"
                disabled={disabled || !!job || busy === setting}
                onClick={() => change(setting, o.value)}
                className={`rounded-md px-3 py-1 text-sm transition-colors disabled:cursor-not-allowed ${active ? "bg-accent text-accent-ink" : "text-text-2 hover:text-text disabled:opacity-60"}`}
              >
                {job && target === o.value ? <Loader2 size={14} className="mr-1 inline animate-spin" aria-hidden /> : null}
                {o.label}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <Card>
      <CardTitle right={view.readAtUtc ? <span className="text-xs text-muted">{f(t.device.lastRead, { time: fmt.dateTime(view.readAtUtc) })}</span> : null}>{t.device.settingsTitle}</CardTitle>
      <p className="mb-2 text-xs text-muted">{t.device.settingsHint}</p>
      {!connected ? <Notice tone="info">{t.device.settingsOffline}</Notice> : !writable ? <Notice>{t.device.settingsModel}</Notice> : null}
      <div className="mt-2">
        {renderRow({ label: t.device.flexpuff, setting: "flexpuff", current: view.values.flexpuff, options: [{ value: "off", label: t.device.off }, { value: "on", label: t.device.on }] })}
        {renderRow({ label: t.device.brightness, setting: "brightness", current: view.values.brightness, options: [{ value: "low", label: t.device.low }, { value: "high", label: t.device.high }] })}
        {renderRow({ label: t.device.autostart, setting: "autostart", current: view.values.autostart, options: [{ value: "off", label: t.device.off }, { value: "on", label: t.device.on }] })}
        {renderRow({ label: t.device.smartGesture, setting: "smart_gesture", current: view.values.smart_gesture, options: [{ value: "off", label: t.device.off }, { value: "on", label: t.device.on }] })}
        {renderRow({ label: t.device.lock, setting: "lock", current: view.values.lock, options: [{ value: "off", label: t.device.unlocked }, { value: "on", label: t.device.locked }] })}
        {renderRow({ label: t.device.find, setting: "find", current: null, options: [{ value: "on", label: t.device.findStart }, { value: "off", label: t.device.findStop }] })}
        <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-text-2">{t.device.vibrations}</div>
        {renderRow({ label: t.device.vibHeat, setting: "vib_heat", current: view.values.vib_heat, options: [{ value: "off", label: t.device.off }, { value: "on", label: t.device.on }] })}
        {renderRow({ label: t.device.vibReady, setting: "vib_ready", current: view.values.vib_ready, options: [{ value: "off", label: t.device.off }, { value: "on", label: t.device.on }] })}
        {renderRow({ label: t.device.vibAlmost, setting: "vib_almost", current: view.values.vib_almost, options: [{ value: "off", label: t.device.off }, { value: "on", label: t.device.on }] })}
        {renderRow({ label: t.device.vibEnd, setting: "vib_end", current: view.values.vib_end, options: [{ value: "off", label: t.device.off }, { value: "on", label: t.device.on }] })}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3 text-sm">
        <span>{t.device.restart}</span>
        <button type="button" className="ui-btn h-8 text-xs" disabled={disabled || !!pending.length} onClick={() => confirm(t.device.restartConfirm) && change("restart", "now")}>
          <RotateCcw size={14} aria-hidden /> {t.device.restart}
        </button>
      </div>
      {view.eventLog.length ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-text-2">{t.device.eventLog} · {view.eventLog.length}</summary>
          <p className="mt-1 text-xs text-muted">{t.device.eventLogHint}</p>
          <table className="mt-2 w-full text-xs">
            <tbody className="tabular">
              {view.eventLog.map((e) => (
                <tr key={e.index} className="border-t border-border">
                  <td className="py-1 pr-3 font-mono text-muted">{e.index}</td>
                  <td className="py-1 pr-3 whitespace-nowrap">{fmt.dateTimeSec(e.time_utc)}</td>
                  <td className="py-1 pr-3 font-mono">{e.type.toString(16).padStart(2, "0")}</td>
                  <td className="py-1 font-mono text-muted">{e.data}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}
      {pending.length ? (
        <p className="mt-2 text-xs text-accent">{t.device.applying}</p>
      ) : lastResult ? (
        <p className={`mt-2 text-xs ${lastResult.status === "failed" ? "text-critical" : "text-muted"}`}>
          {lastResult.status === "failed" ? f(t.device.settingFailed, { message: lastResult.message ?? "" }) : `${t.device.settingDone} · ${fmt.dateTime(lastResult.updatedUtc)}`}
        </p>
      ) : null}
    </Card>
  );
}
