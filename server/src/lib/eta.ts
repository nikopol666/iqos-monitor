/**
 * Remaining-time estimate from the recent progress rate (sliding 40 s window).
 * Call `update` from the polling callback; it returns seconds, or null until the
 * rate is known.
 */
export class EtaTracker {
  private samples: { t: number; done: number }[] = [];
  private last: number | null = null;

  update(done: number | null | undefined, total: number | null | undefined, active: boolean, now = Date.now()): number | null {
    if (!active || done == null || !total) {
      this.samples = [];
      this.last = null;
      return null;
    }
    const tail = this.samples[this.samples.length - 1];
    if (!tail || tail.done !== done) this.samples.push({ t: now, done });
    this.samples = this.samples.filter((s) => now - s.t <= 40_000);
    const first = this.samples[0];
    const latest = this.samples[this.samples.length - 1];
    if (first && latest !== first && latest.done > first.done) {
      const rate = (latest.done - first.done) / ((latest.t - first.t) / 1000); // ids per second
      if (rate > 0) this.last = Math.max(0, Math.round((total - done) / rate));
    }
    return this.last;
  }
}

export function formatEta(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${String(m % 60).padStart(2, "0")} min`;
}
