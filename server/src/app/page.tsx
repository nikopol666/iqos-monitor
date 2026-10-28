import { overview } from "@/lib/queries";
import { OverviewClient } from "@/components/overview-client";

export default async function OverviewPage() {
  const devices = overview();
  return <OverviewClient initial={devices} />;
}
