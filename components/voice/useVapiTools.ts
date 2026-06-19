/* eslint-disable no-console */
"use client";

import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import { useRouter } from "@/i18n/routing";
import { usePathname } from "next/navigation";
import { useCartContext } from "@/context/CartProvider";
import { NAV_TIMEOUT_MS, type ToolResult, type VapiInstance } from "./types";

interface UseVapiToolsOptions {
  vapiRef: MutableRefObject<VapiInstance | null>;
  processingRef: MutableRefObject<boolean>;
}

export function useVapiTools({ vapiRef, processingRef }: UseVapiToolsOptions) {
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

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

  // ─── Navigation ─────────────────────────────────────────────────────────────

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
      if (!items?.length)
        return { success: false, message: "Your cart is empty" };

      const q = query.toLowerCase();
      const match = items.find(
        (li) =>
          li.name.toLowerCase().includes(q) ||
          q.includes(li.name.toLowerCase()),
      );
      if (!match) {
        return {
          success: false,
          message: `"${query}" not found in your cart`,
        };
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
    if (!items?.length)
      return { success: true, message: "Cart is already empty" };

    try {
      for (const item of [...items]) {
        await mutateCartRef.current.removeLineItem(item.id);
        await new Promise((r) => setTimeout(r, 120));
      }
      return { success: true, message: "All items removed from cart" };
    } catch (err) {
      console.error("clearCart failed:", err);
      return { success: false, message: "Failed to clear cart" };
    }
  }, []);

  // ─── Cart: apply discount ───────────────────────────────────────────────────

  const applyDiscount = useCallback(
    async (code: string): Promise<ToolResult> => {
      try {
        await mutateCartRef.current.applyDiscount(code);
        return { success: true, message: `Discount code "${code}" applied` };
      } catch (err) {
        console.error("applyDiscount failed:", err);
        return {
          success: false,
          message: `Discount code "${code}" is invalid or expired`,
        };
      }
    },
    [],
  );

  // ─── Checkout: set address ──────────────────────────────────────────────────

  const checkoutSetAddress = useCallback(
    async (params: Record<string, unknown>): Promise<ToolResult> => {
      const firstName = params.first_name as string;
      const lastName = params.last_name as string;
      const street = params.street as string;
      const city = params.city as string;
      const postalCode = params.postal_code as string;
      const country = params.country as string;
      const region = params.region as string | undefined;
      const email = params.email as string | undefined;
      const phone = params.phone as string | undefined;
      const sameBilling = (params.same_billing as boolean) !== false;

      const address: Record<string, string> = {
        firstName,
        lastName,
        streetName: street,
        city,
        postalCode,
        country,
      };
      if (region) address.region = region;
      if (email) address.email = email;
      if (phone) address.phone = phone;

      try {
        const res = await fetch("/api/cart/address", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            shippingAddress: address,
            ...(sameBilling ? { billingAddress: address } : {}),
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || "Failed to set address");

        return {
          success: true,
          message: `Shipping address set to ${street}, ${city}, ${postalCode}, ${country}. ${sameBilling ? "Billing address is the same." : ""}`,
        };
      } catch (err) {
        console.error("checkoutSetAddress failed:", err);
        return {
          success: false,
          message: `Failed to set address: ${err instanceof Error ? err.message : "Unknown error"}`,
        };
      }
    },
    [],
  );

  // ─── Checkout: list shipping methods ────────────────────────────────────────

  const checkoutListShipping = useCallback(async (): Promise<ToolResult> => {
    try {
      const res = await fetch("/api/shipping-methods");
      if (!res.ok) throw new Error("Could not fetch shipping methods");
      const json = await res.json();
      const methods = json.shippingMethods as Array<{
        id: string;
        name: string;
        description?: string;
        price: { centAmount: number; currencyCode: string };
        isDefault: boolean;
      }>;

      if (!methods?.length) {
        return {
          success: true,
          message: "No shipping methods available. Please set a shipping address first.",
        };
      }

      const lines = methods.map(
        (m) =>
          `${m.name}${m.isDefault ? " (default)" : ""}: ${(m.price.centAmount / 100).toFixed(2)} ${m.price.currencyCode}`,
      );
      return {
        success: true,
        message: `Available shipping methods: ${lines.join("; ")}. Which one would you like?`,
      };
    } catch (err) {
      console.error("checkoutListShipping failed:", err);
      return {
        success: false,
        message: "Failed to list shipping methods",
      };
    }
  }, []);

  // ─── Checkout: select shipping method ───────────────────────────────────────

  const checkoutSelectShipping = useCallback(
    async (methodName: string): Promise<ToolResult> => {
      try {
        // First fetch available methods to find the matching ID
        const listRes = await fetch("/api/shipping-methods");
        if (!listRes.ok) throw new Error("Could not fetch shipping methods");
        const listJson = await listRes.json();
        const methods = listJson.shippingMethods as Array<{
          id: string;
          name: string;
        }>;

        const match = methods.find(
          (m) => m.name.toLowerCase() === methodName.toLowerCase(),
        );
        if (!match) {
          const available = methods.map((m) => m.name).join(", ");
          return {
            success: false,
            message: `"${methodName}" not found. Available methods: ${available}`,
          };
        }

        const res = await fetch("/api/cart/shipping-method", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shippingMethodId: match.id }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.error || "Failed to set shipping");

        return {
          success: true,
          message: `Shipping method set to "${match.name}". You can now proceed to payment.`,
        };
      } catch (err) {
        console.error("checkoutSelectShipping failed:", err);
        return {
          success: false,
          message: `Failed to select shipping: ${err instanceof Error ? err.message : "Unknown error"}`,
        };
      }
    },
    [],
  );

  // ─── Checkout: get status ───────────────────────────────────────────────────

  const checkoutStatus = useCallback((): ToolResult => {
    const c = cartRef.current;
    if (!c || !c.lineItems.length) {
      return {
        success: false,
        message: "Your cart is empty. Add some products before checking out.",
      };
    }

    const items = c.lineItems
      .map(
        (li) =>
          `${li.quantity}× ${li.name} (${(li.totalPrice.centAmount / 100).toFixed(2)} ${li.totalPrice.currencyCode})`,
      )
      .join(", ");
    const total = `${(c.totalPrice.centAmount / 100).toFixed(2)} ${c.totalPrice.currencyCode}`;

    const hasShippingAddr = !!c.shippingAddress?.streetName;
    const hasBillingAddr = !!c.billingAddress?.streetName;
    const hasShippingMethod = !!c.shippingInfo;

    const steps: string[] = [];
    steps.push(
      hasShippingAddr
        ? `✓ Shipping address: ${c.shippingAddress!.streetName}, ${c.shippingAddress!.city}`
        : "✗ Shipping address: not set",
    );
    steps.push(
      hasBillingAddr
        ? `✓ Billing address: ${c.billingAddress!.streetName}, ${c.billingAddress!.city}`
        : "✗ Billing address: not set",
    );
    steps.push(
      hasShippingMethod
        ? `✓ Shipping method: ${c.shippingInfo!.methodName}`
        : "✗ Shipping method: not selected",
    );
    steps.push(
      hasShippingAddr && hasBillingAddr && hasShippingMethod
        ? "✓ Ready for payment"
        : "✗ Not ready for payment yet",
    );

    return {
      success: true,
      message: `Checkout status:\n${steps.join("\n")}\n\nCart: ${items}. Total: ${total}`,
    };
  }, []);

  // ─── Checkout: start flow ───────────────────────────────────────────────────

  const checkoutStart = useCallback(async (): Promise<ToolResult> => {
    const c = cartRef.current;
    if (!c || !c.lineItems.length) {
      return {
        success: false,
        message: "Your cart is empty. Please add some products first.",
      };
    }

    const hasAddr = !!(
      c.shippingAddress?.streetName &&
      c.billingAddress?.streetName
    );
    const hasMethod = !!c.shippingInfo;

    if (hasAddr && hasMethod) {
      return go("/checkout/payment");
    } else if (hasAddr) {
      return go("/checkout/shipping");
    } else {
      return go("/checkout/addresses");
    }
  }, [go]);

  // ─── Add to cart (search + add) ─────────────────────────────────────────────

  const addToCart = useCallback(
    async (productName: string, quantity = 1): Promise<ToolResult> => {
      if (!Number.isFinite(quantity) || quantity < 1) quantity = 1;

      try {
        // 1. Search for the product by name
        const searchRes = await fetch(
          `/api/products/search?q=${encodeURIComponent(productName)}&limit=5`,
        );
        if (!searchRes.ok) throw new Error("Search failed");
        const searchData = await searchRes.json();

        const products = searchData.products as Array<{
          id: string;
          name: string;
          masterVariantId: number;
          price: { centAmount: number; currencyCode: string } | null;
        }>;

        if (!products?.length) {
          return {
            success: false,
            message: `No products found matching "${productName}". Try different keywords.`,
          };
        }

        // 2. Pick the best match (first result)
        const product = products[0];

        // 3. Add to cart via mutateCart
        await mutateCartRef.current.addItem(
          product.id,
          product.masterVariantId,
          quantity,
        );

        const priceStr = product.price
          ? ` at ${(product.price.centAmount / 100).toFixed(2)} ${product.price.currencyCode}`
          : "";

        return {
          success: true,
          message: `Added ${quantity}× "${product.name}" to your cart${priceStr}.`,
        };
      } catch (err) {
        console.error("addToCart failed:", err);
        return {
          success: false,
          message: `Failed to add "${productName}" to cart: ${err instanceof Error ? err.message : "Unknown error"}`,
        };
      }
    },
    [],
  );

  // ─── Tool call dispatcher ───────────────────────────────────────────────────

  const dispatch = useCallback(
    async (toolCall: Record<string, unknown>): Promise<ToolResult> => {
      if (processingRef.current) {
        return {
          success: false,
          message: "Another action is in progress, please wait",
        };
      }
      processingRef.current = true;

      const fn = toolCall.function as
        | { name?: string; arguments?: string }
        | undefined;
      const name = fn?.name ?? (toolCall.name as string | undefined) ?? "";

      let params: Record<string, unknown> = {};
      try {
        const raw = fn?.arguments ?? toolCall.parameters;
        params =
          typeof raw === "string"
            ? (JSON.parse(raw) as Record<string, unknown>)
            : (raw as Record<string, unknown>) ?? {};
      } catch (err) {
        console.warn("Failed to parse tool arguments:", err);
        params = {};
      }

      const callId = (toolCall.toolCallId ?? toolCall.id) as
        | string
        | undefined;
      let result: ToolResult = {
        success: false,
        message: `Unknown function: ${name}`,
      };

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
              result = {
                success: false,
                message: "category parameter is required",
              };
            } else {
              const slug = category
                .toLowerCase()
                .replace(/[^a-z0-9\s-]/g, "")
                .replace(/\s+/g, "-")
                .replace(/-+/g, "-");
              result = slug
                ? await go(`/category/${slug}`)
                : {
                    success: false,
                    message: "category parameter is invalid",
                  };
            }
            break;
          }
          case "search_products": {
            const q = params.query as string | undefined;
            if (!q) {
              result = {
                success: false,
                message: "query parameter is required",
              };
            } else {
              result = await go(`/search?q=${encodeURIComponent(q)}`);
            }
            break;
          }
          case "change_quantity": {
            const pn = params.product_name as string | undefined;
            const qty = params.quantity as number | undefined;
            if (!pn || qty == null) {
              result = {
                success: false,
                message: "product_name and quantity are required",
              };
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
          case "navigate_to_account":
            result = await go("/account");
            break;
          case "navigate_to_orders":
            result = await go("/account/orders");
            break;
          case "navigate_to_login":
            result = await go("/login");
            break;
          case "navigate_to_register":
            result = await go("/register");
            break;
          case "navigate_to_product": {
            const sku = params.sku as string | undefined;
            if (!sku) {
              result = {
                success: false,
                message: "sku parameter is required",
              };
            } else {
              result = await go(`/product/${encodeURIComponent(sku)}`);
            }
            break;
          }
          case "navigate_to_wishlists":
            result = await go("/wishlists");
            break;
          case "navigate_to_wishlist": {
            const id = params.id as string | undefined;
            if (!id) {
              result = {
                success: false,
                message: "id parameter is required",
              };
            } else {
              result = await go(`/wishlists/${encodeURIComponent(id)}`);
            }
            break;
          }
          case "navigate_to_checkout_addresses":
            result = await go("/checkout/addresses");
            break;
          case "navigate_to_checkout_shipping":
            result = await go("/checkout/shipping");
            break;
          case "navigate_to_checkout_payment":
            result = await go("/checkout/payment");
            break;
          case "navigate_to_checkout_confirmation":
            result = await go("/checkout/confirmation");
            break;

          // ── Checkout voice tools ──
          case "checkout_set_address":
            result = await checkoutSetAddress(params);
            break;
          case "checkout_list_shipping":
            result = await checkoutListShipping();
            break;
          case "checkout_select_shipping": {
            const method = params.method_name as string | undefined;
            result = method
              ? await checkoutSelectShipping(method)
              : { success: false, message: "method_name is required" };
            break;
          }
          case "checkout_status":
            result = checkoutStatus();
            break;
          case "checkout_start":
            result = await checkoutStart();
            break;
          case "add_to_cart": {
            const pn = params.product_name as string | undefined;
            const qty = (params.quantity as number) ?? 1;
            result = pn
              ? await addToCart(pn, qty)
              : { success: false, message: "product_name is required" };
            break;
          }
          default:
            result = { success: false, message: `Unknown function: ${name}` };
        }
      } catch (err) {
        console.error(`Tool "${name}" error:`, err);
        result = { success: false, message: `Error: ${String(err)}` };
      } finally {
        processingRef.current = false;
      }

      // Send result back to Vapi so it can respond verbally
      if (vapiRef.current && callId) {
        try {
          vapiRef.current.send({
            type: "tool-calls-result",
            toolCallId: callId,
            result,
          });
        } catch (sendErr) {
          console.warn("Failed to send result to Vapi:", sendErr);
        }
      }

      return result;
    },
    [go, changeQty, getCart, clearCart, applyDiscount, checkoutSetAddress, checkoutListShipping, checkoutSelectShipping, checkoutStatus, checkoutStart, addToCart, vapiRef, processingRef],
  );

  return { cart, dispatch };
}
