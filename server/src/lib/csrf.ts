/**
 * Cross-site request guard for the web API. The app has no login of its own
 * (LAN, or behind an SSO proxy whose cookie a foreign page would ride on), so
 * a page on another site must not be able to change data with a simple form
 * or fetch POST. Writes therefore need a JSON body (cross-site JSON always
 * triggers a CORS preflight, which this API never grants) and, when the
 * browser names the origin, an origin on this host. /api/agent/ is exempt:
 * the agent is no browser and authenticates with its API key.
 */

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export type CsrfVerdict = { status: 403 | 415; error: string } | null;

function hostOf(value: string): string | null {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}

/** Hosts this server answers as: Host, X-Forwarded-Host and TRUSTED_ORIGINS. */
function allowedHosts(headers: Headers, trustedOrigins: string | undefined): Set<string> {
  const hosts = new Set<string>();
  const host = headers.get("host");
  if (host) hosts.add(host.trim().toLowerCase());
  for (const h of (headers.get("x-forwarded-host") ?? "").split(",")) {
    if (h.trim()) hosts.add(h.trim().toLowerCase());
  }
  for (const o of (trustedOrigins ?? "").split(",")) {
    const h = o.trim() && hostOf(o.trim());
    if (h) hosts.add(h);
  }
  return hosts;
}

function hasBody(headers: Headers): boolean {
  const length = headers.get("content-length");
  return (length !== null && length.trim() !== "0") || headers.has("transfer-encoding");
}

export function checkCsrf(method: string, pathname: string, headers: Headers, trustedOrigins = process.env.TRUSTED_ORIGINS): CsrfVerdict {
  if (!UNSAFE_METHODS.has(method.toUpperCase())) return null;
  if (!pathname.startsWith("/api/") || pathname.startsWith("/api/agent/")) return null;

  const origin = headers.get("origin");
  if (origin !== null) {
    const originHost = origin === "null" ? null : hostOf(origin);
    if (!originHost || !allowedHosts(headers, trustedOrigins).has(originHost)) return { status: 403, error: "cross-origin request refused" };
  }

  const mediaType = (headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  // A DELETE without a body carries no content type; browsers never send it
  // cross-site without a preflight anyway.
  const bodylessDelete = method.toUpperCase() === "DELETE" && !hasBody(headers);
  if (mediaType !== "application/json" && !bodylessDelete) return { status: 415, error: "content-type must be application/json" };
  return null;
}
