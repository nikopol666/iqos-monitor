import { describe, it, expect } from "vitest";
import { computeStats } from "../stats";
import { isoWeekKey, isoWeekStart, localDateKey, localMidnightUtc, daysBetweenInclusive, addDays, weekStartOf, monthEnd } from "../time";

describe("time helpers (Europe/Prague)", () => {
  it("maps UTC instants to local calendar days across DST", () => {
    // 2026-10-26T19:02:00Z is 20:02 CET (DST ended 2026-10-25).
    expect(localDateKey(new Date("2026-10-26T19:02:00Z"), "Europe/Prague")).toBe("2026-10-26");
    // 23:30Z in summer is already the next day locally (CEST = UTC+2).
    expect(localDateKey(new Date("2026-07-01T23:30:00Z"), "Europe/Prague")).toBe("2026-07-02");
  });
  it("computes local midnight in UTC on both sides of DST", () => {
    expect(localMidnightUtc("2026-07-01", "Europe/Prague").toISOString()).toBe("2026-06-30T22:00:00.000Z");
    expect(localMidnightUtc("2026-12-01", "Europe/Prague").toISOString()).toBe("2026-11-30T23:00:00.000Z");
  });
  it("iso weeks", () => {
    expect(isoWeekKey("2026-01-01")).toBe("2026-W01");
    expect(isoWeekStart("2026-01-01")).toBe("2025-12-29");
    expect(isoWeekKey("2025-12-29")).toBe("2026-W01");
    expect(isoWeekKey("2026-10-26")).toBe("2026-W44");
  });
  it("week start by first day and month end", () => {
    expect(weekStartOf("2026-11-01", 1)).toBe("2026-10-26"); // Sunday -> Monday before
    expect(weekStartOf("2026-11-01", 7)).toBe("2026-11-01"); // Sunday-start week begins today
    expect(weekStartOf("2026-10-31", 7)).toBe("2026-10-25");
    expect(weekStartOf("2026-10-31", 6)).toBe("2026-10-31");
    expect(monthEnd("2026-02-10")).toBe("2026-02-28");
    expect(monthEnd("2026-11-05")).toBe("2026-11-30");
  });
  it("day arithmetic", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
    expect(daysBetweenInclusive("2026-10-01", "2026-10-31")).toBe(31);
  });
});

describe("computeStats", () => {
  const rows = [
    { serial: "A", timestampUtc: "2026-10-26T19:02:00+00:00", puffCount: 18, clockSuspect: 0, puffPairsJson: JSON.stringify(["1301", "1901", "8944"]) },
    { serial: "A", timestampUtc: "2026-10-26T08:00:00+00:00", puffCount: 0, clockSuspect: 0 },
    { serial: "B", timestampUtc: "2026-10-27T10:00:00+00:00", puffCount: 14, clockSuspect: 1 },
    { serial: "B", timestampUtc: "2026-09-01T10:00:00+00:00", puffCount: 10, clockSuspect: 0 }, // outside
  ];
  it("groups by day with empty buckets and averages per calendar/active day", () => {
    const r = computeStats(rows, "2026-10-25", "2026-10-28", "day", "Europe/Prague");
    expect(r.byHour).toHaveLength(24);
    expect(r.byWeekday).toHaveLength(7);
    expect(r.byHour.reduce((a, b) => a + b, 0)).toBe(r.totals.sessions);
    expect(r.byWeekday.reduce((a, b) => a + b, 0)).toBe(r.totals.sessions);
    expect(r.totals.avgLastPuffS).toBe(274);
    expect(r.totals.avgFirstPuffS).toBe(38);
    expect(r.buckets.find((b) => b.sessions > 0 && b.avgLastPuffS != null)?.avgLastPuffS).toBe(274);
    expect(r.buckets.map((b) => b.key)).toEqual(["2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28"]);
    expect(r.buckets[1]).toMatchObject({ records: 2, sessions: 1, puffs: 18 });
    expect(r.buckets[2]).toMatchObject({ records: 1, sessions: 1, puffs: 14, suspect: 1 });
    expect(r.totals).toMatchObject({
      records: 3,
      sessions: 2,
      puffs: 32,
      suspect: 1,
      daysInRange: 4,
      daysWithData: 2,
      avgRecordsPerDay: 0.75,
      avgPuffsPerDay: 8,
      avgPuffsPerActiveDay: 16,
      avgPuffsPerSession: 16,
    });
    expect(r.buckets[1].perSerial.A).toEqual({ records: 2, sessions: 1, puffs: 18 });
  });
  it("groups by week and month", () => {
    const w = computeStats(rows, "2026-10-19", "2026-11-01", "week", "Europe/Prague");
    expect(w.buckets.map((b) => b.key)).toEqual(["2026-10-19", "2026-10-26"]);
    expect(w.buckets[1]).toMatchObject({ start: "2026-10-26", end: "2026-11-01", days: 7, puffs: 32 });
    const sunday = computeStats(rows, "2026-10-19", "2026-11-01", "week", "Europe/Prague", 7);
    expect(sunday.buckets.map((b) => b.key)).toEqual(["2026-10-18", "2026-10-25", "2026-11-01"]);
    const hours = computeStats(rows, "2026-10-26", "2026-10-26", "hour", "Europe/Prague");
    expect(hours.buckets).toHaveLength(24);
    expect(hours.buckets.find((b) => b.key === "2026-10-26T20")?.sessions).toBe(1); // 19:02Z = 20:02 CET
    expect(hours.buckets.find((b) => b.key === "2026-10-26T09")?.records).toBe(1);
    const m = computeStats(rows, "2026-09-01", "2026-10-31", "month", "Europe/Prague");
    expect(m.buckets.map((b) => b.key)).toEqual(["2026-09", "2026-10"]);
    expect(m.buckets[0].puffs).toBe(10);
    expect(m.buckets[1].puffs).toBe(32);
    expect(m.totals.daysInRange).toBe(61);
  });
});
