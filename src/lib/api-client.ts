/**
 * Client-side API wrappers. All CRUD the browser does goes through here —
 * there is no `@supabase/supabase-js` in the client bundle.
 *
 * Grouped by resource:
 *   api.content.* — public reads (modules, sections, videos)
 *   api.learner.* — per-learner writes
 *   api.auth.*    — admin session (login/logout/me)
 *   api.admin.*   — admin reads/writes (require the session cookie)
 */
import type { Module, Section, Content, Video, Lang } from "./types";

type JsonOk<T> = T;
type JsonErr = { error: string; detail?: string };

async function request<T>(
  path: string,
  init?: RequestInit & { json?: unknown }
): Promise<JsonOk<T>> {
  const { json, ...rest } = init || {};
  const res = await fetch(path, {
    method: json !== undefined ? "POST" : "GET",
    credentials: "same-origin",
    headers: json !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: json !== undefined ? JSON.stringify(json) : undefined,
    ...rest,
  });
  if (!res.ok) {
    let err: JsonErr | null = null;
    try { err = await res.json(); } catch { /* ignore */ }
    throw new ApiError(res.status, err?.detail || err?.error || `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

// ================================================================
// Content
// ================================================================
const content = {
  modules: async (): Promise<Module[]> => {
    const r = await request<{ modules: Module[] }>("/api/content/modules");
    return r.modules;
  },

  sections: async (
    moduleId: string,
    lang: Lang
  ): Promise<Array<Section & { content?: Content | null }>> => {
    const r = await request<{ sections: Array<Section & { content?: Content | null }> }>(
      `/api/content/sections?moduleId=${encodeURIComponent(moduleId)}&lang=${encodeURIComponent(lang)}`
    );
    return r.sections;
  },

  videos: async (moduleId?: string, limit?: number): Promise<Video[]> => {
    const qs = new URLSearchParams();
    if (moduleId) qs.set("moduleId", moduleId);
    if (limit) qs.set("limit", String(limit));
    const r = await request<{ videos: Video[] }>(`/api/content/videos?${qs}`);
    return r.videos;
  },
};

// ================================================================
// Learner (writes)
// ================================================================
const learner = {
  init: async (deviceId: string, lang: Lang): Promise<string | null> => {
    const r = await request<{ learnerId: string | null }>("/api/learner/init", {
      json: { deviceId, lang },
    });
    return r.learnerId;
  },

  progress: async (
    learnerId: string,
    moduleId: string,
    sectionsCompleted: string[],
    completed: boolean
  ): Promise<void> => {
    await request("/api/learner/progress", {
      json: { learnerId, moduleId, sectionsCompleted, completed },
    });
  },

  quizAttempt: async (
    learnerId: string,
    moduleId: string,
    score: number,
    total: number,
    questions: unknown[]
  ): Promise<void> => {
    await request("/api/learner/quiz-attempts", {
      json: { learnerId, moduleId, score, total, questions },
    });
  },

  chatLog: async (
    learnerId: string,
    moduleId: string,
    lang: Lang,
    userMessage: string,
    aiResponse: string,
    responseTimeMs?: number
  ): Promise<void> => {
    await request("/api/learner/chat-logs", {
      json: { learnerId, moduleId, lang, userMessage, aiResponse, responseTimeMs },
    });
  },

  applyLog: async (
    learnerId: string,
    moduleId: string,
    input: string,
    score: number,
    feedback: string,
    nextStep: string,
    hasPhoto: boolean
  ): Promise<void> => {
    await request("/api/learner/apply-logs", {
      json: { learnerId, moduleId, input, score, feedback, nextStep, hasPhoto },
    });
  },

  event: async (
    learnerId: string,
    eventType: string,
    eventData?: Record<string, unknown>
  ): Promise<void> => {
    await request("/api/learner/events", {
      json: { learnerId, eventType, eventData },
    });
  },
};

// ================================================================
// AI
// ================================================================
// Lightweight helper to grab the current learnerId from the zustand store
// without creating a circular import at module-load time.
async function currentLearnerId(): Promise<string | null> {
  try {
    const { useStore } = await import("./store");
    return useStore.getState().learnerId ?? null;
  } catch {
    return null;
  }
}

const ai = {
  /**
   * Non-streaming chat — drains the stream and returns the full reply.
   * Kept for callers that don't care about tokens as they arrive (e.g. the
   * Apply tab's self-assessment flow, which grades the whole reply at once).
   * Internally it uses chatStream so there's one network path to maintain.
   */
  chat: async (payload: {
    message: string;
    history: Array<{ role: "user" | "assistant"; content: string }>;
    moduleId: string;
    lang: Lang;
    image?: string;
  }): Promise<{ reply: string }> => {
    let reply = "";
    for await (const chunk of ai.chatStream(payload)) reply += chunk;
    return { reply };
  },

  /**
   * Streaming chat — reads the text stream from /api/chat and yields each
   * chunk as it arrives. Lets the UI paint text + fire TTS per-sentence while
   * Claude is still generating. Caller should handle ApiError on non-2xx.
   */
  chatStream: async function* (payload: {
    message: string;
    history: Array<{ role: "user" | "assistant"; content: string }>;
    moduleId: string;
    lang: Lang;
    image?: string;
    signal?: AbortSignal;
  }): AsyncGenerator<string, void, undefined> {
    const learnerId = await currentLearnerId();
    const { signal, ...body } = payload;
    const res = await fetch("/api/chat", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, learnerId }),
      signal,
    });
    if (!res.ok || !res.body) {
      let errMsg = `Chat failed (${res.status})`;
      try {
        const j = await res.json();
        if (j?.error) errMsg = j.error;
      } catch { /* ignore */ }
      throw new ApiError(res.status, errMsg);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (chunk) yield chunk;
      }
      // Flush any trailing bytes the decoder held back.
      const tail = decoder.decode();
      if (tail) yield tail;
    } finally {
      try { reader.releaseLock(); } catch { /* ignore */ }
    }
  },

  quiz: async (moduleId: string, lang: Lang): Promise<{ questions: unknown[] }> => {
    const learnerId = await currentLearnerId();
    return await request<{ questions: unknown[] }>("/api/quiz", {
      json: { moduleId, lang, learnerId },
    });
  },

  tts: async (text: string, lang: Lang): Promise<Blob> => {
    const learnerId = await currentLearnerId();
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ text, lang, learnerId }),
    });
    if (!res.ok) throw new ApiError(res.status, "TTS failed");
    return await res.blob();
  },

  geminiLiveToken: async (payload: {
    mode: "ask" | "apply";
    moduleId: string;
    lang: Lang;
  }): Promise<{
    token: string;
    model: string;
    websocketUrl: string;
    setup: Record<string, unknown>;
  }> => {
    return await request("/api/gemini-live-token", { json: payload });
  },

  /** Create a Tavus CVI conversation; returns the Daily room url to join. */
  tavusConversation: async (payload: {
    lang: Lang;
  }): Promise<{ conversationUrl: string; conversationId: string | null; status: string | null }> => {
    const learnerId = await currentLearnerId();
    return await request<{
      conversationUrl: string;
      conversationId: string | null;
      status: string | null;
    }>("/api/tavus/conversation", { json: { ...payload, learnerId } });
  },

  /** End a Tavus conversation so it stops billing once the learner leaves. */
  tavusEndConversation: async (conversationId: string): Promise<void> => {
    await request("/api/tavus/conversation", {
      method: "DELETE",
      json: { conversationId },
    });
  },
};

// ================================================================
// Auth (admin session)
// ================================================================
const auth = {
  login: async (email: string, password: string): Promise<{ email: string }> => {
    return await request<{ email: string }>("/api/auth/login", {
      json: { email, password },
    });
  },
  logout: async (): Promise<void> => {
    await request("/api/auth/logout", { json: {} });
  },
  me: async (): Promise<{ email: string | null }> => {
    return await request<{ email: string | null }>("/api/auth/me");
  },
};

// ================================================================
// Admin (require session cookie)
// ================================================================
const admin = {
  stats: async () => {
    return await request<{
      modules: number;
      sections: number;
      contentRows: number;
      videos: number;
      learners: number;
      quizAttempts: number;
    }>("/api/admin/stats");
  },

  learners: async (page = 0) => {
    return await request<{
      learners: Array<{
        id: string;
        device_id: string;
        name: string | null;
        phone: string | null;
        preferred_lang: string;
        created_at: string;
        last_seen: string;
        progressCount: number;
        quizCount: number;
        avgScore: number;
      }>;
      totalCount: number;
      page: number;
      pageSize: number;
    }>(`/api/admin/learners?page=${page}`);
  },

  modules: async () => {
    return await request<{
      modules: Array<Module & { sectionCount: number; contentCount: number }>;
    }>("/api/admin/modules");
  },

  module: async (id: string) => {
    return await request<{
      module: Module;
      sections: Array<
        Section & {
          content: Record<Lang, Content | null>;
        }
      >;
    }>(`/api/admin/modules/${encodeURIComponent(id)}`);
  },

  addSection: async (moduleId: string, sortOrder: number): Promise<void> => {
    await request("/api/admin/sections", { json: { moduleId, sortOrder } });
  },

  updateSection: async (id: string, patch: Record<string, unknown>): Promise<void> => {
    const res = await fetch(`/api/admin/sections/${encodeURIComponent(id)}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      let err: JsonErr | null = null;
      try { err = await res.json(); } catch { /* ignore */ }
      throw new ApiError(res.status, err?.error || `Update failed (${res.status})`);
    }
  },

  deleteSection: async (id: string): Promise<void> => {
    const res = await fetch(`/api/admin/sections/${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    if (!res.ok) throw new ApiError(res.status, "Delete failed");
  },

  upsertContent: async (sectionId: string, lang: Lang, body: string): Promise<void> => {
    await request("/api/admin/content", {
      json: { sectionId, lang, body },
    });
  },

  // List of conversations — one row per (learner, module, lang) combo.
  chatConversations: async (opts: { page?: number; learnerId?: string; moduleId?: string } = {}) => {
    const qs = new URLSearchParams();
    if (opts.page !== undefined) qs.set("page", String(opts.page));
    if (opts.learnerId) qs.set("learnerId", opts.learnerId);
    if (opts.moduleId) qs.set("moduleId", opts.moduleId);
    return await request<{
      rows: Array<{
        key: string;
        learnerId: string | null;
        moduleId: string | null;
        lang: string | null;
        messageCount: number;
        firstAt: string;
        lastAt: string;
        latestUserMessage: string | null;
        latestAiResponse: string | null;
      }>;
      totalCount: number;
      page: number;
      pageSize: number;
    }>(`/api/admin/chat-logs?${qs}`);
  },

  // All messages in a single conversation, oldest-first.
  chatConversation: async (opts: { learnerId: string; moduleId?: string; lang?: string }) => {
    const qs = new URLSearchParams({ learnerId: opts.learnerId });
    if (opts.moduleId) qs.set("moduleId", opts.moduleId);
    if (opts.lang) qs.set("lang", opts.lang);
    return await request<{
      messages: Array<{
        id: string;
        learner_id: string | null;
        module_id: string | null;
        lang: string | null;
        user_message: string | null;
        ai_response: string | null;
        response_time_ms: number | null;
        created_at: string;
      }>;
    }>(`/api/admin/chat-logs/conversation?${qs}`);
  },

  applyLogs: async (opts: { page?: number; learnerId?: string; moduleId?: string } = {}) => {
    const qs = new URLSearchParams();
    if (opts.page !== undefined) qs.set("page", String(opts.page));
    if (opts.learnerId) qs.set("learnerId", opts.learnerId);
    if (opts.moduleId) qs.set("moduleId", opts.moduleId);
    return await request<{
      rows: Array<{
        id: string;
        learner_id: string;
        module_id: string;
        log_type: string;
        data: {
          input?: string;
          score?: number;
          feedback?: string;
          nextStep?: string;
          hasPhoto?: boolean;
        } | null;
        created_at: string;
      }>;
      totalCount: number;
      page: number;
      pageSize: number;
    }>(`/api/admin/apply-logs?${qs}`);
  },

  events: async (opts: { page?: number; learnerId?: string; eventType?: string } = {}) => {
    const qs = new URLSearchParams();
    if (opts.page !== undefined) qs.set("page", String(opts.page));
    if (opts.learnerId) qs.set("learnerId", opts.learnerId);
    if (opts.eventType) qs.set("eventType", opts.eventType);
    return await request<{
      rows: Array<{
        id: string;
        learner_id: string | null;
        event_type: string;
        event_data: Record<string, unknown> | null;
        created_at: string;
      }>;
      totalCount: number;
      page: number;
      pageSize: number;
      distinctTypes: string[];
    }>(`/api/admin/events?${qs}`);
  },
};

// ================================================================
// Phone auth (main-app login flow)
// ================================================================
export interface PhoneLearner {
  id: string;
  phone: string;
  name: string;
  role: "learner" | "user" | "admin" | "founder";
  isAdmin: boolean;
  preferredLang?: string;
}

const phoneAuth = {
  requestOtp: async (phone: string): Promise<{ phone: string; devOtp?: string; smsSent?: boolean; expiresInMinutes?: number }> => {
    return await request<{ ok: true; phone: string; devOtp?: string; smsSent?: boolean; expiresInMinutes?: number }>(
      "/api/auth/phone/request-otp",
      { json: { phone } }
    );
  },
  verifyOtp: async (phone: string, otp: string): Promise<PhoneLearner> => {
    const r = await request<{ ok: true; learner: PhoneLearner }>(
      "/api/auth/phone/verify-otp",
      { json: { phone, otp } }
    );
    return r.learner;
  },
  me: async (): Promise<PhoneLearner | null> => {
    const r = await request<{ learner: PhoneLearner | null }>("/api/auth/phone/me");
    return r.learner;
  },
  logout: async (): Promise<void> => {
    await request("/api/auth/phone/logout", { json: {} });
  },
};

export const api = { content, learner, ai, auth, admin, phoneAuth };
