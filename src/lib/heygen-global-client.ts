"use client";

/**
 * Single-session guard for HeyGen LiveAvatar. The free tier allows only ONE
 * concurrent session, so we make sure any previous session is fully stopped
 * before a new one starts, and serialise start/stop so React Strict Mode or
 * dual hooks can't open two sessions at once.
 */

// The SDK session type — kept loose to avoid importing the class at module load.
type StoppableSession = { stop: () => Promise<void> };

/** Wait after stop() so HeyGen frees the concurrent-session slot. */
const RELEASE_GRACE_MS = 1200;

let activeSession: StoppableSession | null = null;
let lastReleasedAt = 0;
let operationChain: Promise<void> = Promise.resolve();

export async function releaseGlobalHeygenSession(): Promise<void> {
  const session = activeSession;
  activeSession = null;
  if (!session) {
    lastReleasedAt = Date.now();
    return;
  }
  try {
    await session.stop();
  } catch {
    /* ignore teardown errors */
  }
  lastReleasedAt = Date.now();
}

export async function waitForHeygenSlot(): Promise<void> {
  const elapsed = Date.now() - lastReleasedAt;
  if (elapsed < RELEASE_GRACE_MS) {
    await new Promise((resolve) => setTimeout(resolve, RELEASE_GRACE_MS - elapsed));
  }
}

/** Serialise connect/disconnect — prevents two sessions opening at once. */
export function runExclusiveHeygen<T>(fn: () => Promise<T>): Promise<T> {
  const next = operationChain.then(fn);
  operationChain = next.then(
    () => {},
    () => {},
  );
  return next;
}

export function setGlobalHeygenSession(session: StoppableSession | null) {
  activeSession = session;
}

export function hasGlobalHeygenSession(): boolean {
  return activeSession !== null;
}
