/**
 * Device image variants shipped in /public/devices. Images are official IQOS
 * product renders (iqos.com product codes G0002077…G0002612); add a new
 * variant by dropping a PNG with a transparent background and registering it
 * here.
 */
import { PALETTE_KEYS } from "./palette";

export interface DeviceVariant {
  key: string;
  model: string;
  colour: string;
  /** Palette key closest to the finish; the device's default chart colour. */
  paletteKey: string;
}

export const DEVICE_VARIANTS: DeviceVariant[] = [
  { key: "iluma-i-one-midnight-black", model: "ILUMA i ONE", colour: "Midnight Black", paletteKey: "graphite" },
  { key: "iluma-i-one-electric-purple", model: "ILUMA i ONE", colour: "Electric Purple", paletteKey: "violet" },
  { key: "iluma-i-one-breeze-blue", model: "ILUMA i ONE", colour: "Breeze Blue", paletteKey: "aqua" },
  { key: "iluma-i-one-leaf-green", model: "ILUMA i ONE", colour: "Leaf Green", paletteKey: "green" },
  { key: "iluma-i-one-digital-violet", model: "ILUMA i ONE", colour: "Digital Violet", paletteKey: "magenta" },
  { key: "iluma-i-one-vivid-terracotta", model: "ILUMA i ONE", colour: "Vivid Terracotta", paletteKey: "orange" },
  { key: "iluma-i", model: "ILUMA i", colour: "Breeze Blue", paletteKey: "aqua" },
  { key: "iluma-i-prime", model: "ILUMA i PRIME", colour: "Garnet Red", paletteKey: "red" },
];

export const DEFAULT_VARIANT = DEVICE_VARIANTS[0].key;

export function isVariant(key: unknown): key is string {
  return typeof key === "string" && DEVICE_VARIANTS.some((v) => v.key === key);
}

export function variantImage(key: string | null | undefined): string {
  return `/devices/${isVariant(key) ? key : DEFAULT_VARIANT}.png`;
}

/**
 * Default chart colour for a finish: its palette key, unless another device
 * already uses it – then the first palette key nobody uses yet.
 */
export function defaultColorFor(variant: string, colorsInUse: string[]): string {
  const preferred = DEVICE_VARIANTS.find((v) => v.key === variant)?.paletteKey ?? PALETTE_KEYS[0];
  if (!colorsInUse.includes(preferred)) return preferred;
  return PALETTE_KEYS.find((k) => !colorsInUse.includes(k)) ?? preferred;
}

/**
 * Display label: the user-given name, otherwise "<model> · <finish>", with the
 * serial tail appended when another unnamed device shares the same finish.
 */
export function deviceLabel(
  name: string | null | undefined,
  variant: string,
  serial: string,
  siblings: { serial: string; variant: string; name: string | null }[] = [],
): string {
  const clean = (name ?? "").trim();
  if (clean) return clean;
  const v = DEVICE_VARIANTS.find((x) => x.key === variant) ?? DEVICE_VARIANTS[0];
  const base = `${v.model} · ${v.colour}`;
  const clash = siblings.some((d) => d.serial !== serial && d.variant === variant && !(d.name ?? "").trim());
  return clash ? `${base} (${serial.slice(-4)})` : base;
}
