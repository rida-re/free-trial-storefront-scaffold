"use client";

import { useEffect, useRef, type JSX } from "react";
import { useRouter } from "@/i18n/routing";
import type { ConversationMessage } from "./types";

// ── Wave bars (audio visualization) ──
const WaveBars = (): JSX.Element => (
  <div className="flex items-end justify-center gap-[3px] h-6">
    {[0, 1, 2, 3, 4].map((i) => (
      <span
        key={i}
        className="w-[3px] rounded-full bg-terra"
        style={{
          animation: "vapi-wave 1s ease-in-out infinite",
          animationDelay: `${i * 0.15}s`,
          height: 6,
        }}
      />
    ))}
  </div>
);

// ── Typing dots ──
const TypingDots = (): JSX.Element => (
  <div className="flex items-center gap-1 py-1">
    {[0, 1, 2].map((i) => (
      <span
        key={i}
        className="block h-1.5 w-1.5 rounded-full bg-charcoal-light"
        style={{
          animation: "vapi-dot-bounce 1.4s ease-in-out infinite",
          animationDelay: `${i * 0.2}s`,
        }}
      />
    ))}
  </div>
);

interface ConversationPanelProps {
  isListening: boolean;
  status: string;
  history: ConversationMessage[];
  lastReply: string;
  cartCount: number;
  onClose: () => void;
}

export default function ConversationPanel({
  isListening,
  status,
  history,
  lastReply,
  cartCount,
  onClose,
}: ConversationPanelProps) {
  const router = useRouter();
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, lastReply]);

  return (
    <div
      className="w-[360px] rounded-2xl border border-border bg-cream shadow-2xl overflow-hidden"
      style={{ animation: "vapi-slide-up 0.25s ease-out" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border bg-white px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-charcoal text-sm text-cream">
            AI
          </div>
          <div>
            <p className="text-sm font-semibold text-charcoal leading-tight">
              Shopping Assistant
            </p>
            <p className="text-[11px] text-charcoal-light flex items-center gap-1">
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                  isListening ? "bg-sage" : "bg-charcoal-light/40"
                }`}
              />
              {status}
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="flex h-7 w-7 items-center justify-center rounded-full text-charcoal-light hover:bg-cream-dark hover:text-charcoal transition-colors"
          aria-label="Close"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path
              d="M1 1l12 12M13 1L1 13"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {/* Wave visualisation when listening */}
      {isListening && (
        <div className="flex flex-col items-center gap-2 border-b border-border bg-white/60 py-3">
          <WaveBars />
          <span className="text-[11px] font-medium text-charcoal-light">
            {status === "Processing…" ? "Thinking…" : "Listening…"}
          </span>
        </div>
      )}

      {/* Chat body */}
      <div className="max-h-[340px] min-h-[100px] overflow-y-auto px-4 py-3 space-y-3">
        {history.length === 0 && !lastReply && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-cream-dark text-lg">
              🎙️
            </div>
            <p className="text-xs text-charcoal-light max-w-[220px]">
              {isListening
                ? "Start speaking — I'm listening…"
                : "Press the button below to start a conversation."}
            </p>
          </div>
        )}

        {history.map((m, i) => (
          <div
            key={`${m.timestamp}-${i}`}
            className={`flex items-end gap-2 ${m.role === "user" ? "flex-row-reverse" : ""}`}
            style={{ animation: "vapi-fade-in 0.2s ease-out" }}
          >
            <div
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                m.role === "user"
                  ? "bg-charcoal text-cream"
                  : "bg-terra/15 text-terra"
              }`}
            >
              {m.role === "user" ? "You" : "AI"}
            </div>
            <div
              className={`max-w-[75%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed ${
                m.role === "user"
                  ? "rounded-br-md bg-charcoal text-cream"
                  : "rounded-bl-md bg-white text-charcoal border border-border"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}

        {/* Processing indicator */}
        {isListening && status === "Processing…" && (
          <div className="flex items-end gap-2">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-terra/15 text-terra text-[10px] font-bold">
              AI
            </div>
            <div className="rounded-2xl rounded-bl-md bg-white border border-border px-3 py-2">
              <TypingDots />
            </div>
          </div>
        )}

        <div ref={chatEndRef} />
      </div>

      {/* Footer: cart summary */}
      {cartCount > 0 && (
        <div className="flex items-center justify-between border-t border-border bg-white px-4 py-2.5">
          <span className="text-[11px] text-charcoal-light">
            {cartCount} item{cartCount > 1 ? "s" : ""} in cart
          </span>
          <button
            onClick={() => {
              router.push("/cart");
              onClose();
            }}
            className="text-[11px] font-semibold text-terra hover:text-terra-dark transition-colors"
          >
            View cart →
          </button>
        </div>
      )}
    </div>
  );
}
