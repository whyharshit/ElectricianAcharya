"use client";

import type { Lang } from "@/lib/types";
import { TAVUS_INLINE_VIDEO_ELEMENT_ID } from "@/lib/tavus-constants";
import type { TavusAvatarSession } from "@/hooks/useTavusAvatar";
import { Avatar } from "@/components/ui/Avatar";
import { Tag } from "@/components/ui/Tag";
import { Icon } from "@/components/ui/Icon";

const copy = {
  bn: {
    connect: "অ্যাভাটার যুক্ত হচ্ছে...",
    ready: "বলো — Vajra Acharya শুনছে",
    speak: "Vajra Acharya বলছে...",
    start: "লাইভ Vajra শুরু করো",
    stop: "বন্ধ করো",
    live: "লাইভ অ্যাভাটার",
    hint: "শুরু করতে বোতাম চাপো · মাইক্রোফোন অনুমতি দিন",
    idle: "টাইপ করে জিজ্ঞেস করো, অথবা লাইভ কথা বলতে Start চাপো",
  },
  hi: {
    connect: "अवतार जुड़ रहा है...",
    ready: "बोलो — Vajra Acharya सुन रहा है",
    speak: "Vajra Acharya बोल रहा है...",
    start: "लाइव Vajra शुरू करें",
    stop: "बंद करें",
    live: "लाइव अवतार",
    hint: "शुरू करने के लिए बटन दबाएँ · माइक की अनुमति दें",
    idle: "टाइप करके पूछें, या बोलने के लिए Start दबाएँ",
  },
  en: {
    connect: "Connecting avatar...",
    ready: "Speak — Vajra Acharya is listening",
    speak: "Vajra Acharya is speaking...",
    start: "Start live Vajra",
    stop: "Stop",
    live: "Live avatar",
    hint: "Tap Start to talk · allow microphone when prompted",
    idle: "Type below, or tap Start to talk live with Vajra Acharya",
  },
} as const;

interface Props {
  lang: Lang;
  moduleId: string;
  live: boolean;
  onLiveChange: (live: boolean) => void;
  session: TavusAvatarSession;
}

export default function TavusAvatarPanel({ lang, live, onLiveChange, session }: Props) {
  const c = copy[lang];
  const { state, error, userLine, assistantLine, disconnect } = session;

  const isConnecting = state === "connecting";
  const isSession = state === "ready" || state === "speaking";
  const showVideo = live && (isConnecting || isSession || state === "error");

  const label = isConnecting
    ? c.connect
    : state === "speaking"
    ? c.speak
    : isSession
    ? c.ready
    : c.idle;

  const tagTone =
    state === "speaking" ? "gold" : state === "error" ? "terra" : live ? "forest" : "muted";

  return (
    <div className="w-full max-w-sm mx-auto">
      <div className="flex items-center justify-between mb-2 px-1 gap-2">
        <Tag tone={tagTone} filled className="text-[10px]">
          {c.live}
        </Tag>
        {live ? (
          <button
            type="button"
            onClick={() => {
              void disconnect();
              onLiveChange(false);
            }}
            className="text-[11px] font-semibold text-terra hover:underline"
          >
            {c.stop}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onLiveChange(true)}
            className="text-[11px] font-semibold bg-forest text-cream px-3 py-1 rounded-full hover:bg-forest-deep"
          >
            {c.start}
          </button>
        )}
      </div>

      <div className="relative w-full aspect-[4/5] max-h-[min(42vh,320px)] rounded-2xl overflow-hidden bg-forest-deep border border-line shadow-md">
        {showVideo ? (
          <video
            id={TAVUS_INLINE_VIDEO_ELEMENT_ID}
            autoPlay
            playsInline
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-sage/30">
            <Avatar size={72} useImage />
          </div>
        )}

        {isConnecting && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-forest-deep/80 text-cream">
            <div className="flex gap-1.5 mb-3">
              <span className="w-2 h-2 bg-gold rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="w-2 h-2 bg-gold rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="w-2 h-2 bg-gold rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
            <p className="text-xs text-cream/80">{c.connect}</p>
          </div>
        )}

        {state === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-forest-deep/90 text-cream px-4 text-center">
            <Icon name="cam" size={28} className="text-gold mb-2 opacity-80" />
            <p className="text-xs leading-relaxed text-gold max-w-[240px]">{error}</p>
          </div>
        )}
      </div>

      <p className="text-center text-[11px] text-muted mt-2">{label}</p>
      {!live ? (
        <p className="text-center text-[10px] text-muted mt-1">{c.hint}</p>
      ) : null}

      {userLine ? (
        <p className="text-center text-xs text-ink/80 mt-2 leading-relaxed">
          &ldquo;{userLine}&rdquo;
        </p>
      ) : null}
      {assistantLine ? (
        <p className="text-center text-xs text-muted mt-1 leading-relaxed">{assistantLine}</p>
      ) : null}
    </div>
  );
}
