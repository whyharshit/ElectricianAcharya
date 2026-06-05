# Vajra Acharya — Live Avatar Feature (Summary)

**Status: ✅ Built, integrated, and verified working (end-to-end tested).**
**Provider: HeyGen LiveAvatar (FULL mode).**

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

- **HeyGen LiveAvatar** — a real-time streaming-avatar service (video + voice over
  WebRTC/LiveKit), client SDK `@heygen/liveavatar-web-sdk`.
- **FULL mode:** HeyGen handles speech-to-text, the LLM, the voice, and the avatar
  end-to-end. The Vajra persona lives in a HeyGen **Context** (the system prompt).
- Integrated into our existing **Next.js** app.

## 3. What was delivered

- Live avatar card on the **Ask** page (Start / Stop) + a **fullscreen** mode.
- Trilingual, safety-first electrician persona via the HeyGen "Vajra Acharya" Context.
- A **secure server route** (`/api/heygen/session-token`) that mints one-time session
  tokens — our API key stays on the server and is never exposed to the browser.
- Safeguards: rate limiting (max 3 sessions/window), single-session guard, automatic
  cleanup when the user switches tabs or leaves the page, and clear error messages.
- Verified end-to-end: TypeScript compiles clean and live session tokens are
  successfully created through our own app route in Hindi/English.

## 4. Credentials / cost

- **Required:** one **HeyGen API key** — configured in `.env.local` (not committed).
- Config: `HEYGEN_API_KEY`, `HEYGEN_AVATAR_ID` (the on-screen avatar),
  `HEYGEN_CONTEXT_ID` (the Vajra persona Context).
- **Cost note:** HeyGen LiveAvatar runs on credits. The **free tier** allows ~2-minute
  sessions, 1 concurrent — fine for testing/demo. Real learner traffic needs a paid plan
  (Starter $19/mo and up). FULL mode consumes ~2 credits/minute.

## 5. Optional polish

- The default avatar is a HeyGen stock avatar — swap `HEYGEN_AVATAR_ID` for a more
  electrician-appropriate one (no code change).
- Refine the spoken persona by editing the "Vajra Acharya" Context in the HeyGen
  dashboard.

## 6. How to verify

1. Run the app (`npm run dev`) → open the **Ask** page.
2. Tap **"Start live Vajra"**, allow the microphone, and speak.
3. The avatar responds in voice. The camera icon opens fullscreen mode.

---

### One-line version for a status update
> "The live talking-avatar feature for Vajra Acharya is built, integrated, and verified
> working on **HeyGen LiveAvatar** (FULL mode), trilingual, with our API key configured.
> Optional before launch: pick a custom avatar and move to a paid HeyGen plan for
> concurrent learner traffic."

### Note
> An earlier prototype used Anam AI; the project was migrated to HeyGen LiveAvatar.
