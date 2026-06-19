"use client";

import { useEffect, useRef, useState } from "react";
import { useVapiTools } from "./useVapiTools";
import { useVapi } from "./useVapi";
import ConversationPanel from "./ConversationPanel";
import type { VapiInstance } from "./types";

export default function VapiAssistant() {
  const vapiRef = useRef<VapiInstance | null>(null);
  const processingRef = useRef(false);
  const [panelOpen, setPanelOpen] = useState(false);

  // Tools (navigation, cart, dispatcher)
  const { cart, dispatch } = useVapiTools({ vapiRef, processingRef });

  // Vapi SDK (init, events, start/stop)
  const { isListening, status, history, lastReply, startAssistant, stopAssistant } =
    useVapi({ vapiRef, processingRef, dispatch });

  const cartCount =
    cart?.lineItems?.reduce((s, li) => s + li.quantity, 0) ?? 0;

  // Auto-open panel when listening starts
  useEffect(() => {
    if (isListening) setPanelOpen(true);
  }, [isListening]);

  const toggle = () => {
    if (isListening) {
      stopAssistant();
      setPanelOpen(false);
    } else {
      startAssistant();
      setPanelOpen(true);
    }
  };

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3">
      {/* ── Conversation Panel ── */}
      {panelOpen && (
        <ConversationPanel
          isListening={isListening}
          status={status}
          history={history}
          lastReply={lastReply}
          cartCount={cartCount}
          onClose={() => setPanelOpen(false)}
        />
      )}

      {/* ── FAB (Floating Action Button) ── */}
      <div className="relative">
        {/* Pulse ring when active */}
        {isListening && (
          <span
            className="absolute inset-0 rounded-full bg-terra/30"
            style={{ animation: "vapi-pulse-ring 1.8s ease-out infinite" }}
          />
        )}

        <button
          onClick={toggle}
          className={`relative flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-all duration-200 hover:scale-105 active:scale-95 ${
            isListening
              ? "bg-terra hover:bg-terra-dark"
              : "bg-charcoal hover:bg-charcoal-light"
          }`}
          aria-label={isListening ? "Stop assistant" : "Start voice assistant"}
        >
          {isListening ? (
            /* Stop icon */
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <rect x="3" y="3" width="12" height="12" rx="2" fill="white" />
            </svg>
          ) : (
            /* Mic icon */
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <rect x="7" y="2" width="6" height="10" rx="3" fill="white" />
              <path
                d="M5 10a5 5 0 0010 0"
                stroke="white"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
              <line
                x1="10"
                y1="15"
                x2="10"
                y2="18"
                stroke="white"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
              <line
                x1="7"
                y1="18"
                x2="13"
                y2="18"
                stroke="white"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          )}

          {/* Cart count badge */}
          {cartCount > 0 && !isListening && (
            <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-terra px-1 text-[10px] font-bold text-white">
              {cartCount}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}
