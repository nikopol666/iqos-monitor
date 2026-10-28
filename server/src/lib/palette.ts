/**
 * Categorical chart palette with separately tuned light and dark steps
 * (dataviz reference palette; every adjacent pair passes the CVD checks).
 * A device colour is either a palette key ("violet") – rendered through the
 * theme-aware CSS variable – or a custom hex the user picked.
 */
export interface PaletteColor {
  key: string;
  light: string;
  dark: string;
}

export const PALETTE: PaletteColor[] = [
  { key: "blue", light: "#2a78d6", dark: "#3987e5" },
  { key: "orange", light: "#eb6834", dark: "#d95926" },
  { key: "aqua", light: "#1baf7a", dark: "#199e70" },
  { key: "yellow", light: "#eda100", dark: "#c98500" },
  { key: "magenta", light: "#e87ba4", dark: "#d55181" },
  { key: "green", light: "#008300", dark: "#008300" },
  { key: "violet", light: "#6250d6", dark: "#9085e9" },
  { key: "red", light: "#e34948", dark: "#e66767" },
];

export const PALETTE_KEYS = PALETTE.map((p) => p.key);
const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function isPaletteKey(value: unknown): value is string {
  return typeof value === "string" && PALETTE.some((p) => p.key === value);
}

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_RE.test(value);
}

export function isColorValue(value: unknown): value is string {
  return isPaletteKey(value) || isHexColor(value);
}

/** CSS colour usable in inline styles and SVG fills. */
export function colorCss(value: string | null | undefined): string {
  if (isPaletteKey(value)) return `var(--series-${value})`;
  if (isHexColor(value)) return value;
  return "var(--series-blue)";
}

/** Concrete hex for a given theme (used for contrast checks and tooltips). */
export function colorHex(value: string | null | undefined, mode: "light" | "dark"): string {
  const p = PALETTE.find((c) => c.key === value);
  if (p) return p[mode];
  return isHexColor(value) ? value : PALETTE[0][mode];
}

/** Map a legacy stored hex back to its palette key when it matches a light step. */
export function normaliseColor(value: string | null | undefined): string {
  if (isPaletteKey(value)) return value;
  const match = PALETTE.find((p) => p.light.toLowerCase() === (value ?? "").toLowerCase() || p.dark.toLowerCase() === (value ?? "").toLowerCase());
  return match ? match.key : isHexColor(value) ? value : PALETTE[0].key;
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

export const SURFACES = { light: "#ffffff", dark: "#1a1a19" } as const;

/** Modes in which a custom colour falls below 3:1 against the chart surface. */
export function lowContrastModes(value: string): ("light" | "dark")[] {
  if (!isHexColor(value)) return [];
  return (["light", "dark"] as const).filter((m) => contrastRatio(value, SURFACES[m]) < 3);
}
