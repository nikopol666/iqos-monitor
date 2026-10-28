import { describe, it, expect } from "vitest";
import { negotiateLocale, resolveLocale, fmt, DICTIONARIES } from "../index";
import { en } from "../en";

function keys(obj: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" ? keys(v as Record<string, unknown>, prefix + k + ".") : [prefix + k],
  );
}

describe("i18n", () => {
  it("negotiates from Accept-Language", () => {
    expect(negotiateLocale("cs-CZ,cs;q=0.9,en;q=0.8")).toBe("cs");
    expect(negotiateLocale("de-DE,de;q=0.9")).toBe("en");
    expect(negotiateLocale("en-GB;q=0.5, cs;q=0.9")).toBe("cs");
    expect(negotiateLocale(null)).toBe("en");
  });
  it("cookie overrides browser", () => {
    expect(resolveLocale("en", "cs")).toBe("en");
    expect(resolveLocale("xx", "cs")).toBe("cs");
  });
  it("interpolates", () => {
    expect(fmt("Offline since {time}", { time: "10:00" })).toBe("Offline since 10:00");
  });
  it("every dictionary has the same keys as English", () => {
    const expected = keys(en).sort();
    for (const [code, dict] of Object.entries(DICTIONARIES)) {
      expect(keys(dict).sort(), code).toEqual(expected);
    }
  });
});
