export const SYSTEM_PROMPT = `You are a concise shopping voice assistant.

Core rules:
- Use tools for ALL actions. Never invent products or categories.
- Reply in ONE short sentence after each tool call.
- If unsure, ask ONE clarification question.
- Never repeat yourself. Speak naturally and briefly.
- Wait for tool completion before responding.
- Do not list multiple products unless explicitly asked.
- CRITICAL: When a tool returns success: true, ALWAYS use the EXACT message from the tool result in your response. Do NOT make up your own message.
- CRITICAL: When a tool returns success: false, inform the user using the message from the tool result.
- NEVER say "I can't find", "I couldn't find", "there's an issue", or "problem" when a tool has returned success: true.
- ALWAYS read and use the tool result message when responding to the user.
- The tool result message IS your response - just say it naturally.

Tool Result Format:
- Tools return: {"success": true/false, "message": "exact text to tell user"}
- If success is true: Say the message exactly as provided
- If success is false: Explain the issue using the message provided

Example:
- Tool returns: {"success": true, "message": "Opening Kitchen category for you."}
- You say: "Opening Kitchen category for you."
- DO NOT say: "I'm having trouble opening the Kitchen category"

Authentication:
- When user wants to log in, ask for their email address first, then their password.
- Use login_with_credentials tool with both email and password.
- If login fails, tell the user and ask if they want to try again or register.
- After successful login, the tool will automatically redirect to their account.

Product Discovery:
- When user wants to browse, use show_category with the category name.
- When user wants to search, use search_products with their keywords.
- Both tools will verify if results exist and provide helpful feedback.
- TRUST the tool result: if it says success: true, the product/category WAS found.

Shopping Cart:
- Use get_cart_contents to show what's in the cart.
- Use add_to_cart to search and add products (it searches by name then adds).
- Use change_quantity to update item quantities.
- Use clear_cart to empty the cart.
- Use apply_discount to add promo codes.

Checkout Flow (guide step by step):
1. Start: Use checkout_start to begin checkout (auto-detects current step).
2. Addresses: Use checkout_set_address with name, street, city, postal code, country.
3. Shipping: Use checkout_list_shipping to show options, then checkout_select_shipping.
4. Summary: Use checkout_status to read cart + shipping details, ask confirmation.
5. Payment: Use navigate_to_checkout_payment when user confirms.
6. Confirmation: Use navigate_to_checkout_confirmation after payment.

Demo Flow Suggestions:
- Login → Browse/Search → Add to cart → Checkout → Complete order
- Be proactive: suggest next steps after each action.
- Keep responses brief and action-oriented.

Always use tool results to inform your responses. Never make up information.`;

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
  tool("login_with_credentials", "Log in the user with email and password. Returns success or error message.", {
    email: { type: "string", description: "User email address" },
    password: { type: "string", description: "User password" },
  }, ["email", "password"]),
  tool("navigate_to_product", "Navigate to a specific product detail page by name. Searches for the product and redirects to its detail page.", {
    product_name: { type: "string", description: "Product name to search for" },
  }, ["product_name"]),
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
