"use client";

import type { Lang } from "@/lib/types";
import { TAVUS_VIDEO_ELEMENT_ID } from "@/lib/tavus-constants";
import type { TavusAvatarSession } from "@/hooks/useTavusAvatar";
import { Icon } from "@/components/ui/Icon";
import { Tag } from "@/components/ui/Tag";

interface Props {
  open: boolean;
  lang: Lang;
  title: string;
  subtitle?: string;
  onClose: () => void;
  onTurnComplete?: (turn: { userText: string; modelText: string }) => void;
  session: TavusAvatarSession;
}

const copy = {
  bn: {
    connect: "অ্যাভাটার যুক্ত হচ্ছে...",
    ready: "বলো — Vajra Acharya শুনছে",
    speak: "Vajra Acharya বলছে...",
    close: "বন্ধ",
    micHint: "মাইক্রোফোন অনুমতি দিন",
  },
  hi: {
    connect: "अवतार जुड़ रहा है...",
    ready: "बोलो — Vajra Acharya सुन रहा है",
    speak: "Vajra Acharya बोल रहा है...",
    close: "बंद",
    micHint: "माइक्रोफ़ोन की अनुमति दें",
  },
  en: {
    connect: "Connecting avatar...",
    ready: "Speak — Vajra Acharya is listening",
    speak: "Vajra Acharya is speaking...",
    close: "Close",
    micHint: "Allow microphone access",
  },
} as const;

export default function TavusLiveOverlay({
  open,
  lang,
  title,
  subtitle,
  onClose,
  onTurnComplete,
  session,
}: Props) {
  const c = copy[lang];
  const { state, error, userLine, assistantLine, disconnect, consumeTurn } = session;

  function handleClose() {
    const turn = consumeTurn();
    void disconnect();
    if ((turn.userText || turn.modelText) && onTurnComplete) {
      onTurnComplete(turn);
    }
    onClose();
  }

  if (!open) return null;

  const label =
    state === "connecting" || state === "idle"
      ? c.connect
      : state === "speaking"
      ? c.speak
      : state === "error"
      ? c.micHint
      : c.ready;

  return (
    <div className="fixed inset-0 z-[10000] bg-forest-deep text-cream flex flex-col">
      <div className="shrink-0 flex items-center justify-between px-4 py-4">
        <div className="min-w-0">
          <p className="font-mono text-[10px] tracking-[0.22em] uppercase text-gold">Live Avatar</p>
          <h2 className="font-serif italic text-xl truncate">{title}</h2>
          {subtitle ? <p className="text-xs text-cream/70 truncate">{subtitle}</p> : null}
        </div>
        <button
          type="button"
          onClick={handleClose}
          className="w-10 h-10 rounded-full bg-cream/10 border border-cream/20 flex items-center justify-center"
          aria-label={c.close}
          title={c.close}
        >
          <Icon name="close" size={18} />
        </button>
      </div>

      <div className="flex-1 min-h-0 flex flex-col items-center justify-center px-4 pb-6">
        <div className="w-full max-w-md aspect-[3/4] max-h-[55vh] rounded-2xl overflow-hidden bg-black/40 border border-cream/15 shadow-2xl">
          <video
            id={TAVUS_VIDEO_ELEMENT_ID}
            autoPlay
            playsInline
            className="w-full h-full object-cover"
          />
        </div>

        <Tag tone={state === "speaking" ? "gold" : "forest"} className="mt-5">
          {label}
        </Tag>

        {error ? (
          <p className="mt-4 text-sm text-gold max-w-sm text-center leading-relaxed">{error}</p>
        ) : null}

        {userLine ? (
          <p className="mt-6 max-w-md text-sm text-cream/80 leading-relaxed text-center">
            &ldquo;{userLine}&rdquo;
          </p>
        ) : null}
        {assistantLine ? (
          <p className="mt-3 max-w-md text-sm text-cream/65 leading-relaxed text-center">{assistantLine}</p>
        ) : null}
      </div>
    </div>
  );
}
