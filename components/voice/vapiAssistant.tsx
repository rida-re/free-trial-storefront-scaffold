/* eslint-disable no-console */
"use client";

import { useEffect, useRef, useState, useCallback, type JSX } from "react";
import { useRouter } from "@/i18n/routing";
import Vapi from "@vapi-ai/web";
import { useCartContext } from "@/context/CartProvider";
import { usePathname } from "next/navigation";

type VapiInstance = InstanceType<typeof Vapi>;

interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

interface ToolResult {
  success: boolean;
  message: string;
  [key: string]: unknown;
}

const NAV_TIMEOUT_MS = 4000;

export default function VapiAssistant() {
  const vapiRef = useRef<VapiInstance | null>(null);
  const processingRef = useRef(false);
  const pathname = usePathname();
  // Keep a ref mirror of the live pathname so the navigation watcher
  // (which runs inside a closure created at call-time) always sees the
  // latest value instead of relying on window.location polling.
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  const [isListening, setIsListening] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [history, setHistory] = useState<ConversationMessage[]>([]);
  const [lastReply, setLastReply] = useState("");

  const router = useRouter();
  const { cart, mutateCart } = useCartContext();

  // Keep latest cart/mutateCart in refs so the Vapi event listeners
  // (registered once on mount) never act on stale closures.
  const cartRef = useRef(cart);
  const mutateCartRef = useRef(mutateCart);
  useEffect(() => {
    cartRef.current = cart;
  }, [cart]);
  useEffect(() => {
    mutateCartRef.current = mutateCart;
  }, [mutateCart]);

  const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPI_PUBLIC_KEY;
  const ASSISTANT_ID = process.env.NEXT_PUBLIC_VAPI_ASSISTANT_ID;

  // ─── Navigation ─────────────────────────────────────────────────────────────
  // useRouter from @/i18n/routing auto-prepends locale prefix (/en-US, /de-DE…),
  // so we can't compare window.location.pathname to the raw path we pushed.
  // Instead we watch `pathname` (from next/navigation, already locale-aware)
  // via a ref, and resolve as soon as it changes — with a hard timeout so a
  // failed/aborted navigation can never hang a tool call (or the busy lock)
  // forever.

  const go = useCallback(
    (path: string): Promise<ToolResult> => {
      const startedFrom = pathnameRef.current;
      router.push(path);

      return new Promise((resolve) => {
        let settled = false;
        const finish = (result: ToolResult) => {
          if (settled) return;
          settled = true;
          clearInterval(interval);
          clearTimeout(timeout);
          resolve(result);
        };

        const interval = setInterval(() => {
          if (pathnameRef.current !== startedFrom) {
            finish({ success: true, message: "Navigation completed" });
          }
        }, 100);

        const timeout = setTimeout(() => {
          // Don't fail outright — the push may still be in flight (e.g. slow
          // route transition) — but stop blocking the assistant indefinitely.
          finish({
            success: pathnameRef.current !== startedFrom,
            message:
              pathnameRef.current !== startedFrom
                ? "Navigation completed"
                : "Navigation is taking longer than expected",
          });
        }, NAV_TIMEOUT_MS);
      });
    },
    [router],
  );

  // ─── Cart: change quantity ──────────────────────────────────────────────────

  const changeQty = useCallback(
    async (query: string, quantity: number): Promise<ToolResult> => {
      const items = cartRef.current?.lineItems;
      if (!items?.length) return { success: false, message: "Your cart is empty" };

      const q = query.toLowerCase();
      const match = items.find(
        (li) =>
          li.name.toLowerCase().includes(q) || q.includes(li.name.toLowerCase()),
      );
      if (!match) {
        return { success: false, message: `"${query}" not found in your cart` };
      }
      if (!Number.isFinite(quantity) || quantity < 1) {
        return { success: false, message: "Quantity must be at least 1" };
      }

      try {
        await mutateCartRef.current.changeQuantity(match.id, quantity);
        return {
          success: true,
          message: `Updated "${match.name}" quantity to ${quantity}`,
        };
      } catch (err) {
        console.error("changeQty failed:", err);
        return { success: false, message: "Failed to update quantity" };
      }
    },
    [],
  );

  // ─── Cart: get contents ─────────────────────────────────────────────────────

  const getCart = useCallback((): ToolResult => {
    const items = cartRef.current?.lineItems;
    if (!items?.length) {
      return { success: true, message: "Your cart is empty" };
    }

    const lines = items.map(
      (li) =>
        `${li.quantity}× ${li.name} (${(li.totalPrice.centAmount / 100).toFixed(2)} ${li.totalPrice.currencyCode})`,
    );
    const total = (cartRef.current!.totalPrice.centAmount / 100).toFixed(2);

    return {
      success: true,
      message: `Cart: ${lines.join("; ")}. Total: ${total} ${cartRef.current!.totalPrice.currencyCode}`,
    };
  }, []);

  // ─── Cart: clear ────────────────────────────────────────────────────────────

  const clearCart = useCallback(async (): Promise<ToolResult> => {
    const items = cartRef.current?.lineItems;
    if (!items?.length) return { success: true, message: "Cart is already empty" };

    try {
      for (const item of [...items]) {
        await mutateCartRef.current.removeLineItem(item.id);
        // Small wait between mutations to avoid version conflicts
        await new Promise((r) => setTimeout(r, 120));
      }
      return { success: true, message: "All items removed from cart" };
    } catch (err) {
      console.error("clearCart failed:", err);
      return { success: false, message: "Failed to clear cart" };
    }
  }, []);

  // ─── Cart: apply discount ───────────────────────────────────────────────────

  const applyDiscount = useCallback(async (code: string): Promise<ToolResult> => {
    try {
      await mutateCartRef.current.applyDiscount(code);
      return { success: true, message: `Discount code "${code}" applied` };
    } catch (err) {
      console.error("applyDiscount failed:", err);
      return { success: false, message: `Discount code "${code}" is invalid or expired` };
    }
  }, []);

  // ─── Tool call dispatcher ───────────────────────────────────────────────────

  const dispatch = useCallback(
    async (toolCall: Record<string, unknown>): Promise<ToolResult> => {
      if (processingRef.current) {
        return { success: false, message: "Another action is in progress, please wait" };
      }
      processingRef.current = true;

      const fn = toolCall.function as { name?: string; arguments?: string } | undefined;
      const name = fn?.name ?? (toolCall.name as string | undefined) ?? "";

      let params: Record<string, unknown> = {};
      try {
        const raw = fn?.arguments ?? toolCall.parameters;
        params =
          typeof raw === "string" ? (JSON.parse(raw) as Record<string, unknown>) : (raw as Record<string, unknown>) ?? {};
      } catch (err) {
        console.warn("Failed to parse tool arguments:", err);
        params = {};
      }

      const callId = (toolCall.toolCallId ?? toolCall.id) as string | undefined;
      let result: ToolResult = { success: false, message: `Unknown function: ${name}` };

      try {
        switch (name) {
          case "navigate_to_cart":
            result = await go("/cart");
            break;
          case "navigate_to_home":
            result = await go("/");
            break;
          case "navigate_to_checkout":
            result = await go("/checkout");
            break;
          case "show_products":
            result = await go("/search");
            break;
          case "show_category": {
            const category = params.category as string | undefined;
            if (!category) {
              result = { success: false, message: "category parameter is required" };
            } else {
              const slug = category
                .toLowerCase()
                .replace(/[^a-z0-9\s-]/g, "")
                .replace(/\s+/g, "-")
                .replace(/-+/g, "-");
              result = slug
                ? await go(`/category/${slug}`)
                : { success: false, message: "category parameter is invalid" };
            }
            break;
          }
          case "search_products": {
            const q = params.query as string | undefined;
            if (!q) {
              result = { success: false, message: "query parameter is required" };
            } else {
              result = await go(`/search?q=${encodeURIComponent(q)}`);
            }
            break;
          }
          case "change_quantity": {
            const pn = params.product_name as string | undefined;
            const qty = params.quantity as number | undefined;
            if (!pn || qty == null) {
              result = { success: false, message: "product_name and quantity are required" };
            } else {
              result = await changeQty(pn, qty);
            }
            break;
          }
          case "get_cart_contents":
            result = getCart();
            break;
          case "clear_cart":
            result = await clearCart();
            break;
          case "apply_discount": {
            const code = params.code as string | undefined;
            result = code
              ? await applyDiscount(code)
              : { success: false, message: "code is required" };
            break;
          }
          default:
            result = { success: false, message: `Unknown function: ${name}` };
        }
      } catch (err) {
        console.error(`Tool "${name}" error:`, err);
        result = { success: false, message: `Error: ${String(err)}` };
      } finally {
        // Always release the lock, even if a case above throws or a promise
        // never resolves the way we expect.
        processingRef.current = false;
      }

      // Send result back to Vapi so it can respond verbally
      if (vapiRef.current && callId) {
        try {
          vapiRef.current.send({ type: "tool-calls-result", toolCallId: callId, result });
        } catch (sendErr) {
          console.warn("Failed to send result to Vapi:", sendErr);
        }
      }

      return result;
    },
    [go, changeQty, getCart, clearCart, applyDiscount],
  );

  // ─── Tool definitions for inline config ─────────────────────────────────────

  const TOOLS = [
    { type: "function" as const, function: { name: "navigate_to_cart", description: "Navigate to the shopping cart page", parameters: { type: "object", properties: {} } } },
    { type: "function" as const, function: { name: "navigate_to_home", description: "Navigate to the home page", parameters: { type: "object", properties: {} } } },
    { type: "function" as const, function: { name: "navigate_to_checkout", description: "Navigate to the checkout page", parameters: { type: "object", properties: {} } } },
    { type: "function" as const, function: { name: "show_products", description: "Show all products on the search page", parameters: { type: "object", properties: {} } } },
    { type: "function" as const, function: { name: "show_category", description: "Navigate to a product category by name", parameters: { type: "object", properties: { category: { type: "string", description: "Category name" } }, required: ["category"] } } },
    { type: "function" as const, function: { name: "search_products", description: "Search products by keyword and navigate to results", parameters: { type: "object", properties: { query: { type: "string", description: "Search keywords" } }, required: ["query"] } } },
    { type: "function" as const, function: { name: "change_quantity", description: "Change the quantity of a product already in the cart", parameters: { type: "object", properties: { product_name: { type: "string", description: "Product name in cart" }, quantity: { type: "number", description: "New quantity" } }, required: ["product_name", "quantity"] } } },
    { type: "function" as const, function: { name: "get_cart_contents", description: "List all items in the cart with prices", parameters: { type: "object", properties: {} } } },
    { type: "function" as const, function: { name: "clear_cart", description: "Remove all items from the cart", parameters: { type: "object", properties: {} } } },
    { type: "function" as const, function: { name: "apply_discount", description: "Apply a discount/promo code to the cart", parameters: { type: "object", properties: { code: { type: "string", description: "Discount code" } }, required: ["code"] } } },
  ];

  const SYSTEM_PROMPT = `You are a shopping voice assistant.

Rules:
- ALWAYS use tools for actions.
- Never invent products or categories.
- After navigation, don't mention URLs.
- Confirm actions in one short sentence.
- Ask clarification questions when unsure.
- Never repeat yourself.
- Speak naturally.
- Do not list multiple products unless asked.
- Wait until a tool finishes before responding.
- If navigation occurs, answer only after completion.`;

  // ─── Start / Stop ───────────────────────────────────────────────────────────

  const startAssistant = useCallback(async () => {
    const vapi = vapiRef.current;
    if (!vapi) return;
    setStatus("Starting…");

    try {
      if (ASSISTANT_ID && ASSISTANT_ID !== "YOUR_ASSISTANT_ID") {
        // Assistant configured in Vapi dashboard — tools + voice settings there
        await vapi.start(ASSISTANT_ID);
      } else {
        await vapi.start({
          model: {
            provider: "openai",
            model: "gpt-4o-mini",
            messages: [{ role: "system", content: SYSTEM_PROMPT }],
            tools: TOOLS,
          },
          voice: { provider: "openai", voiceId: "alloy" },
          firstMessage:
            "Hi! I'm your shopping assistant. How can I help you today?",
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

    // Avoid double-dispatching the same tool call if Vapi ever fires it on
    // both "function-call" and inside a "message" event for the same call.
    const seenCallIds = new Set<string>();
    const dispatchOnce = (tc: Record<string, unknown>) => {
      const id = (tc.toolCallId ?? tc.id) as string | undefined;
      if (id) {
        if (seenCallIds.has(id)) return;
        seenCallIds.add(id);
        // Keep the de-dupe set from growing unbounded over a long call.
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

    // Primary: Vapi delivers tool calls via this event
    vapi.on("function-call", (tc: unknown) => {
      console.log("function-call:", tc);
      dispatchOnce(tc as Record<string, unknown>);
    });

    // Fallback: tool calls inside message events
    vapi.on("message", (msg: Record<string, unknown>) => {
      // Conversation history
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
      // Fallback tool calls
      if (msg.type === "tool-calls" && Array.isArray(msg.toolCalls)) {
        (msg.toolCalls as Record<string, unknown>[]).forEach((tc) => dispatchOnce(tc));
      }
    });

    // Auto-restart on silence timeout
    vapi.on("status-update", (msg: Record<string, unknown>) => {
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

  // ─── Render ─────────────────────────────────────────────────────────────────

  const [panelOpen, setPanelOpen] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const cartCount = cart?.lineItems?.reduce((s, li) => s + li.quantity, 0) ?? 0;

  // Auto-open panel when listening starts
  useEffect(() => {
    if (isListening) setPanelOpen(true);
  }, [isListening]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, lastReply]);

  const toggle = () => {
    if (isListening) {
      stopAssistant();
      setPanelOpen(false);
    } else {
      startAssistant();
      setPanelOpen(true);
    }
  };

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

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end gap-3">
      {/* ── Conversation Panel ── */}
      {panelOpen && (
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
              onClick={() => setPanelOpen(false)}
              className="flex h-7 w-7 items-center justify-center rounded-full text-charcoal-light hover:bg-cream-dark hover:text-charcoal transition-colors"
              aria-label="Close"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
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
                  setPanelOpen(false);
                }}
                className="text-[11px] font-semibold text-terra hover:text-terra-dark transition-colors"
              >
                View cart →
              </button>
            </div>
          )}
        </div>
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
              <path d="M5 10a5 5 0 0010 0" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
              <line x1="10" y1="15" x2="10" y2="18" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
              <line x1="7" y1="18" x2="13" y2="18" stroke="white" strokeWidth="1.6" strokeLinecap="round" />
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