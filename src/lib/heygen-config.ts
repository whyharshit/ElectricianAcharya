/** Server-side HeyGen LiveAvatar config from .env.local — never import in client components. */
import type { Lang } from "@/lib/types";

export const HEYGEN_API_KEY = process.env.HEYGEN_API_KEY?.trim() || "";

// Avatar to render. Default is the public "Ann Therapist" stock avatar.
export const HEYGEN_AVATAR_ID =
  process.env.HEYGEN_AVATAR_ID?.trim() || "513fd1b7-7ef9-466d-9af2-344e51eeb833";

// LiveAvatar Context (system prompt / persona) — the "Vajra Acharya" context.
export const HEYGEN_CONTEXT_ID =
  process.env.HEYGEN_CONTEXT_ID?.trim() || "c673797c-dcd6-4003-ad9c-98a11d542139";

// Optional explicit voice; blank → avatar default (the `language` field still drives Hindi/Bengali).
export const HEYGEN_VOICE_ID = process.env.HEYGEN_VOICE_ID?.trim() || "";

export const HEYGEN_SESSION_TOKEN_URL = "https://api.liveavatar.com/v1/sessions/token";

/** Our app langs ('bn' | 'hi' | 'en') map 1:1 to LiveAvatar language codes. */
export function heygenLanguage(lang: Lang): string {
  return lang === "bn" ? "bn" : lang === "hi" ? "hi" : "en";
}

/** Body for POST /v1/sessions/token in FULL mode (HeyGen handles STT + LLM + TTS + avatar). */
export function buildHeygenTokenBody(lang: Lang) {
  const persona: Record<string, unknown> = {
    context_id: HEYGEN_CONTEXT_ID,
    language: heygenLanguage(lang),
  };
  if (HEYGEN_VOICE_ID) persona.voice_id = HEYGEN_VOICE_ID;

  return {
    mode: "FULL",
    avatar_id: HEYGEN_AVATAR_ID,
    avatar_persona: persona,
    interactivity_type: "CONVERSATIONAL",
    video_settings: { quality: "high", encoding: "H264" },
  };
}
