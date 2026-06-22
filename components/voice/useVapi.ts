/* eslint-disable no-console */
"use client";

import { useCallback, useEffect, useState, type MutableRefObject } from "react";
import Vapi from "@vapi-ai/web";
import { SYSTEM_PROMPT, TOOLS, FIRST_MESSAGE } from "./toolDefinitions";
import type { VapiInstance, ConversationMessage, ToolResult } from "./types";

interface UseVapiOptions {
  vapiRef: MutableRefObject<VapiInstance | null>;
  processingRef: MutableRefObject<boolean>;
  dispatch: (toolCall: Record<string, unknown>) => Promise<ToolResult>;
}

export function useVapi({ vapiRef, processingRef, dispatch }: UseVapiOptions) {
  const [isListening, setIsListening] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [history, setHistory] = useState<ConversationMessage[]>([]);
  const [lastReply, setLastReply] = useState("");

  const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY;
  const ASSISTANT_ID = process.env.NEXT_PUBLIC_VAPI_ASSISTANT_ID;

  // ─── Start / Stop ───────────────────────────────────────────────────────────

  const startAssistant = useCallback(async () => {
    const vapi = vapiRef.current;
    if (!vapi) return;
    setStatus("Starting…");

    try {
      if (ASSISTANT_ID && ASSISTANT_ID !== "YOUR_ASSISTANT_ID") {
        await vapi.start(ASSISTANT_ID);
      } else {
        await vapi.start({
          model: {
            provider: "openai",
            model: "gpt-4o",
            messages: [{ role: "system", content: SYSTEM_PROMPT }],
            tools: TOOLS,
          },
          voice: {
            provider: "11labs",
            voiceId: "Sarah",
            stability: 0.4,
            similarityBoost: 0.8,
          },
          firstMessage: FIRST_MESSAGE,
        });
      }
      setStatus("Listening…");
    } catch (err) {
      console.error("Failed to start:", err);
      setStatus("Failed to start");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ASSISTANT_ID]);

  const stopAssistant = useCallback(() => {
    const vapi = vapiRef.current;
    if (!vapi) return;
    setStatus("Stopping…");
    try {
      vapi.stop();
    } catch (err) {
      console.warn("vapi.stop() failed:", err);
    }
    setStatus("Stopped");
  }, []);

  // ─── Vapi init + event listeners ────────────────────────────────────────────

  useEffect(() => {
    if (!PUBLIC_KEY || PUBLIC_KEY === "YOUR_PUBLIC_KEY") {
      setStatus("Missing API Key");
      return;
    }

    const vapi = new Vapi(PUBLIC_KEY);
    vapiRef.current = vapi;

    // Avoid double-dispatching the same tool call
    const seenCallIds = new Set<string>();
    const dispatchOnce = (tc: Record<string, unknown>) => {
      const id = (tc.toolCallId ?? tc.id) as string | undefined;
      if (id) {
        if (seenCallIds.has(id)) return;
        seenCallIds.add(id);
        if (seenCallIds.size > 200) {
          const first = seenCallIds.values().next().value;
          if (first !== undefined) seenCallIds.delete(first);
        }
      }
      dispatch(tc);
    };

    vapi.on("call-start", () => {
      setIsListening(true);
      setStatus("Listening…");
    });

    vapi.on("call-end", () => {
      setIsListening(false);
      setStatus("Call ended");
      processingRef.current = false;
    });

    vapi.on("speech-start", () => setStatus("Listening…"));
    vapi.on("speech-end", () => setStatus("Processing…"));

    vapi.on("error", (err: unknown) => {
      console.error("Vapi error:", err);
      setStatus("Error — try again");
      processingRef.current = false;
    });

    vapi.on("message", (msg: Record<string, unknown>) => {
      if (msg.type === "conversation-item") {
        const item = msg.conversationItem as
          | { type?: string; role?: string; content?: string }
          | undefined;
        if (item?.type === "message" && item.content) {
          const role = item.role === "user" ? "user" : "assistant";
          setHistory((prev) => [
            ...prev.slice(-20),
            { role, content: item.content!, timestamp: Date.now() },
          ]);
          if (role === "assistant") setLastReply(item.content);
        }
      }
      if (msg.type === "tool-calls" && Array.isArray(msg.toolCalls)) {
        (msg.toolCalls as Record<string, unknown>[]).forEach((tc) =>
          dispatchOnce(tc),
        );
      }
    });

    // status-update is not in SDK types but may be emitted at runtime
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (vapi as any).on("status-update", (msg: Record<string, unknown>) => {
      if (msg.status === "ended" && msg.endedReason === "silence-timed-out") {
        setTimeout(() => {
          if (vapiRef.current) startAssistant();
        }, 1500);
      }
    });

    return () => {
      try {
        vapi.stop();
      } catch (err) {
        console.warn("vapi.stop() during cleanup failed:", err);
      }
      vapiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [PUBLIC_KEY]);

  return {
    isListening,
    status,
    history,
    lastReply,
    startAssistant,
    stopAssistant,
  };
}
