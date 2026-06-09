"use client";

/**
 * Single-session guard for the Tavus CVI conversation. Daily allows only ONE
 * active call object per page, and each Tavus conversation burns metered
 * minutes, so we make sure any previous call is fully torn down (Daily room
 * left + destroyed AND the Tavus conversation ended server-side) before a new
 * one starts, and serialise start/stop so React Strict Mode or dual hooks
 * can't open two at once.
 */

// Kept loose to avoid importing @daily-co/daily-js at module load.
type LeavableCall = { leave: () => Promise<unknown>; destroy: () => Promise<unknown> };

/** Wait after teardown so Daily/Tavus fully release before the next join. */
const RELEASE_GRACE_MS = 800;

let activeCall: LeavableCall | null = null;
// Server-side cleanup (ends the Tavus conversation) paired with the call.
let activeCleanup: (() => Promise<void>) | null = null;
let lastReleasedAt = 0;
let operationChain: Promise<void> = Promise.resolve();

export async function releaseGlobalTavusSession(): Promise<void> {
  const call = activeCall;
  const cleanup = activeCleanup;
  activeCall = null;
  activeCleanup = null;
  if (call) {
    try {
      await call.leave();
    } catch {
      /* ignore */
    }
    try {
      await call.destroy();
    } catch {
      /* ignore */
    }
  }
  if (cleanup) {
    try {
      await cleanup();
    } catch {
      /* ignore */
    }
  }
  lastReleasedAt = Date.now();
}

export async function waitForTavusSlot(): Promise<void> {
  const elapsed = Date.now() - lastReleasedAt;
  if (elapsed < RELEASE_GRACE_MS) {
    await new Promise((resolve) => setTimeout(resolve, RELEASE_GRACE_MS - elapsed));
  }
}

/** Serialise connect/disconnect — prevents two calls opening at once. */
export function runExclusiveTavus<T>(fn: () => Promise<T>): Promise<T> {
  const next = operationChain.then(fn);
  operationChain = next.then(
    () => {},
    () => {},
  );
  return next;
}

export function setGlobalTavusSession(
  call: LeavableCall | null,
  cleanup: (() => Promise<void>) | null = null,
) {
  activeCall = call;
  activeCleanup = cleanup;
}

export function hasGlobalTavusSession(): boolean {
  return activeCall !== null;
}
