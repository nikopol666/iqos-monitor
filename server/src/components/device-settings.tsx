"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useFormat, useI18n } from "@/lib/i18n/client";
import type { SettingsView } from "@/app/api/devices/[serial]/settings/route";
import { Card, CardTitle, Notice } from "@/components/ui";

type SettingKey = "flexpuff" | "brightness" | "autostart";

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
          {view.statuses[setting === "brightness" ? "battery" : setting] === "unsupported" ? <span className="ml-2 text-xs text-muted">{t.device.unsupportedUsb}</span> : null}
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
        <div className="flex items-center justify-between py-2 text-sm">
          <span>{t.device.smartGesture}</span>
          <span className="text-text-2">{view.values.smart_gesture === "on" ? t.device.on : view.values.smart_gesture === "off" ? t.device.off : "—"}</span>
        </div>
      </div>
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
