"use client";

import Link from "next/link";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, SlidersHorizontal } from "lucide-react";
import { Bar, CartesianGrid, ComposedChart, LabelList, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useFormat, useI18n } from "@/lib/i18n/client";
import type { StatsResult, GroupBy, Bucket, StatTotals } from "@/lib/stats";
import type { DayRecord } from "@/lib/queries";
import { addDays, isoWeekKey, monthEnd, weekStartOf } from "@/lib/time";
import { Card, CardTitle, Notice } from "@/components/ui";
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
type StatsResponse = StatsResult & {
  serials: string[];
  suspectHidden: number;
  previous: StatTotals | null;
  sessionLength: { seconds: number | null; sticks: number; intervals: number };
  devices: { serial: string; name: string; color: string }[];
};

/** Day / week / month page through calendar periods; range is presets or custom dates with its own grouping. */
type Mode = "day" | "week" | "month" | "range";

interface RangeView {
  from: string;
  to: string;
  group: GroupBy;
}

const TOOLTIP_STYLE = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--text)" } as const;
const AXIS_TICK = { fontSize: 11, fill: "var(--text-2)" } as const;

/** Current width of an element, kept up to date with ResizeObserver. */
function useElementWidth(ref: React.RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // ResizeObserver reports the initial size on observe(), so no synchronous setState here.
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

function addMonths(dateKey: string, n: number): string {
  const [y, m] = dateKey.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

/** Grouping that reads best for a range length. */
function autoGroup(days: number | null): GroupBy {
  return days === null || days >= 365 ? "month" : days >= 90 ? "week" : "day";
}

/** Calendar period for the pager modes. */
function periodBounds(mode: Exclude<Mode, "range">, anchor: string, weekStart: number): RangeView {
  if (mode === "day") return { from: anchor, to: anchor, group: "hour" };
  if (mode === "week") {
    const from = weekStartOf(anchor, weekStart);
    return { from, to: addDays(from, 6), group: "day" };
  }
  const from = anchor.slice(0, 7) + "-01";
  return { from, to: monthEnd(anchor), group: "day" };
}

/** One-row segmented control: the active option is unmistakable. */
function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { key: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="flex items-center gap-2" role="radiogroup" aria-label={label}>
      <span className="hidden text-xs text-text-2 sm:inline">{label}</span>
      <div className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5">
        {options.map((o) => {
          const active = o.key === value;
          return (
            <button
              key={o.key}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(o.key)}
              className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${active ? "bg-accent text-accent-ink shadow-sm" : "text-text-2 hover:text-text"}`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function StatsClient({ devices, users, defaultFrom, defaultTo }: { devices: DeviceOpt[]; users: UserOpt[]; defaultFrom: string; defaultTo: string }) {
  const { t, f, weekStart, tz } = useI18n();
  const fmt = useFormat();
  const [mode, setMode] = useState<Mode>("week");
  const [anchor, setAnchor] = useState(defaultTo);
  // Default 90-day range reads better by week; day grouping stays one click away.
  const [range, setRange] = useState<RangeView>({ from: defaultFrom, to: defaultTo, group: "week" });
  const [history, setHistory] = useState<RangeView[]>([]);
  const view: RangeView = mode === "range" ? range : periodBounds(mode, anchor, weekStart);
  const { from, to, group } = view;
  const [userId, setUserId] = useState<string>("");
  const [serial, setSerial] = useState<string>("");
  const [includeSuspect, setIncludeSuspect] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [data, setData] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drill, setDrill] = useState<{ bucket: Bucket; items: DayRecord[] | null } | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const scopeParams = useCallback(() => {
    const params = new URLSearchParams();
    if (serial) params.set("device", serial);
    else if (userId) params.set("user", userId);
    if (includeSuspect) params.set("suspect", "1");
    params.set("week_start", String(weekStart));
    return params;
  }, [serial, userId, includeSuspect, weekStart]);

  const load = useCallback(async () => {
    setLoading(true);
    setDrill(null);
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
    // Deferred so the fetch (and its loading state) starts after the render commits.
    const id = setTimeout(() => void load(), 0);
    return () => clearTimeout(id);
  }, [load]);

  const presets: { key: string; label: string; days: number | null }[] = [
    { key: "last7", label: t.stats.presets.last7, days: 7 },
    { key: "last30", label: t.stats.presets.last30, days: 30 },
    { key: "last90", label: t.stats.presets.last90, days: 90 },
    { key: "year", label: t.stats.presets.year, days: 365 },
    { key: "all", label: t.stats.presets.all, days: null },
  ];
  const presetFrom = (days: number | null) => (days === null ? "2015-01-01" : addDays(defaultTo, -(days - 1)));
  const activePreset = presets.find((p) => range.from === presetFrom(p.days) && range.to === defaultTo)?.key ?? "custom";
  function applyPreset(key: string) {
    const p = presets.find((x) => x.key === key);
    if (!p) return;
    setHistory([]);
    setRange({ to: defaultTo, from: presetFrom(p.days), group: autoGroup(p.days) });
  }
  function patchRange(patch: Partial<RangeView>) {
    setHistory([]);
    setRange((v) => ({ ...v, ...patch }));
  }
  function page(direction: -1 | 1) {
    if (mode === "range") return;
    setAnchor((a) => (mode === "day" ? addDays(a, direction) : mode === "week" ? addDays(a, 7 * direction) : addMonths(a, direction)));
  }
  const atToday = mode !== "range" && from <= defaultTo && to >= defaultTo;
  const canGoNext = mode !== "range" && to < defaultTo;

  const dataGroup: GroupBy = data?.groupBy ?? group;
  const visibleDevices = useMemo(() => (userId ? devices.filter((d) => d.userId === Number(userId)) : devices), [devices, userId]);
  const unitLabel = dataGroup === "hour" ? t.stats.unitHour : dataGroup === "day" ? t.stats.unitDay : dataGroup === "week" ? t.stats.unitWeek : t.stats.unitMonth;

  const dateKeyFmt = fmt.dateKey;
  const shortDayFmt = fmt.shortDateKey;
  const intlLocale = fmt.intlLocale;
  const monthName = useMemo(() => new Intl.DateTimeFormat(intlLocale, { month: "long", year: "numeric" }), [intlLocale]);
  const weekdayLong = useMemo(() => new Intl.DateTimeFormat(intlLocale, { weekday: "long" }), [intlLocale]);
  const bucketLabel = useCallback(
    (b: { key: string; start: string; end: string }, g: GroupBy, short = false): string => {
      if (g === "hour") return `${b.key.slice(11, 13)}:00`;
      if (g === "day") return short ? shortDayFmt(b.key) : dateKeyFmt(b.key);
      if (g === "week") return `${shortDayFmt(b.start)} – ${shortDayFmt(b.end)}`;
      return short ? b.key : monthName.format(new Date(Date.UTC(Number(b.key.slice(0, 4)), Number(b.key.slice(5, 7)) - 1, 1, 12)));
    },
    [dateKeyFmt, shortDayFmt, monthName],
  );
  const periodTitle = (() => {
    if (mode === "day") return `${weekdayLong.format(new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)), 12)))} ${dateKeyFmt(from)}`;
    if (mode === "week") return `${shortDayFmt(from)} – ${shortDayFmt(to)}${weekStart === 1 ? ` · ${f(t.stats.weekLabel, { n: Number(isoWeekKey(from).slice(6)) })}` : ""}`;
    if (mode === "month") return monthName.format(new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, 1, 12)));
    return `${dateKeyFmt(from)} – ${dateKeyFmt(to)}`;
  })();

  const series = useMemo(() => (data ? data.devices.filter((d) => !hidden.has(d.serial)) : []), [data, hidden]);

  const chartRows = useMemo(() => {
    if (!data) return [];
    const g = data.groupBy;
    return data.buckets.map((b) => {
      const row: Record<string, number | string | null> = { key: b.key, label: bucketLabel(b, g, true), full: bucketLabel(b, g), suspect: b.suspect };
      let sessions = 0;
      let puffs = 0;
      for (const d of series) {
        const ps = b.perSerial[d.serial];
        row[`sessions:${d.serial}`] = ps?.sessions ?? 0;
        row[`pps:${d.serial}`] = ps && ps.sessions ? Math.round((ps.puffs / ps.sessions) * 10) / 10 : null;
        sessions += ps?.sessions ?? 0;
        puffs += ps?.puffs ?? 0;
      }
      row.sessions = sessions;
      row.puffs = puffs;
      row.pps = sessions ? Math.round((puffs / sessions) * 10) / 10 : null;
      return row;
    });
  }, [data, bucketLabel, series]);

  const avgPerBucket = useMemo(() => {
    const vals = chartRows.map((r) => Number(r.sessions));
    return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : 0;
  }, [chartRows]);

  const localHour = useMemo(() => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hour12: false }), [tz]);

  /** Click on a bucket: zoom one level finer, or list its records at day/hour level. */
  async function openBucket(b: Bucket) {
    if (mode !== "range" && dataGroup === "day") {
      // Week or month pager: jump to that day.
      setMode("day");
      setAnchor(b.key);
      return;
    }
    if (mode === "range" && dataGroup !== "day") {
      setHistory((h) => [...h, range]);
      setRange({ from: b.start, to: b.end, group: dataGroup === "month" ? "week" : "day" });
      return;
    }
    setDrill({ bucket: b, items: null });
    const params = scopeParams();
    params.set("from", b.start);
    params.set("to", b.end);
    const res = await fetch(`/api/events?${params}`, { cache: "no-store" });
    const json = (await res.json()) as { items: DayRecord[] };
    const items = dataGroup === "hour" ? json.items.filter((r) => localHour.format(new Date(r.timestampUtc)) === b.key.slice(11, 13)) : json.items;
    setDrill({ bucket: b, items });
  }
  function goBack() {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    setRange(prev);
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
  const weekdayNames = useMemo(() => {
    const dfmt = new Intl.DateTimeFormat(intlLocale, { weekday: "short" });
    // 2024-01-01 is a Monday.
    return Array.from({ length: 7 }, (_, i) => dfmt.format(new Date(Date.UTC(2024, 0, 1 + i, 12))));
  }, [intlLocale]);

  const deltaText = (cur: number, prev: number | undefined | null): string | null => {
    if (!data?.previous || prev == null) return null;
    if (!prev) return t.stats.previousNone;
    const pct = Math.round(((cur - prev) / prev) * 100);
    return `${pct > 0 ? "+" : ""}${pct} % ${f(t.stats.vsPrevious, { days: data.totals.daysInRange })}`;
  };

  const modeOptions: { key: Mode; label: string }[] = [
    { key: "day", label: t.stats.viewDay },
    { key: "week", label: t.stats.viewWeek },
    { key: "month", label: t.stats.viewMonth },
    { key: "range", label: t.stats.viewRange },
  ];
  const groupOptions: { key: GroupBy; label: string }[] = [
    { key: "day", label: t.stats.viewDay },
    { key: "week", label: t.stats.viewWeek },
    { key: "month", label: t.stats.viewMonth },
  ];
  const rangeOptions = [...presets.map((p) => ({ key: p.key, label: p.label })), ...(activePreset === "custom" ? [{ key: "custom", label: t.stats.custom }] : [])];
  const showDistributions = dataGroup !== "hour";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t.stats.title}</h1>
        <button type="button" className="ui-btn h-8 max-w-[70%] text-xs sm:hidden" onClick={() => setFiltersOpen((o) => !o)} aria-expanded={filtersOpen}>
          <SlidersHorizontal size={14} aria-hidden />
          <span className="truncate">{filtersOpen ? t.stats.hideFilters : periodTitle}</span>
          {filtersOpen ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
        </button>
      </div>

      {/* One filter block above everything it scopes: the view first, then its period or range, then who. */}
      <div className={`${filtersOpen ? "flex" : "hidden"} flex-col gap-3 rounded-xl border border-border bg-surface p-3 sm:flex sm:border-0 sm:bg-transparent sm:p-0`}>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
          <Segmented label={t.stats.view} value={mode} options={modeOptions} onChange={(m) => setMode(m)} />
          {mode !== "range" ? (
            <div className="flex items-center gap-1">
              <button type="button" className="ui-btn h-8 w-8 px-0" onClick={() => page(-1)} aria-label={t.stats.prevPeriod} title={t.stats.prevPeriod}>
                <ChevronLeft size={16} aria-hidden />
              </button>
              <span className="min-w-[10rem] px-2 text-center text-sm font-medium">{periodTitle}</span>
              <button type="button" className="ui-btn h-8 w-8 px-0" onClick={() => page(1)} disabled={!canGoNext} aria-label={t.stats.nextPeriod} title={t.stats.nextPeriod}>
                <ChevronRight size={16} aria-hidden />
              </button>
              {!atToday ? (
                <button type="button" className="ui-btn h-8 text-xs" onClick={() => setAnchor(defaultTo)}>
                  {t.stats.todayBtn}
                </button>
              ) : null}
            </div>
          ) : (
            <Segmented label={t.stats.range} value={activePreset} options={rangeOptions} onChange={(k) => k !== "custom" && applyPreset(k)} />
          )}
        </div>
        {mode === "range" ? (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3 text-xs text-text-2">
            <label className="inline-flex items-center gap-2">
              {t.common.from}
              <input type="date" className="ui-input h-8" value={range.from} max={range.to} onChange={(e) => patchRange({ from: e.target.value })} />
            </label>
            <label className="inline-flex items-center gap-2">
              {t.common.to}
              <input type="date" className="ui-input h-8" value={range.to} min={range.from} onChange={(e) => patchRange({ to: e.target.value })} />
            </label>
            <Segmented label={t.stats.groupBy} value={range.group} options={groupOptions} onChange={(g) => patchRange({ group: g })} />
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 text-xs text-text-2">
          {users.length > 1 ? (
            <div className="inline-flex items-center gap-2">
              {t.stats.user}
              <div className="inline-flex rounded-lg border border-border bg-surface-2 p-0.5">
                {[{ id: "", name: t.common.all, color: null as string | null }, ...users.map((u) => ({ id: String(u.id), name: u.name, color: u.color as string | null }))].map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => {
                      setUserId(u.id);
                      setSerial("");
                    }}
                    className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm transition-colors ${userId === u.id ? "bg-accent text-accent-ink" : "text-text-2 hover:text-text"}`}
                  >
                    {u.color ? <span className="inline-block h-2 w-2 rounded-full" style={{ background: u.color }} aria-hidden /> : null}
                    {u.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {visibleDevices.length > 1 ? (
            <div className="inline-flex flex-wrap items-center gap-2">
              {t.stats.device}
              <div className="inline-flex flex-wrap rounded-lg border border-border bg-surface-2 p-0.5">
                {[{ serial: "", name: t.common.all, color: null as string | null }, ...visibleDevices.map((d) => ({ serial: d.serial, name: d.name, color: colorCss(d.color) as string | null }))].map((d) => (
                  <button
                    key={d.serial}
                    type="button"
                    onClick={() => setSerial(d.serial)}
                    className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm transition-colors ${serial === d.serial ? "bg-accent text-accent-ink" : "text-text-2 hover:text-text"}`}
                  >
                    {d.color ? <span className="inline-block h-2 w-2 rounded-full" style={{ background: d.color }} aria-hidden /> : null}
                    {d.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <label className="inline-flex h-8 items-center gap-2">
            <input type="checkbox" checked={includeSuspect} onChange={(e) => setIncludeSuspect(e.target.checked)} />
            {t.stats.includeSuspect}
          </label>
        </div>
      </div>

      {/* Device legend: one click hides a series, double click filters to it. */}
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
          <ArrowLeft size={14} aria-hidden /> {t.stats.back} · {dateKeyFmt(history[history.length - 1].from)} – {dateKeyFmt(history[history.length - 1].to)}
        </button>
      ) : null}

      {error ? <Notice>{t.common.error}</Notice> : null}
      {data && data.totals.suspect > 0 ? <Notice>{t.stats.clockWarning}</Notice> : null}
      {data && data.suspectHidden > 0 ? <Notice tone="info">{f(t.stats.suspectHidden, { n: fmt.integer(data.suspectHidden) })}</Notice> : null}

      <div className={`space-y-4 transition-opacity ${loading ? "opacity-60" : ""}`}>
        {data ? (
          <>
            {/* KPI row: the two numbers that matter for any period come first. */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <Kpi
                label={t.stats.avgSticksPerDay}
                value={fmt.number(data.totals.avgSessionsPerDay)}
                delta={deltaText(data.totals.avgSessionsPerDay, data.previous?.avgSessionsPerDay)}
                hint={f(t.stats.activeDaysHint, { active: fmt.number(data.totals.avgSessionsPerActiveDay), days: data.totals.daysWithData, total: data.totals.daysInRange })}
              />
              <Kpi
                label={t.stats.avgPuffsPerStick}
                value={data.totals.avgPuffsPerSession == null ? "—" : fmt.number(data.totals.avgPuffsPerSession)}
                delta={data.totals.avgPuffsPerSession == null ? null : deltaText(data.totals.avgPuffsPerSession, data.previous?.avgPuffsPerSession)}
                hint={`${t.stats.avgPuffsPerDay}: ${fmt.number(data.totals.avgPuffsPerDay)}`}
              />
              <Kpi label={t.stats.totalSessions} value={fmt.integer(data.totals.sessions)} delta={deltaText(data.totals.sessions, data.previous?.sessions)} hint={`${t.stats.totalRecords}: ${fmt.integer(data.totals.records)}`} />
              <Kpi label={t.stats.totalPuffs} value={fmt.integer(data.totals.puffs)} delta={deltaText(data.totals.puffs, data.previous?.puffs)} />
              <Kpi
                className="col-span-2 md:col-span-1"
                label={t.stats.stickDuration}
                value={data.totals.avgLastPuffS == null ? "—" : `${fmt.number(Math.round(data.totals.avgLastPuffS / 6) / 10)} min`}
                delta={data.totals.avgLastPuffS == null || data.previous?.avgLastPuffS == null ? null : deltaText(data.totals.avgLastPuffS, data.previous.avgLastPuffS)}
                hint={
                  data.totals.avgLastPuffS == null
                    ? t.stats.stickDurationNone
                    : `${f(t.stats.stickDurationHint, { first: data.totals.avgFirstPuffS ?? 0 })}${data.sessionLength.seconds != null ? ` · ${f(t.stats.sessionLengthHint, { min: fmt.number(Math.round(data.sessionLength.seconds / 6) / 10) })}` : ""}`
                }
              />
            </div>

            {data.totals.records === 0 ? (
              <Notice tone="info">{t.stats.noData}</Notice>
            ) : (
              <>
                <Card>
                  <CardTitle right={<span className="hidden text-xs text-muted sm:inline">{t.stats.clickHint}</span>}>{f(t.stats.chartSticks, { unit: unitLabel })}</CardTitle>
                  <SticksChart
                    rows={chartRows}
                    bars={series.map((d) => ({ key: `sessions:${d.serial}`, name: d.name, color: colorCss(d.color) }))}
                    average={avgPerBucket}
                    averageLabel={t.stats.averageLine}
                    tickEvery={dataGroup === "hour" ? 3 : undefined}
                    onBar={(i) => data.buckets[i] && void openBucket(data.buckets[i])}
                  />
                </Card>
                <Card>
                  <CardTitle>{t.stats.avgPuffsPerStick}</CardTitle>
                  <PuffsPerStickChart
                    rows={chartRows}
                    lines={series.map((d) => ({ key: `pps:${d.serial}`, name: d.name, color: colorCss(d.color) }))}
                    average={data.totals.avgPuffsPerSession}
                    averageLabel={`${t.stats.averageLine} ${data.totals.avgPuffsPerSession == null ? "" : fmt.number(data.totals.avgPuffsPerSession)}`}
                    tickEvery={dataGroup === "hour" ? 3 : undefined}
                    onPoint={(i) => data.buckets[i] && void openBucket(data.buckets[i])}
                  />
                </Card>
                {showDistributions ? (
                  <div className="grid gap-4 md:grid-cols-2">
                    <Card>
                      <CardTitle right={<span className="text-xs text-muted">{t.stats.sticksPerDayShort}</span>}>{t.stats.byHour}</CardTitle>
                      <DistributionChart
                        rows={data.byHour.map((n, h) => ({ label: String(h).padStart(2, "0"), full: `${String(h).padStart(2, "0")}:00–${String(h).padStart(2, "0")}:59`, value: Math.round((n / Math.max(1, data.totals.daysInRange)) * 100) / 100, count: n }))}
                        tickEvery={3}
                        countLabel={t.stats.sticks}
                      />
                    </Card>
                    <Card>
                      <CardTitle right={<span className="text-xs text-muted">{t.stats.sticksPerDayShort}</span>}>{t.stats.byWeekday}</CardTitle>
                      <DistributionChart
                        rows={Array.from({ length: 7 }, (_, i) => (i + weekStart - 1) % 7).map((i) => ({ label: weekdayNames[i], full: weekdayNames[i], value: Math.round((data.byWeekday[i] / Math.max(1, data.totals.daysInRange / 7)) * 100) / 100, count: data.byWeekday[i] }))}
                        tickEvery={1}
                        countLabel={t.stats.sticks}
                      />
                    </Card>
                  </div>
                ) : null}

                {drill ? (
                  <Card>
                    <CardTitle
                      right={
                        <button type="button" className="ui-btn h-7 text-xs" onClick={() => setDrill(null)}>
                          {t.common.close}
                        </button>
                      }
                    >
                      {f(t.stats.drillTitle, { period: dataGroup === "hour" ? `${dateKeyFmt(drill.bucket.start)} ${bucketLabel(drill.bucket, "hour")}` : bucketLabel(drill.bucket, dataGroup) })}
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
                              <th className="py-1.5 pr-3 text-right font-medium">{t.device.colDuration}</th>
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
                                  <td className="py-1.5 pr-3 text-right">{r.lastPuffS == null ? "—" : `${Math.floor(r.lastPuffS / 60)}:${String(r.lastPuffS % 60).padStart(2, "0")}`}</td>
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

                <details className="ui-card group p-4 sm:p-5">
                  <summary className="flex cursor-pointer items-center justify-between text-sm font-semibold uppercase tracking-wide text-text-2">
                    {t.stats.tableByPeriod}
                    <ChevronDown size={16} className="transition-transform group-open:rotate-180" aria-hidden />
                  </summary>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-left text-xs text-text-2">
                        <tr>
                          <th className="py-1.5 pr-3 font-medium">{t.stats.period}</th>
                          <th className="py-1.5 pr-3 text-right font-medium">{t.stats.records}</th>
                          <th className="py-1.5 pr-3 text-right font-medium">{t.stats.sessions}</th>
                          <th className="py-1.5 pr-3 text-right font-medium">{t.stats.puffs}</th>
                          {dataGroup !== "hour" ? <th className="py-1.5 pr-3 text-right font-medium">{t.stats.avgSticksPerDay}</th> : null}
                          <th className="py-1.5 pr-3 text-right font-medium">{t.stats.avgPuffsPerStick}</th>
                          <th className="py-1.5 text-right font-medium">{t.stats.stickDurationShort}</th>
                        </tr>
                      </thead>
                      <tbody className="tabular">
                        {data.buckets
                          .filter((b) => dataGroup !== "hour" || b.records > 0)
                          .map((b) => (
                            <tr key={b.key} className="cursor-pointer border-t border-border hover:bg-surface-2" onClick={() => openBucket(b)}>
                              <td className="py-1.5 pr-3">
                                {bucketLabel(b, dataGroup)}
                                {b.suspect ? <span title={t.device.clockSuspect}> ⚠</span> : null}
                              </td>
                              <td className="py-1.5 pr-3 text-right">{fmt.integer(b.records)}</td>
                              <td className="py-1.5 pr-3 text-right">{fmt.integer(b.sessions)}</td>
                              <td className="py-1.5 pr-3 text-right">{fmt.integer(b.puffs)}</td>
                              {dataGroup !== "hour" ? <td className="py-1.5 pr-3 text-right">{fmt.number(Math.round((b.sessions / b.days) * 100) / 100)}</td> : null}
                              <td className="py-1.5 pr-3 text-right">{b.sessions ? fmt.number(Math.round((b.puffs / b.sessions) * 10) / 10) : "—"}</td>
                              <td className="py-1.5 text-right">{b.avgLastPuffS == null ? "—" : `${fmt.number(Math.round(b.avgLastPuffS / 6) / 10)} min`}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </details>
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
}

/** Stat tile with an optional delta against the previous period. */
function Kpi({ label, value, delta, hint, className = "" }: { label: string; value: string; delta?: string | null; hint?: string; className?: string }) {
  return (
    <div className={`ui-card px-4 py-3 ${className}`}>
      <div className="text-xs text-text-2">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {delta ? <div className="mt-0.5 text-xs text-text-2">{delta}</div> : null}
      {hint ? <div className="mt-0.5 text-xs text-muted">{hint}</div> : null}
    </div>
  );
}

type ChartRow = Record<string, number | string | null>;
interface SeriesDef {
  key: string;
  name: string;
  color: string;
}

function useTickInterval(ref: React.RefObject<HTMLDivElement | null>, count: number, fixed?: number): number {
  const width = useElementWidth(ref);
  if (fixed) return fixed - 1;
  const maxTicks = Math.max(3, Math.floor((width || 600) / 72));
  return count > maxTicks ? Math.ceil(count / maxTicks) - 1 : 0;
}

/** Stacked columns per device with the per-bucket average and the peak labelled. */
const SticksChart = memo(function SticksChart({ rows, bars, average, averageLabel, tickEvery, onBar }: { rows: ChartRow[]; bars: SeriesDef[]; average: number; averageLabel: string; tickEvery?: number; onBar: (index: number) => void }) {
  const fmt = useFormat();
  const ref = useRef<HTMLDivElement>(null);
  const interval = useTickInterval(ref, rows.length, tickEvery);
  const peak = rows.reduce((best, r, i) => (Number(r.sessions) > Number(rows[best]?.sessions ?? -1) ? i : best), 0);
  const last = bars[bars.length - 1];
  return (
    <div ref={ref} className="h-56 w-full sm:h-72">
      <ResponsiveContainer>
        <ComposedChart
          data={rows}
          margin={{ top: 16, right: 72, left: 0, bottom: 0 }}
          barCategoryGap="30%"
          onClick={(state) => {
            const idx = (state as { activeTooltipIndex?: number } | null)?.activeTooltipIndex;
            if (typeof idx === "number") onBar(idx);
          }}
          style={{ cursor: "pointer" }}
        >
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "var(--border)" }} interval={interval} minTickGap={16} />
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
          <Tooltip
            cursor={{ fill: "var(--surface-2)" }}
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: "var(--text-2)" }}
            itemStyle={{ color: "var(--text)" }}
            labelFormatter={(_label, payload) => String(payload?.[0]?.payload?.full ?? _label)}
            formatter={(value, name) => [fmt.integer(Number(value)), String(name)]}
          />
          {bars.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.name} stackId="a" fill={s.color} stroke="var(--surface)" strokeWidth={2} maxBarSize={24} radius={i === bars.length - 1 ? [4, 4, 0, 0] : 0} isAnimationActive={false}>
              {s.key === last?.key ? (
                <LabelList
                  dataKey="sessions"
                  position="top"
                  content={(props) => {
                    const { x, y, width, index, value } = props as { x?: number; y?: number; width?: number; index?: number; value?: number | string };
                    if (index !== peak || x == null || y == null || width == null || !value) return null;
                    return (
                      <text x={x + width / 2} y={y - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--text)">
                        {fmt.integer(Number(value))}
                      </text>
                    );
                  }}
                />
              ) : null}
            </Bar>
          ))}
          {average > 0 ? <ReferenceLine y={average} stroke="var(--text-2)" strokeWidth={1} ifOverflow="extendDomain" label={{ value: `${averageLabel} ${fmt.number(average)}`, position: "right", fill: "var(--text-2)", fontSize: 11 }} /> : null}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
});

/** Puffs per stick is a rate: lines with ringed markers, the overall average as a reference. */
const PuffsPerStickChart = memo(function PuffsPerStickChart({ rows, lines, average, averageLabel, tickEvery, onPoint }: { rows: ChartRow[]; lines: SeriesDef[]; average: number | null; averageLabel: string; tickEvery?: number; onPoint: (index: number) => void }) {
  const fmt = useFormat();
  const ref = useRef<HTMLDivElement>(null);
  const interval = useTickInterval(ref, rows.length, tickEvery);
  const many = rows.length > 40;
  return (
    <div ref={ref} className="h-52 w-full sm:h-64">
      <ResponsiveContainer>
        <ComposedChart
          data={rows}
          margin={{ top: 12, right: 72, left: 0, bottom: 0 }}
          onClick={(state) => {
            const idx = (state as { activeTooltipIndex?: number } | null)?.activeTooltipIndex;
            if (typeof idx === "number") onPoint(idx);
          }}
          style={{ cursor: "pointer" }}
        >
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "var(--border)" }} interval={interval} minTickGap={16} />
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={32} domain={[0, "auto"]} />
          <Tooltip
            cursor={{ stroke: "var(--border)" }}
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: "var(--text-2)" }}
            itemStyle={{ color: "var(--text)" }}
            labelFormatter={(_label, payload) => String(payload?.[0]?.payload?.full ?? _label)}
            formatter={(value, name) => [value == null ? "—" : fmt.number(Number(value)), String(name)]}
          />
          {lines.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stroke={s.color}
              strokeWidth={2}
              connectNulls
              dot={many ? false : { r: 4, fill: s.color, stroke: "var(--surface)", strokeWidth: 2 }}
              activeDot={{ r: 6, fill: s.color, stroke: "var(--surface)", strokeWidth: 2 }}
              isAnimationActive={false}
            />
          ))}
          {average != null ? <ReferenceLine y={average} stroke="var(--accent)" strokeWidth={1} label={{ value: averageLabel, position: "right", fill: "var(--text-2)", fontSize: 11 }} /> : null}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
});

/** Single-hue columns for a distribution (hour of day, weekday). */
const DistributionChart = memo(function DistributionChart({ rows, tickEvery, countLabel }: { rows: { label: string; full: string; value: number; count: number }[]; tickEvery: number; countLabel: string }) {
  const fmt = useFormat();
  const peak = rows.reduce((best, r, i) => (r.value > (rows[best]?.value ?? -1) ? i : best), 0);
  return (
    <div className="h-44 w-full sm:h-52">
      <ResponsiveContainer>
        <ComposedChart data={rows} margin={{ top: 16, right: 8, left: 0, bottom: 0 }} barCategoryGap="25%">
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: "var(--border)" }} interval={tickEvery - 1} />
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={32} />
          <Tooltip
            cursor={{ fill: "var(--surface-2)" }}
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: "var(--text-2)" }}
            itemStyle={{ color: "var(--text)" }}
            labelFormatter={(_label, payload) => String(payload?.[0]?.payload?.full ?? _label)}
            formatter={(value, _name, item) => [`${fmt.number(Number(value))} · ${fmt.integer(Number((item as { payload?: { count?: number } }).payload?.count ?? 0))} ${countLabel.toLowerCase()}`, ""]}
          />
          <Bar dataKey="value" fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false}>
            <LabelList
              dataKey="value"
              position="top"
              content={(props) => {
                const { x, y, width, index, value } = props as { x?: number; y?: number; width?: number; index?: number; value?: number | string };
                if (index !== peak || x == null || y == null || width == null || !value) return null;
                return (
                  <text x={x + width / 2} y={y - 6} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--text)">
                    {fmt.number(Number(value))}
                  </text>
                );
              }}
            />
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
});
