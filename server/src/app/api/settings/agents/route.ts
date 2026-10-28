import { eq } from "drizzle-orm";
import { badRequest, json, readJson } from "@/lib/api";
import { getDb, nowUtc, schema } from "@/db";
import { generateApiKey, hashApiKey } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const agents = getDb()
    .select({
      id: schema.agents.id,
      name: schema.agents.name,
      keyPrefix: schema.agents.keyPrefix,
      createdAtUtc: schema.agents.createdAtUtc,
      lastSeenUtc: schema.agents.lastSeenUtc,
      version: schema.agents.version,
      hostname: schema.agents.hostname,
    })
    .from(schema.agents)
    .orderBy(schema.agents.id)
    .all();
  return json({ agents, envKeyConfigured: !!process.env.AGENT_API_KEY });
}

/** Creates an agent and returns its API key exactly once. */
export async function POST(request: Request) {
  const body = await readJson<{ name?: string }>(request);
  const name = body?.name?.trim() || "agent";
  const key = generateApiKey();
  const agent = getDb()
    .insert(schema.agents)
    .values({ name: name.slice(0, 60), apiKeyHash: hashApiKey(key), keyPrefix: key.slice(0, 9), createdAtUtc: nowUtc() })
    .returning({ id: schema.agents.id, name: schema.agents.name, keyPrefix: schema.agents.keyPrefix })
    .get();
  return json({ ok: true, agent, api_key: key });
}

export async function DELETE(request: Request) {
  const body = await readJson<{ id?: number }>(request);
  if (!body || !Number.isInteger(body.id)) return badRequest("id required");
  getDb().delete(schema.agents).where(eq(schema.agents.id, body.id!)).run();
  return json({ ok: true });
}
