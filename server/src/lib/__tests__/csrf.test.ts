import { describe, it, expect } from "vitest";
import { checkCsrf } from "../csrf";

function h(init: Record<string, string>): Headers {
  return new Headers(init);
}
const json = { "content-type": "application/json", host: "iqos.lan:3000" };

describe("checkCsrf", () => {
  it("lets reads through", () => {
    expect(checkCsrf("GET", "/api/stats", h({ origin: "https://evil.example", host: "iqos.lan:3000" }))).toBeNull();
  });

  it("accepts same-origin JSON writes (what the UI sends)", () => {
    expect(checkCsrf("POST", "/api/lang", h({ ...json, origin: "http://iqos.lan:3000" }))).toBeNull();
    expect(checkCsrf("PATCH", "/api/settings/devices", h({ "content-type": "application/json; charset=utf-8", host: "iqos.lan:3000" }))).toBeNull();
  });

  it("refuses text/plain and form posts (simple cross-site requests)", () => {
    expect(checkCsrf("POST", "/api/settings/users", h({ host: "iqos.lan:3000", "content-type": "text/plain" }))?.status).toBe(415);
    expect(checkCsrf("POST", "/api/settings/users", h({ host: "iqos.lan:3000", "content-type": "application/x-www-form-urlencoded" }))?.status).toBe(415);
    expect(checkCsrf("POST", "/api/settings/users", h({ host: "iqos.lan:3000", "content-type": "multipart/form-data; boundary=x" }))?.status).toBe(415);
    expect(checkCsrf("POST", "/api/settings/users", h({ host: "iqos.lan:3000" }))?.status).toBe(415);
  });

  it("refuses a foreign or opaque Origin even with JSON", () => {
    expect(checkCsrf("POST", "/api/lang", h({ ...json, origin: "https://evil.example" }))?.status).toBe(403);
    expect(checkCsrf("DELETE", "/api/settings/agents", h({ ...json, origin: "null" }))?.status).toBe(403);
    expect(checkCsrf("POST", "/api/lang", h({ ...json, origin: "http://iqos.lan:3001" }))?.status).toBe(403);
  });

  it("matches X-Forwarded-Host and TRUSTED_ORIGINS behind a proxy", () => {
    const behindProxy = { "content-type": "application/json", host: "10.0.0.5:3000", origin: "https://iqos.example.com" };
    expect(checkCsrf("POST", "/api/lang", h(behindProxy), "")?.status).toBe(403);
    expect(checkCsrf("POST", "/api/lang", h({ ...behindProxy, "x-forwarded-host": "iqos.example.com" }), "")).toBeNull();
    expect(checkCsrf("POST", "/api/lang", h(behindProxy), "https://other.example, https://iqos.example.com")).toBeNull();
  });

  it("allows a bodyless DELETE without content type, not one with a body", () => {
    expect(checkCsrf("DELETE", "/api/devices/ABC123/jobs", h({ host: "iqos.lan:3000", origin: "http://iqos.lan:3000" }))).toBeNull();
    expect(checkCsrf("DELETE", "/api/settings/users", h({ host: "iqos.lan:3000", "content-type": "text/plain", "content-length": "8" }))?.status).toBe(415);
  });

  it("leaves the agent API alone", () => {
    expect(checkCsrf("POST", "/api/agent/heartbeat", h({ host: "iqos.lan:3000", "content-type": "text/plain", origin: "https://evil.example" }))).toBeNull();
  });
});
