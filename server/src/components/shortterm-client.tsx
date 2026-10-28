"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useFormat, useI18n } from "@/lib/i18n/client";
import type { ShortTermStats } from "@/lib/shortterm";
import { colorCss } from "@/lib/palette";
import { Card, CardTitle, Stat } from "@/components/ui";

type Payload = ShortTermStats & { devices: { serial: string; name: string; color: string }[] };

function delta(now: number, before: number): string {
  if (!before) return "";
  const pct = Math.round(((now - before) / before) * 100);
  return pct === 0 ? "±0 %" : `${pct > 0 ? "+" : ""}${pct} %`;
}

/** Today / this week at a glance; refreshes every minute. */
export function ShortTermClient({ initial }: { initial: Payload }) {
  const { t, f } = useI18n();
  const fmt = useFormat();
  const [data, setData] = useState(initial);

  useEffect(() => {
    const id = setInterval(async () => {
      try {
        const res = await fetch("/api/shortterm", { cache: "no-store" });
        if (res.ok) setData((await res.json()) as Payload);
      } catch {
        /* keep last */
      }
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const rows = useMemo(
    () =>
      data.days.map((d) => {
        const row: Record<string, string | number> = { day: d.day, label: fmt.shortDateKey(d.day), full: fmt.dateKey(d.day), sessions: d.sessions, puffs: d.puffs };
        for (const dev of data.devices) {
          row[`s:${dev.serial}`] = d.perSerial[dev.serial]?.sessions ?? 0;
          row[`p:${dev.serial}`] = d.perSerial[dev.serial]?.puffs ?? 0;
        }
        return row;
      }),
    [data, fmt],
  );
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
        <Stat label={t.short.todayPuffs} value={fmt.integer(tot.today.puffs)} hint={`${t.short.yesterday}: ${fmt.integer(tot.yesterday.puffs)} ${delta(tot.today.puffs, tot.yesterday.puffs)}`} />
        <Stat
          label={t.short.weekSticks}
          value={fmt.integer(tot.week.sessions)}
          hint={`${f(t.short.perDay, { n: fmt.number(Math.round((tot.week.sessions / Math.max(1, tot.week.days)) * 10) / 10) })} · ${t.short.lastWeek}: ${fmt.integer(tot.lastWeek.sessions)}`}
        />
        <Stat
          label={t.short.weekPuffs}
          value={fmt.integer(tot.week.puffs)}
          hint={`${f(t.short.perDay, { n: fmt.integer(Math.round(tot.week.puffs / Math.max(1, tot.week.days))) })} · ${t.short.lastWeek}: ${fmt.integer(tot.lastWeek.puffs)}`}
        />
      </div>
      <Card>
        <CardTitle right={<span className="text-xs text-muted">{f(t.short.avg7, { sticks: fmt.number(tot.avg7.sessions), puffs: fmt.integer(tot.avg7.puffs) })}</span>}>{t.short.last7}</CardTitle>
        <div className="grid gap-4 md:grid-cols-2">
          <MiniChart title={t.stats.sticks} prefix="s" />
          <MiniChart title={t.stats.puffs} prefix="p" />
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

  function MiniChart({ title, prefix }: { title: string; prefix: "s" | "p" }) {
    const bars = data.devices.map((d) => ({ key: `${prefix}:${d.serial}`, name: d.name, color: colorCss(d.color) }));
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
                formatter={(value, name) => [fmt.integer(Number(value)), String(name)]}
              />
              {bars.map((b, i) => (
                <Bar key={b.key} dataKey={b.key} name={b.name} stackId="a" fill={b.color} stroke="var(--surface)" strokeWidth={1} radius={i === bars.length - 1 ? [3, 3, 0, 0] : 0} isAnimationActive={false} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    );
  }
}
