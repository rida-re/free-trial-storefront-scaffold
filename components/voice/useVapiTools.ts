/* eslint-disable no-console */
"use client";

import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import { useRouter } from "@/i18n/routing";
import { usePathname } from "next/navigation";
import { useSWRConfig } from "swr";
import { useCartContext } from "@/context/CartProvider";
import { KEY_SHIPPING_METHODS } from "@/lib/cache-keys";
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
  const { cache } = useSWRConfig();

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
        await mutateCartRef.current.setAddresses(
          address,
          sameBilling ? address : undefined,
        );

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

  // ─── Shipping methods: read from SWR cache or fetch ──────────────────────

  type ShippingMethodItem = {
    id: string;
    name: string;
    description?: string;
    price: { centAmount: number; currencyCode: string };
    isDefault: boolean;
  };

  const getShippingMethods = useCallback(async (): Promise<ShippingMethodItem[]> => {
    // Read from SWR cache first (shared with StepShipping UI component)
    const swrCache = cache as Map<string, ShippingMethodItem[]>;
    for (const [key, data] of swrCache.entries()) {
      const keyStr = Array.isArray(key) ? key[0] : key;
      if (keyStr === KEY_SHIPPING_METHODS && Array.isArray(data) && data.length) {
        return data;
      }
    }
    // Fallback: fetch from API if not yet cached
    const res = await fetch("/api/shipping-methods");
    if (!res.ok) return [];
    return ((await res.json()).shippingMethods ?? []) as ShippingMethodItem[];
  }, [cache]);

  // ─── Checkout: list shipping methods ────────────────────────────────────────

  const checkoutListShipping = useCallback(async (): Promise<ToolResult> => {
    try {
      const methods = await getShippingMethods();

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
  }, [getShippingMethods]);

  // ─── Checkout: select shipping method ───────────────────────────────────────

  const checkoutSelectShipping = useCallback(
    async (methodName: string): Promise<ToolResult> => {
      try {
        // Read methods from SWR cache (shared with StepShipping UI)
        const methods = await getShippingMethods();

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

        await mutateCartRef.current.setShippingMethod(match.id);

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
    [getShippingMethods],
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
        console.log("[add_to_cart] Searching for product:", productName);
        
        // 1. Search for the product by name
        let searchRes = await fetch(
          `/api/products/search?q=${encodeURIComponent(productName)}&limit=5`,
        );
        if (!searchRes.ok) throw new Error("Search failed");
        let searchData = await searchRes.json();
        let products = searchData.products as Array<{
          id: string;
          name: string;
          masterVariantId: number;
          price: { centAmount: number; currencyCode: string } | null;
        }>;

        // If no results, try with simplified keywords (handle STT errors)
        if (!products?.length) {
          const keywords = productName
            .toLowerCase()
            .replace(/\b(the|a|an|my|your|this|that|for|with|me|show)\b/g, '')
            .trim();
          
          if (keywords && keywords !== productName.toLowerCase()) {
            console.log("[add_to_cart] Retrying with keywords:", keywords);
            searchRes = await fetch(
              `/api/products/search?q=${encodeURIComponent(keywords)}&limit=5`,
            );
            if (searchRes.ok) {
              searchData = await searchRes.json();
              products = searchData.products as Array<{
                id: string;
                name: string;
                masterVariantId: number;
                price: { centAmount: number; currencyCode: string } | null;
              }>;
            }
          }
        }

        if (!products?.length) {
          return {
            success: false,
            message: `No products found matching "${productName}". Try different keywords.`,
          };
        }

        // 2. Pick the best match (first result)
        const product = products[0];
        console.log("[add_to_cart] Found product:", product.name);

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

  // ─── Login with credentials ─────────────────────────────────────────────

  const loginWithCredentials = useCallback(
    async (email: string, password: string): Promise<ToolResult> => {
      if (!email || !password) {
        return {
          success: false,
          message: "Email and password are required.",
        };
      }

      // Basic email validation
      if (!email.includes("@") || !email.includes(".")) {
        return {
          success: false,
          message: "That doesn't look like a valid email address. Please try again.",
        };
      }

      try {
        console.log("[login] Attempting login for:", email);
        
        const response = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });

        const data = await response.json();
        console.log("[login] Response:", data);

        if (!response.ok) {
          return {
            success: false,
            message: data.error || "Login failed. Please check your email and password.",
          };
        }

        // Login successful
        const customer = data.customer;
        return {
          success: true,
          message: `Welcome back${customer.firstName ? ", " + customer.firstName : ""}! You're now logged in. Opening your account.`,
        };
      } catch (err) {
        console.error("Login failed:", err);
        return {
          success: false,
          message: "Login failed. Please try again.",
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
            result = { success: true, message: "Opening your shopping cart." };
            router.push("/cart");
            break;
          case "navigate_to_home":
            result = { success: true, message: "Going to the home page." };
            router.push("/");
            break;
          case "navigate_to_checkout":
            result = { success: true, message: "Opening checkout." };
            router.push("/checkout");
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
              
              if (!slug) {
                result = {
                  success: false,
                  message: "category parameter is invalid",
                };
              } else {
                // Fetch available categories to check if this one exists
                try {
                  const categoriesRes = await fetch("/api/categories");
                  const categoriesData = await categoriesRes.json();
                  const categories = categoriesData.categories as Array<{ id: string; name: string; slug?: string }>;
                  
                  // Check if a category with this slug exists
                  const found = categories.find(c => c.slug?.toLowerCase() === slug.toLowerCase());
                  console.log("=====================found ====================: ", found);

                  if (found) {
                    // Category exists, build success message and navigate immediately
                    result = {
                      success: true,
                      message: `Opening ${found.name} category for you.`,
                    };
                    // Trigger navigation without waiting
                    router.push(`/category/${slug}`);
                    console.log("[show_category] Navigation triggered to:", slug);
                  } else {
                    // Category doesn't exist, return list of available categories
                    const availableNames = categories
                      .filter(c => c.slug) // Only include categories that have slugs
                      .map(c => c.name)
                      .join(", ");
                    
                    result = {
                      success: false,
                      message: `I don't see a "${category}" category. Available categories are: ${availableNames || "none"}. Please try again with a different category name.`,
                    };
                  }
                } catch (err) {
                  console.error("Failed to check category:", err);
                  // If we can't check, just try to navigate anyway
                  result = await go(`/category/${slug}`);
                }
              }
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
              // First, search for products to check if any match
              try {
                console.log("[search_products] Searching for:", q);
                const searchRes = await fetch(
                  `/api/products/search?q=${encodeURIComponent(q)}&limit=5`,
                );
                const searchData = await searchRes.json();
                console.log("[search_products] API response:", searchData);
                
                const products = searchData.products as Array<{
                  id: string;
                  name: string;
                  slug?: string;
                  price?: { centAmount: number; currencyCode: string } | null;
                }>;

                console.log("[search_products] Products found:", products?.length, products);

                if (!products?.length) {
                  // No products found, suggest alternatives
                  console.log("[search_products] No products found");
                  result = {
                    success: false,
                    message: `No products found for "${q}". Try different keywords or ask me to show you our categories.`,
                  };
                } else {
                  // Products found
                  const productNames = products
                    .slice(0, 3)
                    .map((p) => p.name)
                    .join(", ");
                  
                  console.log("[search_products] Success! Found:", searchData.total, "products");
                  
                  // Build result message BEFORE navigation
                  if (searchData.total === 1) {
                    result = {
                      success: true,
                      message: `I found 1 product: ${productNames}. I'm showing it to you now.`,
                    };
                  } else {
                    result = {
                      success: true,
                      message: `I found ${searchData.total} products, including ${productNames}. Here are the results.`,
                    };
                  }
                  
                  // Trigger navigation but DON'T wait for it (return immediately so Vapi can respond)
                  router.push(`/search?q=${encodeURIComponent(q)}`);
                  console.log("[search_products] Navigation triggered");
                }
              } catch (err) {
                console.error("Failed to search products:", err);
                // If search fails, try to navigate anyway
                result = await go(`/search?q=${encodeURIComponent(q)}`);
              }
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
            result = { success: true, message: "Opening your account." };
            router.push("/account");
            break;
          case "navigate_to_orders":
            result = { success: true, message: "Opening your order history." };
            router.push("/account/orders");
            break;
          case "navigate_to_login":
            result = { success: true, message: "Opening login page." };
            router.push("/login");
            break;
          case "navigate_to_register":
            result = { success: true, message: "Opening registration page." };
            router.push("/register");
            break;
          case "navigate_to_product": {
            const productName = params.product_name as string | undefined;
            if (!productName) {
              result = {
                success: false,
                message: "product_name parameter is required",
              };
            } else {
              // Search for the product by name to find it and get its SKU
              try {
                console.log("[navigate_to_product] Searching for product:", productName);
                
                // Try exact search first
                let searchRes = await fetch(
                  `/api/products/search?q=${encodeURIComponent(productName)}&limit=5`,
                );
                let searchData = await searchRes.json();
                let products = searchData.products as Array<{
                  id: string;
                  name: string;
                  slug?: string;
                  sku?: string;
                  variants?: Array<{ sku?: string }>;
                }>;

                // If no results, try with keywords only (remove common filler words)
                if (!products?.length) {
                  const keywords = productName
                    .toLowerCase()
                    .replace(/\b(the|a|an|my|your|this|that|for|with)\b/g, '')
                    .trim();
                  
                  if (keywords !== productName.toLowerCase()) {
                    console.log("[navigate_to_product] Retrying with keywords:", keywords);
                    searchRes = await fetch(
                      `/api/products/search?q=${encodeURIComponent(keywords)}&limit=5`,
                    );
                    searchData = await searchRes.json();
                    products = searchData.products as Array<{
                      id: string;
                      name: string;
                      slug?: string;
                      sku?: string;
                      variants?: Array<{ sku?: string }>;
                    }>;
                  }
                }

                if (!products?.length) {
                  console.log("[navigate_to_product] No products found");
                  result = {
                    success: false,
                    message: `I couldn't find any product matching "${productName}". Try different keywords or ask me to show you our categories.`,
                  };
                } else {
                  // Get the first matching product
                  const foundProduct = products[0];
                  
                  // The API can return SKU in different places:
                  // 1. Directly on product.sku (simplified API response)
                  // 2. In product.variants[0].sku (full response)
                  const sku = foundProduct.sku || foundProduct.variants?.[0]?.sku;
                  
                  console.log("[navigate_to_product] Found product:", foundProduct.name);
                  console.log("[navigate_to_product] Product data:", foundProduct);
                  console.log("[navigate_to_product] Extracted SKU:", sku);
                  
                  if (!sku) {
                    result = {
                      success: false,
                      message: `Found "${foundProduct.name}" but it doesn't have a valid SKU.`,
                    };
                  } else {
                    result = {
                      success: true,
                      message: `Opening ${foundProduct.name} product details.`,
                    };
                    // Navigate using the SKU we found
                    router.push(`/product/${encodeURIComponent(sku)}`);
                    console.log("[navigate_to_product] Navigating to product with SKU:", sku);
                  }
                }
              } catch (err) {
                console.error("Failed to search product:", err);
                result = {
                  success: false,
                  message: `Failed to search for "${productName}". Please try again.`,
                };
              }
            }
            break;
          }
          case "navigate_to_wishlists":
            result = { success: true, message: "Opening your wishlists." };
            router.push("/wishlists");
            break;
          case "navigate_to_wishlist": {
            const id = params.id as string | undefined;
            if (!id) {
              result = {
                success: false,
                message: "id parameter is required",
              };
            } else {
              result = { success: true, message: "Opening your wishlist." };
              router.push(`/wishlists/${encodeURIComponent(id)}`);
            }
            break;
          }
          case "navigate_to_checkout_addresses":
            result = { success: true, message: "Opening address step." };
            router.push("/checkout/addresses");
            break;
          case "navigate_to_checkout_shipping":
            result = { success: true, message: "Opening shipping step." };
            router.push("/checkout/shipping");
            break;
          case "navigate_to_checkout_payment":
            result = { success: true, message: "Opening payment step." };
            router.push("/checkout/payment");
            break;
          case "navigate_to_checkout_confirmation":
            result = { success: true, message: "Opening order confirmation." };
            router.push("/checkout/confirmation");
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
          case "login_with_credentials": {
            const email = params.email as string | undefined;
            const password = params.password as string | undefined;
            
            if (!email || !password) {
              result = {
                success: false,
                message: "Email and password are required. Please provide both.",
              };
            } else {
              console.log("[login_with_credentials] Login attempt for:", email);
              result = await loginWithCredentials(email, password);
              
              // If login successful, navigate to account page
              if (result.success) {
                console.log("[login_with_credentials] Login successful, navigating to account");
                router.push("/account");
              }
            }
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
          console.log(`[Vapi] Sending result for tool "${name}":`, result);
          
          // Send result as JSON string - Vapi's LLM will parse and use the message
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          vapiRef.current.send({
            type: "tool-calls-result",
            toolCallId: callId,
            result: result.message
            /*result: JSON.stringify({
              success: result.success,
              message: result.message
            }) */
          } as any);
          console.log(`[Vapi] Result sent successfully`);
        } catch (sendErr) {
          console.warn("Failed to send result to Vapi:", sendErr);
        }
      }

      return result;
    },
    [go, changeQty, getCart, clearCart, applyDiscount, checkoutSetAddress, checkoutListShipping, checkoutSelectShipping, checkoutStatus, checkoutStart, addToCart, loginWithCredentials, vapiRef, processingRef, router],
  );

  return { cart, dispatch };
}
