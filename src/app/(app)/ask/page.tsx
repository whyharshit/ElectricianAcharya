'use client';

import { useState, useRef, useEffect } from 'react';
import { useStore } from '@/lib/store';
import { t, getQuickActions } from '@/lib/i18n/labels';
import { getTitle } from '@/lib/types';
import { syncChatMessage, trackEvent } from '@/lib/learner-sync';
import { api, ApiError } from '@/lib/api-client';
import { errorCopy } from '@/lib/error-copy';
import { AudioQueue } from '@/lib/audio-queue';
import { splitIntoSpeakable } from '@/lib/sentence-split';
import { Avatar } from '@/components/ui/Avatar';
import { Tag } from '@/components/ui/Tag';
import { Icon } from '@/components/ui/Icon';
import GeminiLiveOverlay from '@/components/GeminiLiveOverlay';
import HeygenLiveOverlay from '@/components/HeygenLiveOverlay';
import HeygenAvatarPanel from '@/components/HeygenAvatarPanel';
import { releaseGlobalHeygenSession } from '@/lib/heygen-global-client';
import {
  HEYGEN_VIDEO_ELEMENT_ID,
  HEYGEN_INLINE_VIDEO_ELEMENT_ID,
} from '@/lib/heygen-constants';
import { useHeygenAvatar } from '@/hooks/useHeygenAvatar';

type VoiceState = 'idle' | 'listening' | 'thinking' | 'speaking';

export default function AskPage() {
  const {
    selectedModuleId, lang, modules,
    chatHistory, addChatMessage, appendToLastAssistantMessage, replaceLastAssistantMessage,
    voiceEnabled, toggleVoice,
  } = useStore();

  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  const [avatarLive, setAvatarLive] = useState(false);
  const avatarSession = useHeygenAvatar({
    videoElementId: avatarOpen ? HEYGEN_VIDEO_ELEMENT_ID : HEYGEN_INLINE_VIDEO_ELEMENT_ID,
    lang,
    moduleId: selectedModuleId,
    active: avatarLive || avatarOpen,
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioQueueRef = useRef<AudioQueue | null>(null);

  const messages = chatHistory[selectedModuleId] || [];
  const currentModule = modules.find((m) => m.id === selectedModuleId);
  const sendMessageRef = useRef<(text: string) => void>(() => {});

  const lastMessageContent = messages[messages.length - 1]?.content;
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, lastMessageContent]);

  // Stop any in-flight playback when the component unmounts or the module
  // changes — otherwise audio from module A keeps playing on module B.
  useEffect(() => {
    return () => {
      audioQueueRef.current?.stop();
      audioQueueRef.current = null;
    };
  }, [selectedModuleId]);

  // Release the HeyGen WebRTC session when leaving Ask — frees the concurrent slot.
  useEffect(() => {
    return () => {
      setAvatarLive(false);
      setAvatarOpen(false);
      void releaseGlobalHeygenSession();
    };
  }, []);

  async function sendMessage(text: string) {
    if (!text.trim() || loading) return;

    const userMessage = text.trim();
    setInput('');
    addChatMessage(selectedModuleId, 'user', userMessage);
    // Seed an empty assistant bubble so incoming tokens append into it.
    addChatMessage(selectedModuleId, 'assistant', '');
    setLoading(true);
    setVoiceState('thinking');
    const chatStart = Date.now();

    // Fresh audio queue for this turn. Cancels anything from the previous
    // reply so the user can't hear two Vajra Acharyas at once.
    audioQueueRef.current?.stop();
    if (voiceEnabled && audioRef.current) {
      audioQueueRef.current = new AudioQueue(audioRef.current, {
        onStateChange: (speaking) => {
          if (speaking) setVoiceState('speaking');
          else setVoiceState((s) => (s === 'speaking' ? 'idle' : s));
        },
      });
    } else {
      audioQueueRef.current = null;
    }

    // Rolling TTS buffer — full sentences get shipped to /api/tts as soon as
    // they complete; the tail stays here until the next chunk completes it.
    let ttsBuffer = '';
    let fullReply = '';
    let firstChunkSeen = false;

    // History snapshot is taken BEFORE the empty assistant bubble we just
    // pushed — otherwise the request would include an empty last turn and
    // Claude would refuse to generate.
    const historyForRequest = messages.slice(-10);

    try {
      for await (const chunk of api.ai.chatStream({
        message: userMessage,
        history: historyForRequest,
        moduleId: selectedModuleId,
        lang,
      })) {
        if (!chunk) continue;

        // First visible token — if voice is off, we're no longer "thinking".
        if (!firstChunkSeen) {
          firstChunkSeen = true;
          if (!voiceEnabled) setVoiceState('idle');
        }

        fullReply += chunk;
        appendToLastAssistantMessage(selectedModuleId, chunk);

        if (audioQueueRef.current) {
          ttsBuffer += chunk;
          const { ready, leftover } = splitIntoSpeakable(ttsBuffer, 20);
          if (ready.length > 0) {
            for (const sentence of ready) {
              const promise = api.ai.tts(sentence, lang).catch(() => null);
              audioQueueRef.current.enqueue(promise);
            }
            ttsBuffer = leftover;
          }
        }
      }

      // Flush any trailing text (a final sentence without a terminator, or a
      // short last fragment that didn't reach the minLen threshold).
      const tail = ttsBuffer.trim();
      if (audioQueueRef.current && tail.length > 0) {
        audioQueueRef.current.enqueue(api.ai.tts(tail, lang).catch(() => null));
      }

      const chatEnd = Date.now();
      syncChatMessage(selectedModuleId, lang, userMessage, fullReply, chatEnd - chatStart);
      trackEvent('chat_send', selectedModuleId, { lang });

      // If voice is off, we've already flipped to idle on first chunk. If
      // voice is on, the AudioQueue's onStateChange will flip us back to idle
      // once the last chunk finishes playing.
      if (!voiceEnabled) setVoiceState('idle');
    } catch (err) {
      const msg = err instanceof ApiError ? errorCopy(err, lang) : errorCopy(err, lang);
      if (fullReply) {
        // Got some tokens before the stream broke — leave what we have and
        // append the error so context isn't lost.
        appendToLastAssistantMessage(selectedModuleId, '\n\n' + msg);
      } else {
        replaceLastAssistantMessage(selectedModuleId, msg);
      }
      audioQueueRef.current?.stop();
      setVoiceState('idle');
    } finally {
      setLoading(false);
    }
  }

  sendMessageRef.current = sendMessage;

  function handleLiveTurn(turn: { userText: string; modelText: string }) {
    if (turn.userText) addChatMessage(selectedModuleId, 'user', turn.userText);
    if (turn.modelText) addChatMessage(selectedModuleId, 'assistant', turn.modelText);
    if (turn.userText || turn.modelText) {
      syncChatMessage(selectedModuleId, lang, turn.userText, turn.modelText);
      trackEvent('voice_ask_turn', selectedModuleId, { lang, live: true });
    }
  }

  function handleAvatarTurn(turn: { userText: string; modelText: string }) {
    if (turn.userText) addChatMessage(selectedModuleId, 'user', turn.userText);
    if (turn.modelText) addChatMessage(selectedModuleId, 'assistant', turn.modelText);
    if (turn.userText || turn.modelText) {
      syncChatMessage(selectedModuleId, lang, turn.userText, turn.modelText);
      trackEvent('voice_ask_turn', selectedModuleId, { lang, heygen: true });
    }
  }

  const avatarLabel =
    lang === 'bn' ? 'লাইভ অ্যাভাটার' : lang === 'hi' ? 'लाइव अवतार' : 'Live avatar';

  const quickActions = getQuickActions(lang);

  const stateLabel = voiceState === 'thinking'
    ? t('thinking', lang)
    : voiceState === 'speaking'
    ? t('speaking', lang)
    : '';

  const stateTone: 'terra' | 'gold' | 'forest' | 'muted' = voiceState === 'thinking'
    ? 'gold'
    : voiceState === 'speaking'
    ? 'forest'
    : 'muted';

  // Hide the empty seeded assistant bubble while it has no content. Keeps
  // the thinking dots as the only visual until first token arrives.
  const lastIdx = messages.length - 1;
  const renderMessages = messages.filter(
    (m, i) => !(i === lastIdx && m.role === 'assistant' && m.content === '')
  );
  const streamingAssistant =
    loading &&
    messages[lastIdx]?.role === 'assistant' &&
    messages[lastIdx].content !== '';

  return (
    <div className="flex-1 min-h-0 flex flex-col w-full max-w-3xl mx-auto">
      {/* Live HeyGen avatar — always visible on Ask */}
      <div className="shrink-0 px-4 lg:px-6 pt-3 pb-1 border-b border-line/60 bg-paper">
        <HeygenAvatarPanel
          lang={lang}
          moduleId={selectedModuleId}
          live={avatarLive && !avatarOpen}
          onLiveChange={setAvatarLive}
          session={avatarSession}
        />
        <p className="text-center text-[10px] text-muted mt-1">
          {lang === 'bn'
            ? 'লাইভ কথা বলতে Start চাপো · ক্যামেরা = পূর্ণ স্ক্রিন'
            : lang === 'hi'
            ? 'बोलने के लिए Start दबाएँ · कैमरा = फुल स्क्रीन'
            : 'Tap Start to talk live · camera = fullscreen'}
        </p>
      </div>

      {/* Messages — internal scroll */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 lg:px-6 py-4 space-y-3 hide-scrollbar">
        {renderMessages.length === 0 && (
          <div className="flex flex-col items-center text-center py-10">
            <Avatar size={64} useImage />
            <Tag tone="muted" className="mt-4">{selectedModuleId}</Tag>
            <p className="font-serif italic text-base text-ink mt-2 max-w-sm">
              {currentModule
                ? `${getTitle(currentModule, lang)}`
                : t('typeMessage', lang)}
            </p>
            <p className="text-xs text-muted mt-1">
              {lang === 'bn' ? 'Vajra Acharya কিছু জিজ্ঞাসা করো' : lang === 'hi' ? 'Vajra Acharya कुछ पूछो' : 'Ask Vajra Acharya anything'}
            </p>
            <div className="flex flex-wrap gap-2 justify-center mt-5 max-w-md">
              {quickActions.map((qa, i) => (
                <button
                  key={i}
                  onClick={() => sendMessage(qa.message)}
                  className="bg-sage hover:bg-sage-deep text-forest text-[11px] font-semibold px-3 py-1.5 rounded-full transition-colors"
                >
                  {qa.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {renderMessages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {msg.role === 'assistant' && (
              <Avatar size={28} useImage className="mr-2 mt-0.5" />
            )}
            <div
              className={`max-w-[82%] rounded-2xl px-4 py-2.5 text-[14px] leading-[1.55] whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-forest text-cream rounded-br-sm'
                  : 'bg-surface text-ink border border-line rounded-bl-sm shadow-sm'
              }`}
            >
              {msg.content}
              {streamingAssistant && i === renderMessages.length - 1 && (
                <span className="inline-block w-1.5 h-3 ml-0.5 align-text-bottom bg-forest/60 animate-pulse rounded-sm" />
              )}
            </div>
          </div>
        ))}

        {loading && !streamingAssistant && (
          <div className="flex justify-start items-end">
            <Avatar size={28} useImage className="mr-2" />
            <div className="bg-surface border border-line rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
              <div className="flex gap-1.5">
                <span className="w-1.5 h-1.5 bg-forest rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 bg-forest rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-forest rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Voice state indicator */}
      {stateLabel && (
        <div className="text-center py-1 shrink-0">
          <Tag tone={stateTone}>{stateLabel}</Tag>
        </div>
      )}

      {/* Input — pinned at the bottom of the chat container */}
      <div className="shrink-0 border-t border-line bg-paper px-4 lg:px-6 py-3">
        <div className="flex items-end gap-2 max-w-3xl mx-auto">
          <button
            onClick={toggleVoice}
            className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
              voiceEnabled
                ? 'bg-forest text-cream'
                : 'bg-cream text-muted border border-line'
            }`}
            title={t('voiceOn', lang)}
            aria-pressed={voiceEnabled}
            aria-label={t('voiceOn', lang)}
          >
            <Icon name={voiceEnabled ? 'speaker' : 'speakerOff'} size={18} />
          </button>

          <button
            onClick={() => {
              if (!avatarLive && !avatarOpen) setAvatarLive(true);
              setAvatarOpen(true);
            }}
            disabled={loading || voiceState === 'thinking'}
            aria-label={avatarLabel}
            title={avatarLabel}
            className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-colors bg-cream text-ink border border-line hover:bg-sage disabled:opacity-40"
          >
            <Icon name="cam" size={18} />
          </button>

          <button
            onClick={() => setVoiceOpen(true)}
            disabled={voiceState === 'thinking'}
            aria-label={lang === 'bn' ? 'ভয়েস কথোপকথন খুলুন' : lang === 'hi' ? 'वॉइस बातचीत खोलें' : 'Open voice conversation'}
            title={lang === 'bn' ? 'ভয়েস কথোপকথন' : lang === 'hi' ? 'वॉइस बातचीत' : 'Voice conversation'}
            className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
              'bg-cream text-ink border border-line hover:bg-sage disabled:opacity-40'
            }`}
          >
            <Icon name="mic" size={18} />
          </button>

          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage(input);
              }
            }}
            placeholder={t('typeMessage', lang)}
            rows={1}
            className="flex-1 resize-none bg-cream border border-line rounded-2xl px-4 py-2.5 text-sm leading-snug max-h-32 focus:outline-none focus:ring-2 focus:ring-forest/30 focus:border-forest text-ink placeholder:text-muted"
          />

          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || loading}
            aria-label={t('send', lang)}
            className="shrink-0 w-10 h-10 rounded-full bg-forest text-cream flex items-center justify-center disabled:opacity-40 hover:bg-forest-deep transition-colors"
          >
            <Icon name="arrowR" size={18} strokeWidth={2} />
          </button>
        </div>
      </div>

      <audio ref={audioRef} className="hidden" />
      <GeminiLiveOverlay
        open={voiceOpen}
        mode="ask"
        lang={lang}
        moduleId={selectedModuleId}
        title={currentModule ? getTitle(currentModule, lang) : 'Vajra Acharya'}
        subtitle={selectedModuleId}
        onClose={() => setVoiceOpen(false)}
        onTurnComplete={handleLiveTurn}
      />
      <HeygenLiveOverlay
        open={avatarOpen}
        lang={lang}
        title={currentModule ? getTitle(currentModule, lang) : 'Vajra Acharya'}
        subtitle={selectedModuleId}
        session={avatarSession}
        onClose={() => {
          setAvatarOpen(false);
          setAvatarLive(false);
        }}
        onTurnComplete={handleAvatarTurn}
      />
    </div>
  );
}





