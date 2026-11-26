import { NextResponse, type NextRequest } from "next/server";
import { checkCsrf } from "@/lib/csrf";

/** Refuses cross-site writes to the web API (see lib/csrf.ts). */
export function proxy(request: NextRequest) {
  const verdict = checkCsrf(request.method, request.nextUrl.pathname, request.headers);
  if (verdict) return NextResponse.json({ error: verdict.error }, { status: verdict.status });
  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
