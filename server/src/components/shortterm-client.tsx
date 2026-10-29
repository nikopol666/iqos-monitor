"use client";

import Link from "next/link";
import { memo, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useFormat, useI18n } from "@/lib/i18n/client";
import type { ShortTermStats } from "@/lib/shortterm";
import { colorCss } from "@/lib/palette";
import { Card, CardTitle, Stat } from "@/components/ui";

export type ShortTermPayload = ShortTermStats & { devices: { serial: string; name: string; color: string }[] };
type Payload = ShortTermPayload;
type Row = Record<string, string | number>;

function delta(now: number, before: number): string {
  if (!before) return "";
  const pct = Math.round(((now - before) / before) * 100);
  return pct === 0 ? "±0 %" : `${pct > 0 ? "+" : ""}${pct} %`;
}

/** Today / this week at a glance for one user (or all); refreshes every minute. */
export function ShortTermClient({ initial, userId }: { initial: Payload | null; userId: number | "all" }) {
  const { t, f } = useI18n();
  const fmt = useFormat();
  const [data, setData] = useState(initial);

  useEffect(() => {
    let active = true;
    let last = initial ? JSON.stringify(initial) : "";
    const load = async () => {
      try {
        const res = await fetch(`/api/shortterm?user=${userId}`, { cache: "no-store" });
        if (!res.ok || !active) return;
        const next = (await res.json()) as Payload;
        const json = JSON.stringify(next);
        if (json !== last) {
          last = json;
          setData(next);
        }
      } catch {
        /* keep last */
      }
    };
    if (!initial) void load();
    const id = setInterval(load, 60_000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [initial, userId]);

  const shortDateKey = fmt.shortDateKey;
  const dateKey = fmt.dateKey;
  const rows = useMemo<Row[]>(
    () =>
      (data?.days ?? []).map((d) => {
        const row: Row = { day: d.day, label: shortDateKey(d.day), full: dateKey(d.day), sessions: d.sessions, puffs: d.puffs };
        for (const dev of data?.devices ?? []) {
          const ps = d.perSerial[dev.serial];
          row[`s:${dev.serial}`] = ps?.sessions ?? 0;
          row[`p:${dev.serial}`] = ps && ps.sessions ? Math.round((ps.puffs / ps.sessions) * 10) / 10 : 0;
        }
        return row;
      }),
    [data, shortDateKey, dateKey],
  );
  if (!data) return null;
  const multi = data.devices.length > 1;
  const tot = data.totals;

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">{t.short.title}</h2>
        <Link href="/stats" className="text-sm text-accent hover:underline">
          {t.short.detail} →
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={t.short.todaySticks} value={fmt.integer(tot.today.sessions)} hint={`${t.short.yesterday}: ${fmt.integer(tot.yesterday.sessions)} ${delta(tot.today.sessions, tot.yesterday.sessions)}`} />
        <Stat label={t.short.todayPuffsPerStick} value={fmt.number(tot.derived.todayPuffsPerStick)} hint={`${t.short.yesterday}: ${fmt.number(tot.derived.yesterdayPuffsPerStick)}`} />
        <Stat
          label={t.short.weekSticksPerDay}
          value={fmt.number(tot.derived.weekSticksPerDay)}
          hint={`${f(t.short.totalWeek, { n: fmt.integer(tot.week.sessions) })} · ${t.short.lastWeek}: ${f(t.short.perDay, { n: fmt.number(tot.derived.lastWeekSticksPerDay) })}`}
        />
        <Stat label={t.short.weekPuffsPerStick} value={fmt.number(tot.derived.weekPuffsPerStick)} hint={`${t.short.lastWeek}: ${fmt.number(tot.derived.lastWeekPuffsPerStick)}`} />
      </div>
      <Card>
        <CardTitle right={<span className="text-xs text-muted">{f(t.short.avg7, { sticks: fmt.number(tot.avg7.sessions), puffs: fmt.number(tot.derived.avg7PuffsPerStick) })}</span>}>{t.short.last7}</CardTitle>
        <div className="grid gap-4 md:grid-cols-2">
          <MiniChart title={t.stats.sticks} prefix="s" rows={rows} devices={data.devices} />
          <MiniChart title={t.short.puffsPerStick} prefix="p" rows={rows} devices={data.devices} stacked={false} />
        </div>
        {multi ? (
          <div className="mt-2 flex flex-wrap gap-3 text-xs text-text-2">
            {data.devices.map((d) => (
              <span key={d.serial} className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: colorCss(d.color) }} aria-hidden />
                {d.name}: {fmt.integer(data.perSerial[d.serial]?.today.sessions ?? 0)} / {fmt.integer(data.perSerial[d.serial]?.today.puffs ?? 0)} {t.common.today.toLowerCase()}
              </span>
            ))}
          </div>
        ) : null}
      </Card>
    </section>
  );
}

const MiniChart = memo(function MiniChart({ title, prefix, rows, devices, stacked = true }: { title: string; prefix: "s" | "p"; rows: Row[]; devices: { serial: string; name: string; color: string }[]; stacked?: boolean }) {
  const fmt = useFormat();
  const bars = devices.map((d) => ({ key: `${prefix}:${d.serial}`, name: d.name, color: colorCss(d.color) }));
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-text-2">{title}</div>
      <div className="h-36 w-full">
        <ResponsiveContainer>
          <BarChart data={rows} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="30%">
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--text-2)" }} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
            <YAxis tick={{ fontSize: 10, fill: "var(--text-2)" }} tickLine={false} axisLine={false} width={28} allowDecimals={false} />
            <Tooltip
              cursor={{ fill: "var(--surface-2)" }}
              contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--text)" }}
              labelStyle={{ color: "var(--text-2)" }}
              itemStyle={{ color: "var(--text)" }}
              labelFormatter={(_l, payload) => String(payload?.[0]?.payload?.full ?? _l)}
              formatter={(value, name) => [prefix === "p" ? fmt.number(Number(value)) : fmt.integer(Number(value)), String(name)]}
            />
            {bars.map((b, i) => (
              <Bar key={b.key} dataKey={b.key} name={b.name} stackId={stacked ? "a" : undefined} fill={b.color} stroke="var(--surface)" strokeWidth={1} radius={!stacked || i === bars.length - 1 ? [3, 3, 0, 0] : 0} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
});
