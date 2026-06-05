import { NextRequest, NextResponse } from "next/server";
import { HEYGEN_API_KEY, HEYGEN_SESSION_TOKEN_URL, buildHeygenTokenBody } from "@/lib/heygen-config";
import { rateLimit, rateLimitKey } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const preferredRegion = "bom1";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const learnerId =
    body && typeof body === "object" && typeof (body as { learnerId?: unknown }).learnerId === "string"
      ? String((body as { learnerId: string }).learnerId).slice(0, 120)
      : null;
  const lang =
    body && typeof body === "object" && typeof (body as { lang?: unknown }).lang === "string"
      ? String((body as { lang: string }).lang)
      : "en";

  if (!["bn", "hi", "en"].includes(lang)) {
    return NextResponse.json({ error: "Invalid lang" }, { status: 400 });
  }

  const rl = rateLimit(rateLimitKey(req.headers, learnerId, "heygen-session"), 3);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many avatar sessions. Please wait.", retryInSeconds: rl.resetInSeconds },
      { status: 429, headers: { "Retry-After": String(rl.resetInSeconds) } },
    );
  }

  if (!HEYGEN_API_KEY) {
    return NextResponse.json({ error: "HeyGen avatar is not configured" }, { status: 503 });
  }

  const res = await fetch(HEYGEN_SESSION_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": HEYGEN_API_KEY,
    },
    body: JSON.stringify(buildHeygenTokenBody(lang as "bn" | "hi" | "en")),
  });

  const data = (await res.json().catch(() => null)) as
    | { code?: number; data?: { session_id?: string; session_token?: string }; message?: string }
    | null;

  if (!res.ok || !data?.data?.session_token) {
    const detail = data?.message ?? res.statusText;
    console.error("HeyGen session-token error:", res.status, detail);
    return NextResponse.json(
      { error: "Failed to create avatar session", detail },
      { status: res.status >= 500 ? 502 : res.status || 502 },
    );
  }

  return NextResponse.json({
    sessionToken: data.data.session_token,
    sessionId: data.data.session_id ?? null,
  });
}
