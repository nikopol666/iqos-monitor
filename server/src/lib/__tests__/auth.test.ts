import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATABASE_PATH = path.join(mkdtempSync(path.join(os.tmpdir(), "iqos-test-")), "test.sqlite3");

// Imported after DATABASE_PATH is set so the module opens the temp file.
const { authenticateAgent, hashApiKey } = await import("../auth");
const { getSqlite, nowUtc } = await import("@/db");

function req(key?: string): Request {
  const headers: Record<string, string> = { "x-agent-name": "pc" };
  if (key !== undefined) headers["x-api-key"] = key;
  return new Request("http://localhost/api/agent/heartbeat", { method: "POST", headers });
}
const agentCount = () => (getSqlite().prepare("SELECT count(*) AS n FROM agents").get() as { n: number }).n;
function addAgent(key: string) {
  getSqlite()
    .prepare("INSERT INTO agents (name, api_key_hash, key_prefix, created_at_utc) VALUES (?, ?, ?, ?)")
    .run("known", hashApiKey(key), key.slice(0, 9), nowUtc());
}

describe("authenticateAgent", () => {
  const saved = { key: process.env.AGENT_API_KEY, auto: process.env.AGENT_AUTO_REGISTER };
  beforeEach(() => {
    getSqlite().prepare("DELETE FROM agents").run();
    delete process.env.AGENT_API_KEY;
    delete process.env.AGENT_AUTO_REGISTER;
  });
  afterEach(() => {
    if (saved.key === undefined) delete process.env.AGENT_API_KEY;
    else process.env.AGENT_API_KEY = saved.key;
    if (saved.auto === undefined) delete process.env.AGENT_AUTO_REGISTER;
    else process.env.AGENT_AUTO_REGISTER = saved.auto;
  });

  it("rejects a missing key", () => {
    expect(authenticateAgent(req())).toBeNull();
  });

  it("without AGENT_API_KEY registers the first agent (backwards compatible), then only its key", () => {
    const first = authenticateAgent(req("first-key"));
    expect(first?.id).toBeTypeOf("number");
    expect(agentCount()).toBe(1);
    expect(authenticateAgent(req("first-key"))?.id).toBe(first!.id);
    expect(authenticateAgent(req("other-key"))).toBeNull();
    expect(agentCount()).toBe(1);
  });

  it("AGENT_AUTO_REGISTER=false keeps an empty table closed", () => {
    process.env.AGENT_AUTO_REGISTER = "false";
    expect(authenticateAgent(req("first-key"))).toBeNull();
    expect(agentCount()).toBe(0);
  });

  it("with AGENT_API_KEY never auto-registers, even with no agents", () => {
    process.env.AGENT_API_KEY = "env-secret";
    expect(authenticateAgent(req("random-key"))).toBeNull();
    expect(agentCount()).toBe(0);
    expect(authenticateAgent(req("env-secret"))).toEqual({ id: null, name: "env" });
    expect(authenticateAgent(req("env-secre"))).toBeNull();
    expect(authenticateAgent(req("env-secret-longer"))).toBeNull();
  });

  it("with AGENT_API_KEY still accepts keys stored in the agents table", () => {
    process.env.AGENT_API_KEY = "env-secret";
    addAgent("iqos_stored");
    expect(authenticateAgent(req("iqos_stored"))?.name).toBe("known");
    expect(authenticateAgent(req("iqos_other"))).toBeNull();
  });
});
