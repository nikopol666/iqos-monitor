/**
 * Device image variants shipped in /public/devices. Images are official IQOS
 * product renders (iqos.com); add a new variant by dropping a PNG with a
 * transparent background and registering it here.
 */
export interface DeviceVariant {
  key: string;
  model: string;
  colour: string;
  /** Suggested series colour matching the device finish. */
  suggestedColor: string;
}

export const DEVICE_VARIANTS: DeviceVariant[] = [
  { key: "iluma-i-one-breeze-blue", model: "ILUMA i ONE", colour: "Breeze Blue", suggestedColor: "#1baf7a" },
  { key: "iluma-i-one-digital-violet", model: "ILUMA i ONE", colour: "Digital Violet", suggestedColor: "#6250d6" },
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
