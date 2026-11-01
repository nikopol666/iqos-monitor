"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import type { User } from "@/db/schema";
import { useFormat, useI18n } from "@/lib/i18n/client";
import { DICTIONARIES, SUPPORTED_LOCALES } from "@/lib/i18n";
import { Card, CardTitle, Notice } from "@/components/ui";
import { defaultWeekStart } from "@/lib/prefs";
import { DeviceImage } from "@/components/device-image";
import type { DeviceVariant } from "@/lib/variants";
import { colorCss, isHexColor, lowContrastModes, type PaletteColor } from "@/lib/palette";

interface DeviceRow {
  serial: string;
  name: string;
  label: string;
  userId: number | null;
  model: string | null;
  lastSeenUtc: string | null;
  color: string;
  variant: string;
  defaultColor: string;
}
interface AgentRow {
  id: number;
  name: string;
  keyPrefix: string;
  lastSeenUtc: string | null;
  hostname: string | null;
  version: string | null;
}

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

export function SettingsClient({
  users,
  devices,
  variants,
  palette,
  agents,
  envKeyConfigured,
  override,
  weekStartOverride,
}: {
  users: User[];
  devices: DeviceRow[];
  variants: DeviceVariant[];
  palette: PaletteColor[];
  agents: AgentRow[];
  envKeyConfigured: boolean;
  override: string | null;
  weekStartOverride: string | null;
}) {
  const { t, f, weekStart, locale } = useI18n();
  const fmt = useFormat();
  // Weekday names in the viewer's language; 2024-01-01 is a Monday.
  const weekdayName = (n: number) => new Intl.DateTimeFormat(locale === "cs" ? "cs-CZ" : "en-GB", { weekday: "long" }).format(new Date(Date.UTC(2024, 0, n, 12)));
  const languageWeekStart = defaultWeekStart(locale);
  const router = useRouter();
  const [newUser, setNewUser] = useState("");
  const [newUserColor, setNewUserColor] = useState("#2a78d6");
  const [newAgent, setNewAgent] = useState("");
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deviceNames, setDeviceNames] = useState<Record<string, string>>(Object.fromEntries(devices.map((d) => [d.serial, d.name])));

  async function run(fn: () => Promise<unknown>) {
    try {
      setError(null);
      await fn();
      router.refresh();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t.settings.title}</h1>
      {error ? <Notice>{t.common.error}</Notice> : null}

      <Card>
        <CardTitle>{t.settings.users}</CardTitle>
        <p className="mb-3 text-sm text-text-2">{t.settings.usersHint}</p>
        <ul className="divide-y divide-border">
          {users.map((u) => (
            <li key={u.id} className="flex items-center gap-3 py-2">
              <input
                type="color"
                className="h-7 w-9 cursor-pointer rounded border border-border bg-surface"
                defaultValue={u.color}
                aria-label={t.settings.color}
                onBlur={(e) => e.target.value !== u.color && run(() => call("/api/settings/users", "PATCH", { id: u.id, color: e.target.value }))}
              />
              <input
                className="ui-input flex-1"
                defaultValue={u.name}
                onBlur={(e) => e.target.value.trim() && e.target.value !== u.name && run(() => call("/api/settings/users", "PATCH", { id: u.id, name: e.target.value }))}
              />
              <button
                type="button"
                className="ui-btn h-8 text-xs"
                onClick={() => confirm(t.settings.deleteUserConfirm) && run(() => call("/api/settings/users", "DELETE", { id: u.id }))}
              >
                <Trash2 size={14} aria-hidden /> {t.common.delete}
              </button>
            </li>
          ))}
        </ul>
        <form
          className="mt-3 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newUser.trim()) return;
            run(() => call("/api/settings/users", "POST", { name: newUser, color: newUserColor })).then(() => setNewUser(""));
          }}
        >
          <input type="color" className="h-7 w-9 cursor-pointer rounded border border-border bg-surface" value={newUserColor} onChange={(e) => setNewUserColor(e.target.value)} aria-label={t.settings.color} />
          <input className="ui-input flex-1" placeholder={t.settings.newUser} value={newUser} onChange={(e) => setNewUser(e.target.value)} />
          <button type="submit" className="ui-btn ui-btn-primary">
            <Plus size={16} aria-hidden /> {t.common.add}
          </button>
        </form>
      </Card>

      <Card>
        <CardTitle>{t.settings.devices}</CardTitle>
        <p className="mb-3 text-sm text-text-2">{t.settings.devicesHint}</p>
        {devices.length === 0 ? <Notice tone="info">{t.overview.empty}</Notice> : null}
        <ul className="divide-y divide-border">
          {devices.map((d) => (
            <li key={d.serial} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:gap-5">
              <DeviceImage variant={d.variant} color={d.color} name={d.label} size={190} className="mx-auto sm:mx-0" />
              <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                <div className="sm:col-span-2 lg:col-span-3">
                  <div className="font-mono text-xs text-muted">{d.serial}</div>
                  <div className="text-xs text-muted">
                    {d.model ?? ""} {d.lastSeenUtc ? `· ${fmt.dateTime(d.lastSeenUtc)}` : ""}
                  </div>
                </div>
                <label className="text-xs text-text-2">
                  {t.settings.deviceName}
                  <input
                    className="ui-input ui-input-sm mt-1 w-full"
                    placeholder={d.label}
                    value={deviceNames[d.serial] ?? ""}
                    onChange={(e) => setDeviceNames({ ...deviceNames, [d.serial]: e.target.value })}
                    onBlur={(e) => e.target.value.trim() !== d.name.trim() && run(() => call("/api/settings/devices", "PATCH", { serial: d.serial, name: e.target.value }))}
                  />
                </label>
                <label className="text-xs text-text-2">
                  {t.settings.owner}
                  <select
                    className="ui-input ui-input-sm mt-1 w-full"
                    value={d.userId ?? ""}
                    onChange={(e) => run(() => call("/api/settings/devices", "PATCH", { serial: d.serial, user_id: e.target.value ? Number(e.target.value) : null }))}
                  >
                    <option value="">{t.common.unassigned}</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-text-2">
                  {t.settings.deviceImage}
                  <select
                    className="ui-input ui-input-sm mt-1 w-full"
                    value={d.variant}
                    onChange={(e) => run(() => call("/api/settings/devices", "PATCH", { serial: d.serial, variant: e.target.value }))}
                  >
                    {variants.map((v) => (
                      <option key={v.key} value={v.key}>
                        {v.model} · {v.colour}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="text-xs text-text-2 sm:col-span-2 lg:col-span-3">
                  {t.settings.deviceColor}
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {palette.map((c) => (
                      <button
                        key={c.key}
                        type="button"
                        title={c.key}
                        aria-label={c.key}
                        onClick={() => run(() => call("/api/settings/devices", "PATCH", { serial: d.serial, color: c.key }))}
                        className={`h-6 w-6 rounded-full border-2 ${d.color === c.key ? "border-text" : "border-transparent"}`}
                        style={{ background: `var(--series-${c.key})` }}
                      />
                    ))}
                    <label className="ml-1 flex items-center gap-1.5" title={t.settings.customColor}>
                      <input
                        type="color"
                        className="h-6 w-8 cursor-pointer rounded border border-border bg-surface"
                        defaultValue={isHexColor(d.color) ? d.color : "#888888"}
                        onBlur={(e) => e.target.value !== d.color && run(() => call("/api/settings/devices", "PATCH", { serial: d.serial, color: e.target.value }))}
                      />
                      <span>{t.settings.customColor}</span>
                    </label>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5">
                      <span className="inline-block h-3 w-3 rounded-full" style={{ background: colorCss(d.color) }} aria-hidden />
                      <code className="font-mono">{d.color}</code>
                    </span>
                    {d.color === d.defaultColor ? (
                      <span className="text-muted">{t.settings.colorFollowsFinish}</span>
                    ) : (
                      <button type="button" className="ui-btn h-7 text-xs" onClick={() => run(() => call("/api/settings/devices", "PATCH", { serial: d.serial, reset_color: true }))}>
                        {t.settings.useSuggested}
                      </button>
                    )}
                    {lowContrastModes(d.color).length ? (
                      <span className="text-warning">⚠ {f(t.settings.lowContrast, { modes: lowContrastModes(d.color).map((m) => (m === "light" ? t.settings.themeLight : t.settings.themeDark)).join(", ") })}</span>
                    ) : null}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardTitle>{t.settings.agents}</CardTitle>
        <p className="mb-3 text-sm text-text-2">{t.settings.agentsHint}</p>
        {envKeyConfigured ? <p className="mb-2 text-xs text-muted">AGENT_API_KEY (env) ✓</p> : null}
        {freshKey ? (
          <div className="mb-3 rounded-lg border border-accent/50 bg-accent/10 p-3 text-sm">
            <div className="mb-1 text-text-2">{t.settings.keyOnce}</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all font-mono text-sm">{freshKey}</code>
              <button type="button" className="ui-btn h-8 text-xs" onClick={() => navigator.clipboard.writeText(freshKey)}>
                <Copy size={14} aria-hidden /> {t.common.copy}
              </button>
            </div>
          </div>
        ) : null}
        <ul className="divide-y divide-border">
          {agents.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
              <KeyRound size={16} aria-hidden className="text-muted" />
              <span className="font-medium">{a.name}</span>
              <code className="font-mono text-xs text-muted">{a.keyPrefix}…</code>
              <span className="text-xs text-text-2">
                {t.settings.lastSeen}: {a.lastSeenUtc ? fmt.dateTime(a.lastSeenUtc) : t.settings.never}
                {a.hostname ? ` · ${a.hostname}` : ""}
                {a.version ? ` · v${a.version}` : ""}
              </span>
              <button type="button" className="ui-btn ml-auto h-8 text-xs" onClick={() => confirm(t.settings.revokeConfirm) && run(() => call("/api/settings/agents", "DELETE", { id: a.id }))}>
                <Trash2 size={14} aria-hidden /> {t.settings.revoke}
              </button>
            </li>
          ))}
        </ul>
        <form
          className="mt-3 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const r = (await call("/api/settings/agents", "POST", { name: newAgent || "agent" })) as { api_key: string };
              setFreshKey(r.api_key);
              setNewAgent("");
            });
          }}
        >
          <input className="ui-input flex-1" placeholder={t.settings.newAgent} value={newAgent} onChange={(e) => setNewAgent(e.target.value)} />
          <button type="submit" className="ui-btn ui-btn-primary">
            <KeyRound size={16} aria-hidden /> {t.settings.generateKey}
          </button>
        </form>
      </Card>

      <Card>
        <CardTitle>{t.settings.display}</CardTitle>
        <label className="block text-sm">
          <span className="mb-1 block text-xs text-text-2">{t.settings.weekStart}</span>
          <select className="ui-input" value={weekStartOverride ?? ""} onChange={(e) => run(() => call("/api/prefs", "POST", { week_start: e.target.value ? Number(e.target.value) : null }))}>
            <option value="">{f(t.settings.weekStartAuto, { day: weekdayName(languageWeekStart) })}</option>
            {[1, 6, 7].map((n) => (
              <option key={n} value={n}>
                {weekdayName(n)}
              </option>
            ))}
          </select>
        </label>
        <p className="mt-2 text-xs text-muted">{f(t.settings.weekStartHint, { day: weekdayName(weekStart) })}</p>
      </Card>

      <Card>
        <CardTitle>{t.settings.language}</CardTitle>
        <p className="mb-3 text-sm text-text-2">{t.settings.languageHint}</p>
        <select
          className="ui-input"
          value={override ?? ""}
          onChange={(e) => run(() => call("/api/lang", "POST", { locale: e.target.value || null }))}
        >
          <option value="">{t.settings.languageAuto}</option>
          {SUPPORTED_LOCALES.map((code) => (
            <option key={code} value={code}>
              {DICTIONARIES[code].localeName}
            </option>
          ))}
        </select>
      </Card>
    </div>
  );
}
