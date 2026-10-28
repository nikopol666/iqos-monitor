import { variantImage } from "@/lib/variants";

/** Product render of the device with a soft glow in the device's series colour. */
export function DeviceImage({ variant, color, name, size = 120, className = "" }: { variant: string; color: string; name: string; size?: number; className?: string }) {
  return (
    <div className={`relative flex shrink-0 items-end justify-center ${className}`} style={{ width: size * 0.7, height: size }}>
      <div className="absolute inset-x-2 bottom-1 top-6 rounded-full opacity-30 blur-xl" style={{ background: color }} aria-hidden />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={variantImage(variant)} alt={name} className="relative h-full w-auto object-contain drop-shadow-md" draggable={false} />
    </div>
  );
}
