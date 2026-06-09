import { NextRequest, NextResponse } from "next/server";
import {
  TAVUS_API_KEY,
  TAVUS_CONVERSATIONS_URL,
  buildTavusConversationBody,
} from "@/lib/tavus-config";
import { rateLimit, rateLimitKey } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const preferredRegion = "bom1";

/** POST — create a Tavus conversation and return the Daily room url to join. */
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

  const rl = rateLimit(rateLimitKey(req.headers, learnerId, "tavus-conversation"), 3);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many avatar sessions. Please wait.", retryInSeconds: rl.resetInSeconds },
      { status: 429, headers: { "Retry-After": String(rl.resetInSeconds) } },
    );
  }

  if (!TAVUS_API_KEY) {
    return NextResponse.json({ error: "Tavus avatar is not configured" }, { status: 503 });
  }

  const res = await fetch(TAVUS_CONVERSATIONS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": TAVUS_API_KEY,
    },
    body: JSON.stringify(buildTavusConversationBody(lang as "bn" | "hi" | "en")),
  });

  const data = (await res.json().catch(() => null)) as
    | { conversation_id?: string; conversation_url?: string; status?: string; message?: string }
    | null;

  if (!res.ok || !data?.conversation_url) {
    const detail = data?.message ?? res.statusText;
    console.error("Tavus create-conversation error:", res.status, detail);
    return NextResponse.json(
      { error: "Failed to create avatar session", detail },
      { status: res.status >= 500 ? 502 : res.status || 502 },
    );
  }

  return NextResponse.json({
    conversationUrl: data.conversation_url,
    conversationId: data.conversation_id ?? null,
    status: data.status ?? null,
  });
}

/** DELETE — end a Tavus conversation so it stops billing once the user leaves. */
export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const conversationId =
    body && typeof body === "object" && typeof (body as { conversationId?: unknown }).conversationId === "string"
      ? String((body as { conversationId: string }).conversationId).slice(0, 120)
      : null;

  if (!conversationId) {
    return NextResponse.json({ error: "Missing conversationId" }, { status: 400 });
  }
  if (!TAVUS_API_KEY) {
    return NextResponse.json({ ok: true });
  }

  // Best-effort end; we don't fail the client if Tavus is already gone.
  await fetch(`${TAVUS_CONVERSATIONS_URL}/${encodeURIComponent(conversationId)}/end`, {
    method: "POST",
    headers: { "x-api-key": TAVUS_API_KEY },
  }).catch(() => null);

  return NextResponse.json({ ok: true });
}
