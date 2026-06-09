"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Daily, { type DailyCall, type DailyEventObjectAppMessage } from "@daily-co/daily-js";
import type { Lang } from "@/lib/types";
import { api, ApiError } from "@/lib/api-client";
import {
  releaseGlobalTavusSession,
  runExclusiveTavus,
  setGlobalTavusSession,
  waitForTavusSlot,
} from "@/lib/tavus-global-client";

export type TavusAvatarState = "idle" | "connecting" | "ready" | "speaking" | "error" | "stopped";

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

function formatTavusError(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 503) {
      return "Tavus is not configured. Add TAVUS_API_KEY + TAVUS_PERSONA_ID to .env.local and restart the dev server.";
    }
    if (err.status === 429) {
      return "Too many session attempts. Wait a minute, then try again.";
    }
    if (/concurren|maximum|limit/i.test(err.message)) {
      return "Avatar session limit reached. Close other tabs, tap Stop, wait a moment, then tap Start once.";
    }
    return err.message;
  }
  if (err instanceof Error) {
    if (/permission|notallowed|microphone/i.test(err.message)) {
      return "Microphone permission is required to talk with Vajra Acharya. Allow the mic and tap Start again.";
    }
    return err.message;
  }
  return "Failed to connect to live avatar.";
}

/** Build a MediaStream from the remote (replica) participant's tracks. */
function collectRemoteStream(call: DailyCall): { stream: MediaStream; key: string } | null {
  const participants = call.participants();
  const remote = Object.values(participants).find((p) => !p.local);
  if (!remote) return null;
  const tracks: MediaStreamTrack[] = [];
  const vt = remote.tracks?.video?.persistentTrack;
  const at = remote.tracks?.audio?.persistentTrack;
  if (vt) tracks.push(vt);
  if (at) tracks.push(at);
  if (!tracks.length) return null;
  return { stream: new MediaStream(tracks), key: tracks.map((t) => t.id).join("|") };
}

export function useTavusAvatar(opts: {
  videoElementId: string;
  lang: Lang;
  moduleId: string;
  /** When false, no conversation is created (user must tap Start). */
  active: boolean;
}) {
  const { videoElementId, lang, moduleId, active } = opts;
  const [state, setState] = useState<TavusAvatarState>("stopped");
  const [error, setError] = useState("");
  const [userLine, setUserLine] = useState("");
  const [assistantLine, setAssistantLine] = useState("");
  const callRef = useRef<DailyCall | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const attachedKeyRef = useRef("");
  const userBufRef = useRef("");
  const assistantBufRef = useRef("");
  const connectGenRef = useRef(0);
  const langModuleRef = useRef(`${lang}:${moduleId}`);
  const activeRef = useRef(active);
  activeRef.current = active;
  const videoElementIdRef = useRef(videoElementId);
  videoElementIdRef.current = videoElementId;

  /** Push the replica's tracks into whichever <video> is currently mounted. */
  const attachToCurrentVideo = useCallback(() => {
    const call = callRef.current;
    if (!call) return;
    const el = document.getElementById(videoElementIdRef.current);
    if (!(el instanceof HTMLVideoElement)) return;
    const remote = collectRemoteStream(call);
    if (!remote) return;
    // Only reset srcObject when the track set actually changed — avoids flicker.
    if (el.srcObject !== remote.stream || attachedKeyRef.current !== remote.key) {
      el.srcObject = remote.stream;
      attachedKeyRef.current = remote.key;
      el.play?.().catch(() => {
        /* autoplay may be blocked until a gesture; user tapped Start so usually fine */
      });
    }
  }, []);

  const disconnect = useCallback(async () => {
    connectGenRef.current += 1;
    await runExclusiveTavus(async () => {
      callRef.current = null;
      conversationIdRef.current = null;
      attachedKeyRef.current = "";
      setGlobalTavusSession(null);
      await releaseGlobalTavusSession();
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
    attachedKeyRef.current = "";
    langModuleRef.current = `${lang}:${moduleId}`;

    try {
      await runExclusiveTavus(async () => {
        await releaseGlobalTavusSession();
        if (gen !== connectGenRef.current || !activeRef.current) return;

        await waitForTavusSlot();
        if (gen !== connectGenRef.current || !activeRef.current) return;

        await waitForVideoElement(videoElementIdRef.current);
        if (gen !== connectGenRef.current || !activeRef.current) return;

        const { conversationUrl, conversationId } = await api.ai.tavusConversation({ lang });
        if (gen !== connectGenRef.current || !activeRef.current) {
          // We created a conversation but the user already bailed — end it now.
          if (conversationId) await api.ai.tavusEndConversation(conversationId).catch(() => {});
          return;
        }

        const call = Daily.createCallObject({ subscribeToTracksAutomatically: true });
        callRef.current = call;
        conversationIdRef.current = conversationId;
        // Register with the global guard so leaving the page tears it down AND
        // ends the Tavus conversation (stops billing).
        setGlobalTavusSession(call, async () => {
          if (conversationId) await api.ai.tavusEndConversation(conversationId).catch(() => {});
        });

        const onTrack = () => {
          if (gen !== connectGenRef.current) return;
          attachToCurrentVideo();
          setState((s) => (s === "speaking" ? s : "ready"));
        };
        call.on("track-started", onTrack);
        call.on("participant-joined", onTrack);
        call.on("participant-updated", onTrack);

        call.on("left-meeting", () => {
          if (gen === connectGenRef.current) setState("stopped");
        });
        call.on("error", (e) => {
          if (gen !== connectGenRef.current) return;
          setError(formatTavusError(new Error(e?.errorMsg || "Daily error")));
          setState("error");
        });

        call.on("app-message", (ev: DailyEventObjectAppMessage) => {
          if (gen !== connectGenRef.current) return;
          const data = ev?.data as
            | { event_type?: string; properties?: { role?: string; speech?: string } }
            | undefined;
          if (!data?.event_type) return;

          if (data.event_type === "conversation.utterance") {
            const text = data.properties?.speech?.trim();
            if (!text) return;
            if (data.properties?.role === "replica") {
              assistantBufRef.current = text;
              setAssistantLine(text);
            } else {
              userBufRef.current = text;
              setUserLine(text);
            }
          } else if (data.event_type === "conversation.replica.started_speaking") {
            setState("speaking");
          } else if (data.event_type === "conversation.replica.stopped_speaking") {
            setState((s) => (s === "speaking" ? "ready" : s));
          }
        });

        // mic on (to talk), camera off (Tavus perception not needed by default).
        await call.join({ url: conversationUrl, startVideoOff: true, startAudioOff: false });
        if (gen !== connectGenRef.current || !activeRef.current) {
          await releaseGlobalTavusSession();
          return;
        }
        attachToCurrentVideo();
        setState((s) => (s === "speaking" ? s : "ready"));
      });
    } catch (err) {
      if (gen !== connectGenRef.current) return;
      callRef.current = null;
      conversationIdRef.current = null;
      setGlobalTavusSession(null);
      await releaseGlobalTavusSession();
      setError(formatTavusError(err));
      setState("error");
      console.error("[Tavus]", err);
    }
  }, [lang, moduleId, attachToCurrentVideo]);

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

  // Re-attach the existing stream when the target <video> changes (e.g. opening
  // the fullscreen overlay) — without recreating the costly conversation.
  useEffect(() => {
    attachedKeyRef.current = "";
    attachToCurrentVideo();
  }, [videoElementId, attachToCurrentVideo]);

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

export type TavusAvatarSession = ReturnType<typeof useTavusAvatar>;
