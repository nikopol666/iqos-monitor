import { describe, expect, it } from "vitest";
import { EtaTracker, formatEta } from "../eta";

describe("EtaTracker", () => {
  it("needs two samples with progress, then extrapolates from the window rate", () => {
    const t = new EtaTracker();
    expect(t.update(0, 1000, true, 0)).toBeNull();
    expect(t.update(0, 1000, true, 1000)).toBeNull(); // no progress yet
    expect(t.update(10, 1000, true, 10_000)).toBe(990); // 1 id/s → 990 s
    expect(t.update(10, 1000, true, 11_000)).toBe(990); // unchanged progress keeps last estimate
    expect(t.update(40, 1000, true, 20_000)).toBe(480); // 40 ids in 20 s → 2 id/s
  });
  it("resets when the job stops", () => {
    const t = new EtaTracker();
    t.update(0, 100, true, 0);
    t.update(50, 100, true, 10_000);
    expect(t.update(50, 100, false)).toBeNull();
  });
});

describe("formatEta", () => {
  it("formats seconds, minutes and hours", () => {
    expect(formatEta(45)).toBe("45 s");
    expect(formatEta(600)).toBe("10 min");
    expect(formatEta(3660)).toBe("1 h 01 min");
  });
});
