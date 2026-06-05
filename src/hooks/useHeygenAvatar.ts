"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  LiveAvatarSession,
  SessionEvent,
  SessionState,
  AgentEventsEnum,
} from "@heygen/liveavatar-web-sdk";
import type { Lang } from "@/lib/types";
import { api, ApiError } from "@/lib/api-client";
import {
  releaseGlobalHeygenSession,
  runExclusiveHeygen,
  setGlobalHeygenSession,
  waitForHeygenSlot,
} from "@/lib/heygen-global-client";

export type HeygenAvatarState = "idle" | "connecting" | "ready" | "speaking" | "error" | "stopped";

function waitForVideoElement(elementId: string, timeoutMs = 8000): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const el = document.getElementById(elementId);
      if (el instanceof HTMLVideoElement) {
        resolve(el);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Video element #${elementId} not found`));
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  });
}

function formatHeygenError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 503) {
      return "HeyGen is not configured. Add HEYGEN_API_KEY to .env.local and restart the dev server.";
    }
    if (err.status === 429) {
      return "Too many session attempts. Wait a minute, then try again.";
    }
    if (/concurren/i.test(err.message)) {
      return "Avatar session limit reached. Close other tabs, tap Stop, wait a moment, then tap Start once.";
    }
    return err.message;
  }
  if (err instanceof Error) {
    if (/concurren|limit/i.test(err.message)) {
      return "Avatar session limit reached (free plan allows one at a time). Wait a moment and try Start again.";
    }
    return err.message;
  }
  return "Failed to connect to live avatar.";
}

export function useHeygenAvatar(opts: {
  videoElementId: string;
  lang: Lang;
  moduleId: string;
  /** When false, no session is created (user must tap Start). */
  active: boolean;
}) {
  const { videoElementId, lang, moduleId, active } = opts;
  const [state, setState] = useState<HeygenAvatarState>("stopped");
  const [error, setError] = useState("");
  const [userLine, setUserLine] = useState("");
  const [assistantLine, setAssistantLine] = useState("");
  const sessionRef = useRef<LiveAvatarSession | null>(null);
  const userBufRef = useRef("");
  const assistantBufRef = useRef("");
  const connectGenRef = useRef(0);
  const langModuleRef = useRef(`${lang}:${moduleId}`);
  const activeRef = useRef(active);
  activeRef.current = active;

  const disconnect = useCallback(async () => {
    connectGenRef.current += 1;
    await runExclusiveHeygen(async () => {
      const session = sessionRef.current;
      sessionRef.current = null;
      setGlobalHeygenSession(null);
      if (session) {
        try {
          await session.stop();
        } catch {
          /* ignore */
        }
      }
      await releaseGlobalHeygenSession();
      setState("stopped");
    });
  }, []);

  const connect = useCallback(async () => {
    const gen = ++connectGenRef.current;
    setState("connecting");
    setError("");
    setUserLine("");
    setAssistantLine("");
    userBufRef.current = "";
    assistantBufRef.current = "";
    langModuleRef.current = `${lang}:${moduleId}`;

    try {
      await runExclusiveHeygen(async () => {
        await releaseGlobalHeygenSession();
        if (gen !== connectGenRef.current || !activeRef.current) return;

        await waitForHeygenSlot();
        if (gen !== connectGenRef.current || !activeRef.current) return;

        const videoEl = await waitForVideoElement(videoElementId);
        if (gen !== connectGenRef.current || !activeRef.current) return;

        const { sessionToken } = await api.ai.heygenSessionToken({ lang });
        if (gen !== connectGenRef.current || !activeRef.current) return;

        const session = new LiveAvatarSession(sessionToken, { voiceChat: true });
        sessionRef.current = session;
        setGlobalHeygenSession(session);

        const attachVideo = () => {
          try {
            session.attach(videoEl);
          } catch {
            /* tracks not ready yet */
          }
        };

        session.on(SessionEvent.SESSION_STREAM_READY, () => {
          if (gen !== connectGenRef.current) return;
          attachVideo();
          setState((s) => (s === "speaking" ? s : "ready"));
        });

        session.on(SessionEvent.SESSION_STATE_CHANGED, (s: SessionState) => {
          if (gen !== connectGenRef.current) return;
          if (s === SessionState.DISCONNECTED) setState("stopped");
        });

        session.on(SessionEvent.SESSION_DISCONNECTED, () => {
          if (gen === connectGenRef.current) setState("stopped");
        });

        session.on(AgentEventsEnum.USER_TRANSCRIPTION, (e: { text: string }) => {
          if (gen !== connectGenRef.current || !e?.text) return;
          userBufRef.current = e.text;
          setUserLine(e.text);
        });

        session.on(AgentEventsEnum.AVATAR_TRANSCRIPTION, (e: { text: string }) => {
          if (gen !== connectGenRef.current || !e?.text) return;
          assistantBufRef.current = e.text;
          setAssistantLine(e.text);
        });

        session.on(AgentEventsEnum.AVATAR_SPEAK_STARTED, () => {
          if (gen === connectGenRef.current) setState("speaking");
        });

        session.on(AgentEventsEnum.AVATAR_SPEAK_ENDED, () => {
          if (gen === connectGenRef.current) setState("ready");
        });

        await session.start();
        if (gen !== connectGenRef.current || !activeRef.current) {
          try {
            await session.stop();
          } catch {
            /* ignore */
          }
          return;
        }
        attachVideo();
        setState((s) => (s === "speaking" ? s : "ready"));
      });
    } catch (err) {
      if (gen !== connectGenRef.current) return;
      const session = sessionRef.current;
      sessionRef.current = null;
      setGlobalHeygenSession(null);
      if (session) {
        try {
          await session.stop();
        } catch {
          /* ignore */
        }
      }
      await releaseGlobalHeygenSession();
      setError(formatHeygenError(err));
      setState("error");
      console.error("[HeyGen]", err);
    }
  }, [lang, moduleId, videoElementId]);

  useEffect(() => {
    if (!active) {
      void disconnect();
      return;
    }
    void connect();
    return () => {
      void disconnect();
    };
  }, [active, connect, disconnect]);

  useEffect(() => {
    if (!active) return;
    const key = `${lang}:${moduleId}`;
    if (key !== langModuleRef.current && state !== "stopped" && state !== "connecting") {
      setError(
        lang === "bn"
          ? "মডিউল/ভাষা বদলেছে — আবার Start চাপো"
          : lang === "hi"
          ? "मॉड्यूल/भाषा बदली — फिर Start दबाएँ"
          : "Module/language changed — tap Start again",
      );
      void disconnect();
    }
  }, [lang, moduleId, active, state, disconnect]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden" && activeRef.current) {
        void disconnect();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [disconnect]);

  function consumeTurn() {
    const turn = {
      userText: userBufRef.current.trim(),
      modelText: assistantBufRef.current.trim(),
    };
    userBufRef.current = "";
    assistantBufRef.current = "";
    return turn;
  }

  return {
    state,
    error,
    userLine,
    assistantLine,
    connect,
    disconnect,
    consumeTurn,
    isLive: active && (state === "ready" || state === "speaking"),
  };
}

export type HeygenAvatarSession = ReturnType<typeof useHeygenAvatar>;
