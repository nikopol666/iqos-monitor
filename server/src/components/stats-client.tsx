"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useFormat, useI18n } from "@/lib/i18n/client";
import type { StatsResult, GroupBy } from "@/lib/stats";
import { Card, CardTitle, Notice, Stat } from "@/components/ui";

interface DeviceOpt {
  serial: string;
  name: string;
  userId: number | null;
}
interface UserOpt {
  id: number;
  name: string;
  color: string;
}
type StatsResponse = StatsResult & { serials: string[]; devices: { serial: string; name: string }[] };

const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)", "var(--series-6)", "var(--series-7)", "var(--series-8)"];

function shiftDays(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function StatsClient({ devices, users, defaultFrom, defaultTo }: { devices: DeviceOpt[]; users: UserOpt[]; defaultFrom: string; defaultTo: string }) {
  const { t, f } = useI18n();
  const fmt = useFormat();
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [group, setGroup] = useState<GroupBy>("day");
  const [userId, setUserId] = useState<string>("");
  const [serial, setSerial] = useState<string>("");
  const [data, setData] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ from, to, group });
    if (serial) params.set("device", serial);
    else if (userId) params.set("user", userId);
    try {
      const res = await fetch(`/api/stats?${params}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setData((await res.json()) as StatsResponse);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [from, to, group, serial, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const presets: { key: string; label: string; days: number | null }[] = [
    { key: "last7", label: t.stats.presets.last7, days: 7 },
    { key: "last30", label: t.stats.presets.last30, days: 30 },
    { key: "last90", label: t.stats.presets.last90, days: 90 },
    { key: "year", label: t.stats.presets.year, days: 365 },
    { key: "all", label: t.stats.presets.all, days: null },
  ];
  function applyPreset(days: number | null) {
    setTo(defaultTo);
    setFrom(days === null ? "2015-01-01" : shiftDays(defaultTo, -(days - 1)));
    if (days === null || days >= 365) setGroup("month");
    else if (days >= 90) setGroup("week");
    else setGroup("day");
  }

  const visibleDevices = useMemo(() => (userId ? devices.filter((d) => d.userId === Number(userId)) : devices), [devices, userId]);
  const multi = (data?.devices.length ?? 0) > 1;
  const unitLabel = group === "day" ? t.stats.day : group === "week" ? t.stats.week : t.stats.month;

  const dateKeyFmt = fmt.dateKey;
  const shortDayFmt = fmt.shortDateKey;
  const bucketLabel = useCallback(
    (key: string, g: GroupBy, short = false): string => {
      if (g === "day") return short ? shortDayFmt(key) : dateKeyFmt(key);
      if (g === "week") return key.replace("-W", " W");
      return key;
    },
    [dateKeyFmt, shortDayFmt],
  );

  const chartRows = useMemo(() => {
    if (!data) return [];
    return data.buckets.map((b) => {
      const row: Record<string, number | string> = { key: b.key, label: bucketLabel(b.key, group, true), full: bucketLabel(b.key, group), sessions: b.sessions, puffs: b.puffs, records: b.records, suspect: b.suspect };
      for (const d of data.devices) {
        row[`sessions:${d.serial}`] = b.perSerial[d.serial]?.sessions ?? 0;
        row[`puffs:${d.serial}`] = b.perSerial[d.serial]?.puffs ?? 0;
      }
      return row;
    });
  }, [data, group, bucketLabel]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t.stats.title}</h1>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex gap-1">
          {presets.map((p) => (
            <button key={p.key} type="button" className="ui-btn h-8 px-2.5 text-xs" onClick={() => applyPreset(p.days)}>
              {p.label}
            </button>
          ))}
        </div>
        <label className="text-xs text-text-2">
          {t.common.from}
          <input type="date" className="ui-input ml-2 h-8" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-xs text-text-2">
          {t.common.to}
          <input type="date" className="ui-input ml-2 h-8" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </label>
        <label className="text-xs text-text-2">
          {t.stats.groupBy}
          <select className="ui-input ml-2 h-8" value={group} onChange={(e) => setGroup(e.target.value as GroupBy)}>
            <option value="day">{t.stats.day}</option>
            <option value="week">{t.stats.week}</option>
            <option value="month">{t.stats.month}</option>
          </select>
        </label>
        <label className="text-xs text-text-2">
          {t.stats.user}
          <select
            className="ui-input ml-2 h-8"
            value={userId}
            onChange={(e) => {
              setUserId(e.target.value);
              setSerial("");
            }}
          >
            <option value="">{t.common.all}</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-text-2">
          {t.stats.device}
          <select className="ui-input ml-2 h-8" value={serial} onChange={(e) => setSerial(e.target.value)}>
            <option value="">{t.common.all}</option>
            {visibleDevices.map((d) => (
              <option key={d.serial} value={d.serial}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error ? <Notice>{t.common.error}</Notice> : null}
      {data && data.totals.suspect > 0 ? <Notice>{t.stats.clockWarning}</Notice> : null}

      <div className={`space-y-4 transition-opacity ${loading ? "opacity-60" : ""}`}>
        {data ? (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label={t.stats.totalSessions} value={fmt.integer(data.totals.sessions)} hint={`${t.stats.totalRecords}: ${fmt.integer(data.totals.records)}`} />
              <Stat label={t.stats.totalPuffs} value={fmt.integer(data.totals.puffs)} hint={data.totals.avgPuffsPerSession != null ? `${t.stats.avgPuffsPerStick}: ${fmt.number(data.totals.avgPuffsPerSession)}` : undefined} />
              <Stat
                label={t.stats.avgSticksPerDay}
                value={fmt.number(data.totals.avgSessionsPerDay)}
                hint={`${fmt.number(data.totals.avgSessionsPerActiveDay)} ${t.stats.avgPerActiveDay}`}
              />
              <Stat label={t.stats.avgPuffsPerDay} value={fmt.number(data.totals.avgPuffsPerDay)} hint={`${fmt.number(data.totals.avgPuffsPerActiveDay)} ${t.stats.avgPerActiveDay}`} />
            </div>
            <div className="text-xs text-muted">
              {t.stats.daysInRange}: {data.totals.daysInRange} · {t.stats.daysWithData}: {data.totals.daysWithData}
            </div>

            {data.totals.records === 0 ? (
              <Notice tone="info">{t.stats.noData}</Notice>
            ) : (
              <>
                <Card>
                  <CardTitle>{f(t.stats.chartSticks, { unit: unitLabel.toLowerCase() })}</CardTitle>
                  <Chart rows={chartRows} metric="sessions" devices={multi ? data.devices : null} />
                </Card>
                <Card>
                  <CardTitle>{f(t.stats.chartPuffs, { unit: unitLabel.toLowerCase() })}</CardTitle>
                  <Chart rows={chartRows} metric="puffs" devices={multi ? data.devices : null} />
                </Card>
                <Card>
                  <CardTitle>{t.stats.period}</CardTitle>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-left text-xs text-text-2">
                        <tr>
                          <th className="py-1.5 pr-3 font-medium">{t.stats.period}</th>
                          <th className="py-1.5 pr-3 text-right font-medium">{t.stats.records}</th>
                          <th className="py-1.5 pr-3 text-right font-medium">{t.stats.sessions}</th>
                          <th className="py-1.5 pr-3 text-right font-medium">{t.stats.puffs}</th>
                          <th className="py-1.5 pr-3 text-right font-medium">{t.stats.avgSticksPerDay}</th>
                          <th className="py-1.5 text-right font-medium">{t.stats.avgPuffsPerDay}</th>
                        </tr>
                      </thead>
                      <tbody className="tabular">
                        {data.buckets.map((b) => (
                          <tr key={b.key} className="border-t border-border">
                            <td className="py-1.5 pr-3">
                              {bucketLabel(b.key, group)}
                              {b.suspect ? <span title={t.device.clockSuspect}> ⚠</span> : null}
                            </td>
                            <td className="py-1.5 pr-3 text-right">{fmt.integer(b.records)}</td>
                            <td className="py-1.5 pr-3 text-right">{fmt.integer(b.sessions)}</td>
                            <td className="py-1.5 pr-3 text-right">{fmt.integer(b.puffs)}</td>
                            <td className="py-1.5 pr-3 text-right">{fmt.number(Math.round((b.sessions / b.days) * 100) / 100)}</td>
                            <td className="py-1.5 text-right">{fmt.number(Math.round((b.puffs / b.days) * 100) / 100)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </>
            )}
            <p className="text-xs text-muted">{t.stats.recordsNote}</p>
          </>
        ) : (
          <div className="text-sm text-text-2">{t.common.loading}</div>
        )}
      </div>
    </div>
  );

  function Chart({ rows, metric, devices: devs }: { rows: Record<string, number | string>[]; metric: "sessions" | "puffs"; devices: { serial: string; name: string }[] | null }) {
    const series = devs ? devs.slice(0, 8).map((d, i) => ({ key: `${metric}:${d.serial}`, name: d.name, color: SERIES[i] })) : [{ key: metric, name: metric === "sessions" ? t.stats.sticks : t.stats.puffs, color: SERIES[0] }];
    const interval = rows.length > 12 ? Math.ceil(rows.length / 12) - 1 : 0;
    return (
      <div className="h-64 w-full">
        <ResponsiveContainer>
          <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="25%">
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--text-2)" }} tickLine={false} axisLine={{ stroke: "var(--border)" }} interval={interval} minTickGap={12} />
            <YAxis tick={{ fontSize: 11, fill: "var(--text-2)" }} tickLine={false} axisLine={false} width={36} allowDecimals={false} />
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--text)" }}
              labelStyle={{ color: "var(--text-2)" }}
              itemStyle={{ color: "var(--text)" }}
              labelFormatter={(_label, payload) => String(payload?.[0]?.payload?.full ?? _label)}
              formatter={(value, name) => [fmt.integer(Number(value)), String(name)]}
            />
            {series.length > 1 ? <Legend wrapperStyle={{ fontSize: 12 }} /> : null}
            {series.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} name={s.name} stackId="a" fill={s.color} stroke="var(--surface)" strokeWidth={1} radius={i === series.length - 1 ? [4, 4, 0, 0] : 0} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }
}
