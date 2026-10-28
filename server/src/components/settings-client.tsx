"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Copy, KeyRound, Plus, Trash2 } from "lucide-react";
import type { User } from "@/db/schema";
import { useFormat, useI18n } from "@/lib/i18n/client";
import { DICTIONARIES, SUPPORTED_LOCALES } from "@/lib/i18n";
import { Card, CardTitle, Notice } from "@/components/ui";

interface DeviceRow {
  serial: string;
  name: string;
  userId: number | null;
  model: string | null;
  lastSeenUtc: string | null;
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

export function SettingsClient({ users, devices, agents, envKeyConfigured, override }: { users: User[]; devices: DeviceRow[]; agents: AgentRow[]; envKeyConfigured: boolean; override: string | null }) {
  const { t } = useI18n();
  const fmt = useFormat();
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
            <li key={d.serial} className="grid items-center gap-2 py-2 sm:grid-cols-[1fr_1fr_1fr]">
              <div>
                <div className="font-mono text-xs text-muted">{d.serial}</div>
                <div className="text-xs text-muted">
                  {d.model ?? ""} {d.lastSeenUtc ? `· ${fmt.dateTime(d.lastSeenUtc)}` : ""}
                </div>
              </div>
              <input
                className="ui-input"
                aria-label={t.settings.deviceName}
                value={deviceNames[d.serial] ?? ""}
                onChange={(e) => setDeviceNames({ ...deviceNames, [d.serial]: e.target.value })}
                onBlur={(e) => e.target.value.trim() && e.target.value !== d.name && run(() => call("/api/settings/devices", "PATCH", { serial: d.serial, name: e.target.value }))}
              />
              <select
                className="ui-input"
                aria-label={t.settings.owner}
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
