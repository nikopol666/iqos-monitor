import { json } from "@/lib/api";
import { overview } from "@/lib/queries";

export const dynamic = "force-dynamic";

/** Polled by the overview page every second. */
export async function GET() {
  return json({ devices: overview(), now: new Date().toISOString() });
}
