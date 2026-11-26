import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, nowUtc, schema } from "@/db";
import type { Agent } from "@/db/schema";

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** Random key the user pastes into the agent settings (shown once). */
export function generateApiKey(): string {
  return "iqos_" + randomBytes(24).toString("base64url");
}

export type AgentIdentity = { id: number | null; name: string };

/** Constant-time string comparison (hashing first hides the length too). */
function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}

/**
 * First-contact registration: while the agents table is empty, any key is
 * accepted and stored. Only without AGENT_API_KEY (that variable already
 * says which key is valid), and AGENT_AUTO_REGISTER=false turns it off.
 */
export function autoRegisterEnabled(): boolean {
  if (process.env.AGENT_API_KEY?.trim()) return false;
  const flag = process.env.AGENT_AUTO_REGISTER?.trim().toLowerCase();
  return !(flag === "false" || flag === "0" || flag === "no" || flag === "off");
}

/**
 * Validates X-Api-Key against the fixed AGENT_API_KEY environment variable
 * (handy for docker-compose) and the keys stored in the agents table. See
 * autoRegisterEnabled() for the first-contact case.
 */
export function authenticateAgent(request: Request): AgentIdentity | null {
  const key = request.headers.get("x-api-key")?.trim();
  if (!key) return null;
  const envKey = process.env.AGENT_API_KEY?.trim();
  if (envKey && safeEqual(key, envKey)) return { id: null, name: "env" };
  const db = getDb();
  const hash = hashApiKey(key);
  const found = db.select().from(schema.agents).where(eq(schema.agents.apiKeyHash, hash)).get();
  if (found) {
    db.update(schema.agents).set({ lastSeenUtc: nowUtc() }).where(eq(schema.agents.id, found.id)).run();
    return { id: found.id, name: found.name };
  }
  if (!autoRegisterEnabled()) return null;
  const anyAgent = db.select({ id: schema.agents.id }).from(schema.agents).limit(1).get();
  if (!anyAgent) {
    const created = db
      .insert(schema.agents)
      .values({
        name: request.headers.get("x-agent-name") || "agent",
        apiKeyHash: hash,
        keyPrefix: key.slice(0, 9),
        createdAtUtc: nowUtc(),
        lastSeenUtc: nowUtc(),
        hostname: request.headers.get("x-agent-host"),
        version: request.headers.get("x-agent-version"),
      })
      .returning()
      .get();
    return { id: created.id, name: created.name };
  }
  return null;
}

export function touchAgent(identity: AgentIdentity, request: Request): void {
  if (identity.id === null) return;
  const db = getDb();
  const patch: Partial<Agent> = { lastSeenUtc: nowUtc() };
  const host = request.headers.get("x-agent-host");
  const version = request.headers.get("x-agent-version");
  if (host) patch.hostname = host;
  if (version) patch.version = version;
  db.update(schema.agents).set(patch).where(eq(schema.agents.id, identity.id)).run();
}

export function unauthorized(): Response {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}
