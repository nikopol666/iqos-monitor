"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronUp, SlidersHorizontal } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useFormat, useI18n } from "@/lib/i18n/client";
import type { StatsResult, GroupBy, Bucket } from "@/lib/stats";
import type { DayRecord } from "@/lib/queries";
import { Card, CardTitle, Notice, Stat } from "@/components/ui";
import { colorCss } from "@/lib/palette";

interface DeviceOpt {
  serial: string;
  name: string;
  userId: number | null;
  color: string;
}
interface UserOpt {
  id: number;
  name: string;
  color: string;
}
type StatsResponse = StatsResult & { serials: string[]; suspectHidden: number; devices: { serial: string; name: string; color: string }[] };

interface View {
  from: string;
  to: string;
  group: GroupBy;
}

/** Current width of an element, kept up to date with ResizeObserver. */
function useElementWidth(ref: React.RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

function shiftDays(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function StatsClient({ devices, users, defaultFrom, defaultTo }: { devices: DeviceOpt[]; users: UserOpt[]; defaultFrom: string; defaultTo: string }) {
  const { t, f } = useI18n();
  const fmt = useFormat();
  // Default 90-day range reads better by week; day grouping stays one click away.
  const [view, setView] = useState<View>({ from: defaultFrom, to: defaultTo, group: "week" });
  const [history, setHistory] = useState<View[]>([]);
  const [userId, setUserId] = useState<string>("");
  const [serial, setSerial] = useState<string>("");
  const [includeSuspect, setIncludeSuspect] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [data, setData] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drill, setDrill] = useState<{ bucket: Bucket; items: DayRecord[] | null } | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const { from, to, group } = view;

  const scopeParams = useCallback(() => {
    const params = new URLSearchParams();
    if (serial) params.set("device", serial);
    else if (userId) params.set("user", userId);
    if (includeSuspect) params.set("suspect", "1");
    return params;
  }, [serial, userId, includeSuspect]);

  const load = useCallback(async () => {
    setLoading(true);
    const params = scopeParams();
    params.set("from", from);
    params.set("to", to);
    params.set("group", group);
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
  }, [from, to, group, scopeParams]);

  useEffect(() => {
    setDrill(null);
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
    setHistory([]);
    setView({
      to: defaultTo,
      from: days === null ? "2015-01-01" : shiftDays(defaultTo, -(days - 1)),
      group: days === null || days >= 365 ? "month" : days >= 90 ? "week" : "day",
    });
  }
  function patchView(patch: Partial<View>) {
    setHistory([]);
    setView((v) => ({ ...v, ...patch }));
  }

  const dataGroup: GroupBy = data?.groupBy ?? group;
  const visibleDevices = useMemo(() => (userId ? devices.filter((d) => d.userId === Number(userId)) : devices), [devices, userId]);
  const unitLabel = dataGroup === "day" ? t.stats.day : dataGroup === "week" ? t.stats.week : t.stats.month;

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

  const series = useMemo(() => (data ? data.devices.filter((d) => !hidden.has(d.serial)) : []), [data, hidden]);

  const chartRows = useMemo(() => {
    if (!data) return [];
    const g = data.groupBy;
    return data.buckets.map((b) => {
      const row: Record<string, number | string> = { key: b.key, label: bucketLabel(b.key, g, true), full: bucketLabel(b.key, g), suspect: b.suspect };
      let sessions = 0;
      let puffs = 0;
      for (const d of series) {
        const ps = b.perSerial[d.serial];
        row[`sessions:${d.serial}`] = ps?.sessions ?? 0;
        row[`puffs:${d.serial}`] = ps?.puffs ?? 0;
        sessions += ps?.sessions ?? 0;
        puffs += ps?.puffs ?? 0;
      }
      row.sessions = sessions;
      row.puffs = puffs;
      return row;
    });
  }, [data, bucketLabel, series]);

  /** Click on a bucket: zoom to it one level finer, or list its records at day level. */
  async function openBucket(b: Bucket) {
    if (dataGroup !== "day") {
      setHistory((h) => [...h, view]);
      setView({ from: b.start, to: b.end, group: dataGroup === "month" ? "week" : "day" });
      return;
    }
    setDrill({ bucket: b, items: null });
    const params = scopeParams();
    params.set("from", b.start);
    params.set("to", b.end);
    const res = await fetch(`/api/events?${params}`, { cache: "no-store" });
    const json = (await res.json()) as { items: DayRecord[] };
    setDrill({ bucket: b, items: json.items });
  }
  function goBack() {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    setView(prev);
  }
  function toggleSeries(s: string) {
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(s)) n.delete(s);
      else n.add(s);
      return n;
    });
  }

  const deviceBySerial = useMemo(() => new Map(devices.map((d) => [d.serial, d])), [devices]);
  const chartRef = useRef<HTMLDivElement>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t.stats.title}</h1>
        <button type="button" className="ui-btn h-8 max-w-[70%] text-xs sm:hidden" onClick={() => setFiltersOpen((o) => !o)} aria-expanded={filtersOpen}>
          <SlidersHorizontal size={14} aria-hidden />
          <span className="truncate">
            {filtersOpen ? t.stats.hideFilters : `${bucketLabel(from, "day", true)} – ${bucketLabel(to, "day", true)} · ${unitLabel}`}
          </span>
          {filtersOpen ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
        </button>
      </div>

      <div className={`${filtersOpen ? "flex" : "hidden"} flex-wrap items-end gap-3 rounded-xl border border-border bg-surface p-3 sm:flex sm:border-0 sm:bg-transparent sm:p-0`}>
        <div className="flex gap-1">
          {presets.map((p) => (
            <button key={p.key} type="button" className="ui-btn h-8 px-2.5 text-xs" onClick={() => applyPreset(p.days)}>
              {p.label}
            </button>
          ))}
        </div>
        <label className="text-xs text-text-2">
          {t.common.from}
          <input type="date" className="ui-input ml-2 h-8" value={from} max={to} onChange={(e) => patchView({ from: e.target.value })} />
        </label>
        <label className="text-xs text-text-2">
          {t.common.to}
          <input type="date" className="ui-input ml-2 h-8" value={to} min={from} onChange={(e) => patchView({ to: e.target.value })} />
        </label>
        <label className="text-xs text-text-2">
          {t.stats.groupBy}
          <select className="ui-input ml-2 h-8" value={group} onChange={(e) => patchView({ group: e.target.value as GroupBy })}>
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
        <label className="flex h-8 items-center gap-2 text-xs text-text-2">
          <input type="checkbox" checked={includeSuspect} onChange={(e) => setIncludeSuspect(e.target.checked)} />
          {t.stats.includeSuspect}
        </label>
      </div>

      {/* Device chips: one click filters, legend-style toggle hides a series. */}
      {data && data.devices.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted">{t.stats.perDevice}:</span>
          {data.devices.map((d) => {
            const off = hidden.has(d.serial);
            return (
              <button
                key={d.serial}
                type="button"
                onClick={() => toggleSeries(d.serial)}
                onDoubleClick={() => setSerial(d.serial)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${off ? "border-border text-muted line-through" : "border-border bg-surface text-text"}`}
                title={d.name}
              >
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: off ? "var(--muted)" : colorCss(d.color) }} aria-hidden />
                {d.name}
              </button>
            );
          })}
        </div>
      ) : null}

      {history.length ? (
        <button type="button" className="ui-btn h-8 text-xs" onClick={goBack}>
          <ArrowLeft size={14} aria-hidden /> {t.stats.back} · {bucketLabel(history[history.length - 1].from, "day")} – {bucketLabel(history[history.length - 1].to, "day")}
        </button>
      ) : null}

      {error ? <Notice>{t.common.error}</Notice> : null}
      {data && data.totals.suspect > 0 ? <Notice>{t.stats.clockWarning}</Notice> : null}
      {data && data.suspectHidden > 0 ? <Notice tone="info">{f(t.stats.suspectHidden, { n: fmt.integer(data.suspectHidden) })}</Notice> : null}

      <div className={`space-y-4 transition-opacity ${loading ? "opacity-60" : ""}`}>
        {data ? (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label={t.stats.totalSessions} value={fmt.integer(data.totals.sessions)} hint={`${t.stats.totalRecords}: ${fmt.integer(data.totals.records)}`} />
              <Stat label={t.stats.totalPuffs} value={fmt.integer(data.totals.puffs)} hint={data.totals.avgPuffsPerSession != null ? `${t.stats.avgPuffsPerStick}: ${fmt.number(data.totals.avgPuffsPerSession)}` : undefined} />
              <Stat label={t.stats.avgSticksPerDay} value={fmt.number(data.totals.avgSessionsPerDay)} hint={`${fmt.number(data.totals.avgSessionsPerActiveDay)} ${t.stats.avgPerActiveDay}`} />
              <Stat label={t.stats.avgPuffsPerDay} value={fmt.number(data.totals.avgPuffsPerDay)} hint={`${fmt.number(data.totals.avgPuffsPerActiveDay)} ${t.stats.avgPerActiveDay}`} />
            </div>
            <div className="text-xs text-muted">
              {t.stats.daysInRange}: {data.totals.daysInRange} · {t.stats.daysWithData}: {data.totals.daysWithData} · {t.stats.clickHint}
            </div>

            {data.totals.records === 0 ? (
              <Notice tone="info">{t.stats.noData}</Notice>
            ) : (
              <>
                <Card>
                  <CardTitle>{f(t.stats.chartSticks, { unit: unitLabel.toLowerCase() })}</CardTitle>
                  <Chart rows={chartRows} metric="sessions" />
                </Card>
                <Card>
                  <CardTitle>{f(t.stats.chartPuffs, { unit: unitLabel.toLowerCase() })}</CardTitle>
                  <Chart rows={chartRows} metric="puffs" />
                </Card>

                {drill ? (
                  <Card>
                    <CardTitle
                      right={
                        <button type="button" className="ui-btn h-7 text-xs" onClick={() => setDrill(null)}>
                          {t.common.close}
                        </button>
                      }
                    >
                      {f(t.stats.drillTitle, { period: bucketLabel(drill.bucket.key, dataGroup) })}
                    </CardTitle>
                    {drill.items === null ? (
                      <div className="text-sm text-text-2">{t.common.loading}</div>
                    ) : drill.items.length === 0 ? (
                      <Notice tone="info">{t.stats.drillEmpty}</Notice>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead className="text-left text-xs text-text-2">
                            <tr>
                              <th className="py-1.5 pr-3 font-medium">{t.device.colTime}</th>
                              <th className="py-1.5 pr-3 font-medium">{t.stats.device}</th>
                              <th className="py-1.5 pr-3 text-right font-medium">{t.device.colPuffs}</th>
                              <th className="py-1.5 font-medium">{t.device.colId}</th>
                            </tr>
                          </thead>
                          <tbody className="tabular">
                            {drill.items.map((r) => {
                              const dev = deviceBySerial.get(r.serial);
                              return (
                                <tr key={`${r.serial}:${r.eventId}`} className="border-t border-border">
                                  <td className="py-1.5 pr-3 whitespace-nowrap">
                                    {fmt.time(r.timestampUtc)}
                                    {r.clockSuspect ? <span title={t.device.clockSuspect}> ⚠</span> : null}
                                  </td>
                                  <td className="py-1.5 pr-3">
                                    <Link href={`/devices/${r.serial}`} className="inline-flex items-center gap-1.5 hover:underline">
                                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: dev ? colorCss(dev.color) : "var(--muted)" }} aria-hidden />
                                      {dev?.name ?? r.serial}
                                    </Link>
                                  </td>
                                  <td className="py-1.5 pr-3 text-right">{r.puffCount ?? "—"}</td>
                                  <td className="py-1.5 font-mono text-xs text-muted">{r.eventId}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </Card>
                ) : null}

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
                          <tr key={b.key} className="cursor-pointer border-t border-border hover:bg-surface-2" onClick={() => openBucket(b)}>
                            <td className="py-1.5 pr-3">
                              {bucketLabel(b.key, dataGroup)}
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

  function Chart({ rows, metric }: { rows: Record<string, number | string>[]; metric: "sessions" | "puffs" }) {
    const bars = series.length ? series.map((d) => ({ key: `${metric}:${d.serial}`, name: d.name, color: colorCss(d.color) })) : [];
    const width = useElementWidth(chartRef);
    const maxTicks = Math.max(3, Math.floor((width || 600) / 72));
    const interval = rows.length > maxTicks ? Math.ceil(rows.length / maxTicks) - 1 : 0;
    return (
      <div ref={chartRef} className="h-52 w-full sm:h-64">
        <ResponsiveContainer>
          <BarChart
            data={rows}
            margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            barCategoryGap="25%"
            onClick={(state) => {
              const idx = (state as { activeTooltipIndex?: number } | null)?.activeTooltipIndex;
              if (typeof idx === "number" && data?.buckets[idx]) void openBucket(data.buckets[idx]);
            }}
            style={{ cursor: "pointer" }}
          >
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--text-2)" }} tickLine={false} axisLine={{ stroke: "var(--border)" }} interval={interval} minTickGap={16} />
            <YAxis tick={{ fontSize: 11, fill: "var(--text-2)" }} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--text)" }}
              labelStyle={{ color: "var(--text-2)" }}
              itemStyle={{ color: "var(--text)" }}
              labelFormatter={(_label, payload) => String(payload?.[0]?.payload?.full ?? _label)}
              formatter={(value, name) => [fmt.integer(Number(value)), String(name)]}
            />
            {bars.map((s, i) => (
              <Bar key={s.key} dataKey={s.key} name={s.name} stackId="a" fill={s.color} stroke="var(--surface)" strokeWidth={1} radius={i === bars.length - 1 ? [4, 4, 0, 0] : 0} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    );
  }
}
