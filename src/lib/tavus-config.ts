/** Server-side Tavus CVI config from .env.local — never import in client components. */
import type { Lang } from "@/lib/types";

export const TAVUS_API_KEY = process.env.TAVUS_API_KEY?.trim() || "";

// The Replica = the avatar's face/voice appearance. Optional here when the
// Persona already has a default replica_id; if set, this overrides it.
export const TAVUS_REPLICA_ID = process.env.TAVUS_REPLICA_ID?.trim() || "";

// The Persona = system prompt + LLM + STT + TTS (the "Vajra Acharya" brain).
// This is Tavus's equivalent of the old HeyGen Context. The persona's prompt
// forces always-Bengali replies regardless of the input language.
export const TAVUS_PERSONA_ID = process.env.TAVUS_PERSONA_ID?.trim() || "";

export const TAVUS_CONVERSATIONS_URL = "https://tavusapi.com/v2/conversations";

/** Body for POST /v2/conversations (Tavus runs STT + LLM + TTS + avatar). */
export function buildTavusConversationBody(lang: Lang) {
  const body: Record<string, unknown> = {
    persona_id: TAVUS_PERSONA_ID,
    conversation_name: `Vajra Acharya (${lang})`,
    properties: {
      // "multilingual" → STT auto-detects whatever language the learner speaks
      // (Bengali / Hindi / English / mix). The persona's system prompt makes the
      // LLM always reply in Bengali, and multilingual TTS speaks that Bengali.
      // (If output ever drifts off Bengali, hard-set this to "bengali".)
      language: "multilingual",
      // Cost guards: cap the call and end it quickly once the learner leaves
      // or goes silent, so we don't keep burning conversational minutes.
      max_call_duration: 600,
      participant_left_timeout: 30,
      participant_absent_timeout: 60,
      enable_closed_captions: true,
    },
  };
  // Only send replica_id if explicitly configured; otherwise the persona's
  // default replica is used.
  if (TAVUS_REPLICA_ID) body.replica_id = TAVUS_REPLICA_ID;
  return body;
}
