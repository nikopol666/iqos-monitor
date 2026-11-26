import { describe, it, expect } from "vitest";
import { isDateKey, statsRangeError } from "../time";

describe("isDateKey", () => {
  it("accepts real dates", () => {
    for (const d of ["2026-01-01", "2026-02-28", "2024-02-29", "2000-02-29", "2026-12-31"]) expect(isDateKey(d)).toBe(true);
  });
  it("rejects impossible or malformed dates", () => {
    for (const d of ["2026-02-31", "2026-02-29", "1900-02-29", "2026-04-31", "2026-13-01", "2026-00-10", "2026-01-00", "2026-1-01", "x", "", null, 20260101]) {
      expect(isDateKey(d)).toBe(false);
    }
  });
});

describe("statsRangeError", () => {
  it("accepts the ranges the UI asks for", () => {
    expect(statsRangeError("2026-11-26", "2026-11-26", "hour")).toBeNull();
    expect(statsRangeError("2026-11-01", "2026-11-30", "day")).toBeNull();
    expect(statsRangeError("2025-11-27", "2026-11-26", "week")).toBeNull();
    expect(statsRangeError("2015-01-01", "2026-11-26", "month")).toBeNull();
  });
  it("caps hours at 31 days", () => {
    expect(statsRangeError("2026-01-01", "2026-01-31", "hour")).toBeNull();
    expect(statsRangeError("2026-01-01", "2026-02-01", "hour")).toBe("range too large for group");
  });
  it("caps days and weeks at about five years", () => {
    expect(statsRangeError("2021-01-01", "2025-12-31", "day")).toBeNull();
    expect(statsRangeError("2015-01-01", "2026-11-26", "day")).toBe("range too large for group");
    expect(statsRangeError("2015-01-01", "2026-11-26", "week")).toBe("range too large for group");
  });
  it("keeps years within 2010–2100", () => {
    expect(statsRangeError("2010-01-01", "2059-12-31", "month")).toBeNull();
    expect(statsRangeError("2009-12-31", "2010-01-31", "day")).toBe("range out of bounds");
    expect(statsRangeError("2100-12-01", "2101-01-01", "day")).toBe("range out of bounds");
    expect(statsRangeError("0001-01-01", "9999-12-31", "month")).toBe("range out of bounds");
  });
  it("rejects bad dates, reversed ranges and unknown groups", () => {
    expect(statsRangeError("2026-02-31", "2026-03-01", "day")).toBe("invalid range");
    expect(statsRangeError("2026-03-02", "2026-03-01", "day")).toBe("invalid range");
    expect(statsRangeError("2026-03-01", "2026-03-02", "year")).toBe("invalid group");
  });
});
