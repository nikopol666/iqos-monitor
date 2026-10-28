import { cookies } from "next/headers";
import { getDb, schema } from "@/db";
import { listDevicesLabeled, listUsers } from "@/lib/queries";
import { LOCALE_COOKIE } from "@/lib/i18n";
import { SettingsClient } from "@/components/settings-client";
import { DEVICE_VARIANTS, defaultColorFor } from "@/lib/variants";
import { PALETTE } from "@/lib/palette";
import { colorsInUse } from "@/lib/ingest";

export default async function SettingsPage() {
  const agents = getDb()
    .select({
      id: schema.agents.id,
      name: schema.agents.name,
      keyPrefix: schema.agents.keyPrefix,
      lastSeenUtc: schema.agents.lastSeenUtc,
      hostname: schema.agents.hostname,
      version: schema.agents.version,
    })
    .from(schema.agents)
    .orderBy(schema.agents.id)
    .all();
  const override = (await cookies()).get(LOCALE_COOKIE)?.value ?? null;
  return (
    <SettingsClient
      users={listUsers()}
      devices={listDevicesLabeled().map((d) => ({
        serial: d.serial,
        name: d.rawName,
        label: d.name,
        userId: d.userId,
        model: d.model,
        lastSeenUtc: d.lastSeenUtc,
        color: d.color,
        variant: d.variant,
        defaultColor: defaultColorFor(d.variant, colorsInUse(d.serial)),
      }))}
      variants={DEVICE_VARIANTS}
      palette={PALETTE}
      agents={agents}
      envKeyConfigured={!!process.env.AGENT_API_KEY}
      override={override}
    />
  );
}
