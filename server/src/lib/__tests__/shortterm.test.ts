import { describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATABASE_PATH = path.join(mkdtempSync(path.join(os.tmpdir(), "iqos-short-")), "test.sqlite3");
const { shortTermStats } = await import("../shortterm");
const { addDays, todayKey, DISPLAY_TZ } = await import("../time");

describe("shortTermStats 7-day window", () => {
  it("ends yesterday by default (today is not over) and today on request", () => {
    const today = todayKey(DISPLAY_TZ);
    const closed = shortTermStats(["DEVICEA0000001"]);
    expect(closed.includesToday).toBe(false);
    expect(closed.days).toHaveLength(7);
    expect(closed.days[6].day).toBe(addDays(today, -1));
    expect(closed.days[0].day).toBe(addDays(today, -7));
    const open = shortTermStats(["DEVICEA0000001"], undefined, true);
    expect(open.includesToday).toBe(true);
    expect(open.days[6].day).toBe(today);
  });
});
