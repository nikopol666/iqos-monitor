/**
 * Device image variants shipped in /public/devices. Images are official IQOS
 * product renders (iqos.com product codes G0002077…G0002612); add a new
 * variant by dropping a PNG with a transparent background and registering it
 * here.
 */
export interface DeviceVariant {
  key: string;
  model: string;
  colour: string;
  /** Suggested series colour: readable on light and dark surfaces, roughly matching the finish. */
  suggestedColor: string;
}

export const DEVICE_VARIANTS: DeviceVariant[] = [
  { key: "iluma-i-one-midnight-black", model: "ILUMA i ONE", colour: "Midnight Black", suggestedColor: "#2a78d6" },
  { key: "iluma-i-one-electric-purple", model: "ILUMA i ONE", colour: "Electric Purple", suggestedColor: "#6250d6" },
  { key: "iluma-i-one-breeze-blue", model: "ILUMA i ONE", colour: "Breeze Blue", suggestedColor: "#1baf7a" },
  { key: "iluma-i-one-leaf-green", model: "ILUMA i ONE", colour: "Leaf Green", suggestedColor: "#008300" },
  { key: "iluma-i-one-digital-violet", model: "ILUMA i ONE", colour: "Digital Violet", suggestedColor: "#9085e9" },
  { key: "iluma-i-one-vivid-terracotta", model: "ILUMA i ONE", colour: "Vivid Terracotta", suggestedColor: "#eb6834" },
  { key: "iluma-i", model: "ILUMA i", colour: "Breeze Blue", suggestedColor: "#2a78d6" },
  { key: "iluma-i-prime", model: "ILUMA i PRIME", colour: "Garnet Red", suggestedColor: "#e34948" },
];

export const DEFAULT_VARIANT = DEVICE_VARIANTS[0].key;

export function isVariant(key: unknown): key is string {
  return typeof key === "string" && DEVICE_VARIANTS.some((v) => v.key === key);
}

export function variantImage(key: string | null | undefined): string {
  return `/devices/${isVariant(key) ? key : DEFAULT_VARIANT}.png`;
}
