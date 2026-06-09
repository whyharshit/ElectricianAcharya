# Vajra Acharya — Live Avatar Feature (Summary)

**Status: ✅ Built and integrated (TypeScript + production build pass).**
**Provider: Tavus CVI (Conversational Video Interface).**

---

## 1. What the feature is

A **live, talking digital avatar** ("Live Vajra") on the **Ask** page. Learners tap a
button, allow their microphone, and have a real-time spoken conversation with an
on-screen human-like avatar — it listens, understands, and replies in voice with
synchronised lip movement.

It speaks as **Vajra Acharya**, our safety-first electrician teacher, and is trilingual
(Bengali / Hindi / English) — it follows the app's language selector. It sits alongside
the existing text chat and voice features.

## 2. Technology used

- **Tavus CVI** — a real-time conversational-video service. Tavus runs the full
  pipeline (perception, speech-to-text, the LLM, the voice/TTS, and the avatar)
  end-to-end. The Vajra persona lives in a Tavus **Persona** (system prompt + LLM +
  STT + voice); the on-screen face is a Tavus **Replica**.
- Media transport is **WebRTC, powered by Daily** — the browser joins the returned
  `conversation_url` (a Daily room) with `@daily-co/daily-js`.
- Integrated into our existing **Next.js** app.

## 3. What was delivered

- Live avatar card on the **Ask** page (Start / Stop) + a **fullscreen** mode.
- Trilingual, safety-first electrician persona via the Tavus "Vajra Acharya" Persona.
- A **secure server route** (`/api/tavus/conversation`) that creates conversations
  (POST) and ends them (DELETE) — our API key stays on the server, never in the browser.
- Transcripts + speaking state come from Tavus `app-message` events over the Daily
  data channel (`conversation.utterance`, `conversation.replica.started_speaking`).
- Safeguards: rate limiting (max 3 sessions/window), single-session guard, automatic
  cleanup that **ends the conversation** when the user switches tabs or leaves the page
  (so metered minutes stop), cost caps (10-min max call, short idle timeouts), and clear
  error messages.

## 4. Credentials / cost

- **Required:** a **Tavus API key** + a **Persona ID** — configured in `.env.local`
  (not committed). Get them at https://platform.tavus.io.
- Config: `TAVUS_API_KEY`, `TAVUS_PERSONA_ID` (the Vajra persona), `TAVUS_REPLICA_ID`
  (the on-screen avatar; optional if the persona already has a default replica), and
  optional per-language overrides `TAVUS_PERSONA_ID_HI/BN/EN`.
- **Cost note:** Tavus CVI is billed per conversational minute. The free tier gives a
  small monthly minute allowance for testing/demo; real learner traffic needs a paid
  plan. The route caps each call at 10 minutes and ends it promptly when the learner
  leaves to control spend.

## 5. Optional polish

- Swap `TAVUS_REPLICA_ID` for a more electrician-appropriate replica (no code change).
- Refine the spoken persona by editing the "Vajra Acharya" Persona in the Tavus
  dashboard (system prompt, LLM, voice, language).

## 6. How to verify

1. Fill in `TAVUS_API_KEY` and `TAVUS_PERSONA_ID` in `.env.local`.
2. Run the app (`npm run dev`) → open the **Ask** page.
3. Tap **"Start live Vajra"**, allow the microphone, and speak.
4. The avatar responds in voice. The camera icon opens fullscreen mode.

---

### One-line version for a status update
> "The live talking-avatar feature for Vajra Acharya now runs on **Tavus CVI** (WebRTC
> via Daily), trilingual, with the API key + persona on the server. Add a Tavus API key
> and Persona ID to `.env.local`; pick a custom replica and a paid plan before launch."

### Note
> Earlier prototypes used Anam AI, then HeyGen LiveAvatar; the project was migrated to
> Tavus CVI.
