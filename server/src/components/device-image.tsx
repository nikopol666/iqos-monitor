"use client";

import { Zap } from "lucide-react";
import { variantImage } from "@/lib/variants";
import { colorCss } from "@/lib/palette";

/**
 * Product render with a glow in the device's chart colour.
 * - connected: the glow breathes slowly and the render floats
 * - syncing: the glow breathes fast and an expanding ring shows data transfer
 * - battery pill: sheen only while charging; a full, calm bar when charged
 */
export function DeviceImage({
  variant,
  color,
  name,
  size = 120,
  connected = false,
  syncing = false,
  charging = null,
  battery = null,
  className = "",
}: {
  variant: string;
  color: string;
  name: string;
  size?: number;
  connected?: boolean;
  syncing?: boolean;
  charging?: boolean | null;
  battery?: number | null;
  className?: string;
}) {
  const css = colorCss(color);
  const level = battery == null ? null : Math.max(0, Math.min(100, battery));
  const tone = level == null ? "var(--muted)" : level <= 15 ? "var(--critical)" : level <= 35 ? "var(--warning)" : "var(--good)";
  const glow = !connected ? "opacity-30" : syncing ? "anim-breathe-fast" : "anim-breathe";
  return (
    <div className={`relative flex shrink-0 flex-col items-center ${className}`} style={{ width: size * 0.7 }}>
      <div className="relative flex items-end justify-center" style={{ height: size, width: "100%" }}>
        <div className={`absolute inset-x-1 bottom-1 top-5 rounded-full blur-xl ${glow}`} style={{ background: css }} aria-hidden />
        {connected && syncing ? <div className="anim-ring absolute inset-x-0 bottom-2 top-6 rounded-full border-2" style={{ borderColor: css }} aria-hidden /> : null}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={variantImage(variant)}
          alt={name}
          className={`relative h-full w-auto object-contain drop-shadow-md ${connected ? "anim-float" : ""}`}
          draggable={false}
        />
      </div>
      {level != null && size >= 72 ? (
        <div className="mt-1.5 flex w-full items-center gap-1" title={`${level} %`}>
          <div className="relative h-2 flex-1 overflow-hidden rounded-full border border-border bg-surface-2">
            <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${level}%`, background: tone }} />
            {connected && charging ? <div className="anim-sheen absolute inset-y-0 w-1/3 rounded-full" aria-hidden /> : null}
          </div>
          {connected && charging ? <Zap size={10} className="anim-bolt text-good" aria-hidden /> : <div className="h-1.5 w-0.5 rounded-sm bg-border" aria-hidden />}
        </div>
      ) : null}
    </div>
  );
}
