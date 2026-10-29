"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Lock, RotateCcw, Vibrate, Unlock } from "lucide-react";
import { useFormat, useI18n } from "@/lib/i18n/client";
import type { SettingsView } from "@/app/api/devices/[serial]/settings/route";
import { Card, CardTitle, Notice } from "@/components/ui";

type SettingKey = "flexpuff" | "brightness" | "autostart" | "smart_gesture" | "lock" | "find" | "vib_heat" | "vib_ready" | "vib_almost" | "vib_end" | "restart";

/** Compact, grouped controls for everything the agent can write; polls while a change is pending. */
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
  const pendingFor = (setting: SettingKey) => pending.find((j) => j.setting === setting);

  /** On/off switch row (plain render helper, not a nested component). */
  function switchRow(label: string, setting: SettingKey, current: string | null) {
    const job = pendingFor(setting);
    const on = (job?.value ?? current) === "on";
    const unknown = current == null && !job;
    return (
      <div key={setting} className="flex items-center justify-between gap-3 py-1.5">
        <span className="text-sm">{label}</span>
        <span className="flex items-center gap-2">
          {job ? <Loader2 size={12} className="animate-spin text-accent" aria-hidden /> : null}
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-label={label}
            disabled={disabled || !!job || busy === setting}
            onClick={() => change(setting, on ? "off" : "on")}
            className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${on ? "border-accent bg-accent" : "border-border bg-surface-2"} ${unknown ? "opacity-40" : ""}`}
          >
            <span className={`absolute top-[2px] rounded-full bg-white shadow transition-[left] ${on ? "left-[22px]" : "left-[2px]"}`} style={{ height: 18, width: 18 }} />
          </button>
        </span>
      </div>
    );
  }

  const brightnessJob = pendingFor("brightness");
  const brightnessValue = brightnessJob?.value ?? view.values.brightness;

  return (
    <Card>
      <CardTitle right={view.readAtUtc ? <span className="text-xs text-muted">{f(t.device.lastRead, { time: fmt.dateTime(view.readAtUtc) })}</span> : null}>{t.device.settingsTitle}</CardTitle>
      {!connected ? <Notice tone="info">{t.device.settingsOffline}</Notice> : !writable ? <Notice>{t.device.settingsModel}</Notice> : null}

      <div className="mt-3 grid gap-x-8 gap-y-4 md:grid-cols-2">
        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-2">{t.device.groupBehaviour}</h3>
          <div className="divide-y divide-border">
            <div className="flex items-center justify-between gap-3 py-1.5">
              <span className="text-sm">{t.device.brightness}</span>
              <div className="flex items-center gap-0.5 rounded-lg border border-border bg-surface-2 p-0.5">
                {(["low", "high"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    disabled={disabled || !!brightnessJob || busy === "brightness"}
                    onClick={() => change("brightness", value)}
                    className={`rounded-md px-2.5 py-0.5 text-xs transition-colors disabled:cursor-not-allowed ${brightnessValue === value ? "bg-accent text-accent-ink" : "text-text-2 hover:text-text disabled:opacity-60"}`}
                  >
                    {brightnessJob?.value === value ? <Loader2 size={12} className="mr-1 inline animate-spin" aria-hidden /> : null}
                    {value === "low" ? t.device.low : t.device.high}
                  </button>
                ))}
              </div>
            </div>
            {switchRow(t.device.flexpuff, "flexpuff", view.values.flexpuff)}
            {switchRow(t.device.autostart, "autostart", view.values.autostart)}
            {switchRow(t.device.smartGesture, "smart_gesture", view.values.smart_gesture)}
          </div>
        </section>

        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-2">{t.device.vibrations}</h3>
          <div className="divide-y divide-border">
            {switchRow(t.device.vibHeat, "vib_heat", view.values.vib_heat)}
            {switchRow(t.device.vibReady, "vib_ready", view.values.vib_ready)}
            {switchRow(t.device.vibAlmost, "vib_almost", view.values.vib_almost)}
            {switchRow(t.device.vibEnd, "vib_end", view.values.vib_end)}
          </div>
        </section>

        <section className="md:col-span-2">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-text-2">{t.device.groupActions}</h3>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="ui-btn h-8 text-xs" disabled={disabled || !!pendingFor("lock")} onClick={() => change("lock", view.values.lock === "on" ? "off" : "on")}>
              {pendingFor("lock") ? <Loader2 size={14} className="animate-spin" aria-hidden /> : view.values.lock === "on" ? <Unlock size={14} aria-hidden /> : <Lock size={14} aria-hidden />}
              {view.values.lock === "on" ? t.device.unlockAction : t.device.lockAction}
            </button>
            <button type="button" className="ui-btn h-8 text-xs" disabled={disabled || !!pendingFor("find")} onClick={() => change("find", "on")}>
              {pendingFor("find")?.value === "on" ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Vibrate size={14} aria-hidden />}
              {t.device.find}
            </button>
            <button type="button" className="ui-btn h-8 text-xs" disabled={disabled || !!pendingFor("find")} onClick={() => change("find", "off")}>
              {t.device.findStop}
            </button>
            <button type="button" className="ui-btn ml-auto h-8 text-xs text-critical" disabled={disabled || !!pending.length} onClick={() => confirm(t.device.restartConfirm) && change("restart", "now")}>
              <RotateCcw size={14} aria-hidden /> {t.device.restart}
            </button>
          </div>
        </section>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 text-xs">
        <span className="text-muted">{t.device.settingsHint}</span>
        {pending.length ? (
          <span className="text-accent">{t.device.applying}</span>
        ) : lastResult ? (
          <span className={lastResult.status === "failed" ? "text-critical" : "text-muted"}>
            {lastResult.status === "failed" ? f(t.device.settingFailed, { message: lastResult.message ?? "" }) : `${t.device.settingDone} · ${fmt.dateTime(lastResult.updatedUtc)}`}
          </span>
        ) : null}
      </div>

      {view.eventLog.length ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-text-2">
            {t.device.eventLog} · {view.eventLog.length}
          </summary>
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
    </Card>
  );
}
