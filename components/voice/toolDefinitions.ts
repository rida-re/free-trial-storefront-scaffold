export const SYSTEM_PROMPT = `You are a concise shopping voice assistant.

Core rules:
- Use tools for ALL actions. Never invent products or categories.
- Reply in ONE short sentence after each tool call.
- If unsure, ask ONE clarification question.
- Never repeat yourself. Speak naturally and briefly.
- Wait for tool completion before responding.
- Do not list multiple products unless explicitly asked.

Checkout flow (guide step by step):
1. Addresses: ask for name, street, city, postal code, country.
2. Shipping: list methods, let user pick one.
3. Summary: read items + total + shipping, ask confirmation.
4. Payment: navigate to payment on "confirm" or "place order".
Use checkout_status to track progress.`;

export const FIRST_MESSAGE =
  "Hi! I'm your shopping assistant. How can I help you today?";

/* ── helper to preserve per-tool literal types ─────────────────────────── */
interface ToolParam {
  type: "string" | "number" | "boolean";
  description: string;
}

interface FunctionToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, ToolParam>;
      required?: string[];
    };
  };
}

function tool<
  N extends string,
  P extends Record<string, ToolParam>,
  R extends (keyof P & string)[],
>(name: N, description: string, properties: P, required?: R): FunctionToolDef {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: { type: "object", properties, ...(required ? { required } : {}) },
    },
  };
}

export const TOOLS: FunctionToolDef[] = [
  tool("navigate_to_cart", "Navigate to the shopping cart page", {}),
  tool("navigate_to_home", "Navigate to the home page", {}),
  tool("navigate_to_checkout", "Navigate to the checkout page", {}),
  tool("show_products", "Show all products on the search page", {}),
  tool("show_category", "Navigate to a product category by name", {
    category: { type: "string", description: "Category name" },
  }, ["category"]),
  tool("search_products", "Search products by keyword and navigate to results", {
    query: { type: "string", description: "Search keywords" },
  }, ["query"]),
  tool("change_quantity", "Change the quantity of a product already in the cart", {
    product_name: { type: "string", description: "Product name in cart" },
    quantity: { type: "number", description: "New quantity" },
  }, ["product_name", "quantity"]),
  tool("get_cart_contents", "List all items in the cart with prices", {}),
  tool("clear_cart", "Remove all items from the cart", {}),
  tool("apply_discount", "Apply a discount/promo code to the cart", {
    code: { type: "string", description: "Discount code" },
  }, ["code"]),
  tool("navigate_to_account", "Navigate to the user account page", {}),
  tool("navigate_to_orders", "Navigate to the order history page", {}),
  tool("navigate_to_login", "Navigate to the login page", {}),
  tool("navigate_to_register", "Navigate to the registration page", {}),
  tool("navigate_to_product", "Navigate to a specific product detail page by SKU", {
    sku: { type: "string", description: "Product SKU" },
  }, ["sku"]),
  tool("navigate_to_wishlists", "Navigate to the wishlists overview page", {}),
  tool("navigate_to_wishlist", "Navigate to a specific wishlist by ID", {
    id: { type: "string", description: "Wishlist ID" },
  }, ["id"]),
  tool("navigate_to_checkout_addresses", "Navigate to the checkout addresses step", {}),
  tool("navigate_to_checkout_shipping", "Navigate to the checkout shipping step", {}),
  tool("navigate_to_checkout_payment", "Navigate to the checkout payment step", {}),
  tool("navigate_to_checkout_confirmation", "Navigate to the order confirmation page", {}),
  tool(
    "checkout_set_address",
    "Set the shipping address for checkout. Requires first name, last name, street, city, postal code, and country code (e.g. US, GB, DE). Optionally email and phone.",
    {
      first_name: { type: "string", description: "First name" },
      last_name: { type: "string", description: "Last name" },
      street: { type: "string", description: "Street name and number" },
      city: { type: "string", description: "City" },
      postal_code: { type: "string", description: "Postal / ZIP code" },
      country: { type: "string", description: "Country code (e.g. US, GB, DE)" },
      region: { type: "string", description: "State or region (required for US)" },
      email: { type: "string", description: "Contact email" },
      phone: { type: "string", description: "Contact phone" },
      same_billing: { type: "boolean", description: "Use same address for billing (default true)" },
    },
    ["first_name", "last_name", "street", "city", "postal_code", "country"],
  ),
  tool("checkout_list_shipping", "List all available shipping methods with prices for the current cart", {}),
  tool("checkout_select_shipping", "Select a shipping method by name (e.g. 'Standard', 'Express'). Must match one of the available methods.", {
    method_name: { type: "string", description: "Shipping method name (e.g. Standard, Express)" },
  }, ["method_name"]),
  tool("checkout_status", "Get the current checkout status: which steps are complete, what's missing, and current cart summary", {}),
  tool("checkout_start", "Start the checkout flow. Checks the cart and navigates to the appropriate first step.", {}),
  tool("add_to_cart", "Search for a product by name and add it to the cart. If multiple products match, the first result is used. Optionally specify quantity.", {
    product_name: { type: "string", description: "Product name or search keywords to find the product" },
    quantity: { type: "number", description: "Quantity to add (default 1)" },
  }, ["product_name"]),
];
