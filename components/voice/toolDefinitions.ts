export const SYSTEM_PROMPT = `You are a shopping voice assistant with full checkout capabilities.

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
- If navigation occurs, answer only after completion.

Checkout flow:
- Guide the user step by step: addresses → shipping → payment.
- When setting an address, ask for: first name, last name, street, city, postal code, country.
- If missing info, ask one question at a time — don't overwhelm.
- After setting addresses, automatically list shipping methods and let the user pick.
- Before payment, summarize the order (items, total, shipping) and ask for confirmation.
- When the user says "confirm" or "place order", navigate to payment.
- Use checkout_status to know which step the user is on.`;

export const FIRST_MESSAGE =
  "Hi! I'm your shopping assistant. How can I help you today?";

export const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "navigate_to_cart",
      description: "Navigate to the shopping cart page",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "navigate_to_home",
      description: "Navigate to the home page",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "navigate_to_checkout",
      description: "Navigate to the checkout page",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "show_products",
      description: "Show all products on the search page",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "show_category",
      description: "Navigate to a product category by name",
      parameters: {
        type: "object",
        properties: {
          category: { type: "string", description: "Category name" },
        },
        required: ["category"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_products",
      description: "Search products by keyword and navigate to results",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search keywords" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "change_quantity",
      description: "Change the quantity of a product already in the cart",
      parameters: {
        type: "object",
        properties: {
          product_name: {
            type: "string",
            description: "Product name in cart",
          },
          quantity: { type: "number", description: "New quantity" },
        },
        required: ["product_name", "quantity"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "get_cart_contents",
      description: "List all items in the cart with prices",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "clear_cart",
      description: "Remove all items from the cart",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "apply_discount",
      description: "Apply a discount/promo code to the cart",
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "Discount code" },
        },
        required: ["code"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "navigate_to_account",
      description: "Navigate to the user account page",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "navigate_to_orders",
      description: "Navigate to the order history page",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "navigate_to_login",
      description: "Navigate to the login page",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "navigate_to_register",
      description: "Navigate to the registration page",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "navigate_to_product",
      description: "Navigate to a specific product detail page by SKU",
      parameters: {
        type: "object",
        properties: {
          sku: { type: "string", description: "Product SKU" },
        },
        required: ["sku"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "navigate_to_wishlists",
      description: "Navigate to the wishlists overview page",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "navigate_to_wishlist",
      description: "Navigate to a specific wishlist by ID",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Wishlist ID" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "navigate_to_checkout_addresses",
      description: "Navigate to the checkout addresses step",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "navigate_to_checkout_shipping",
      description: "Navigate to the checkout shipping step",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "navigate_to_checkout_payment",
      description: "Navigate to the checkout payment step",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "navigate_to_checkout_confirmation",
      description: "Navigate to the order confirmation page",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "checkout_set_address",
      description:
        "Set the shipping address for checkout. Requires first name, last name, street, city, postal code, and country code (e.g. US, GB, DE). Optionally email and phone.",
      parameters: {
        type: "object",
        properties: {
          first_name: { type: "string", description: "First name" },
          last_name: { type: "string", description: "Last name" },
          street: { type: "string", description: "Street name and number" },
          city: { type: "string", description: "City" },
          postal_code: { type: "string", description: "Postal / ZIP code" },
          country: {
            type: "string",
            description: "Country code (e.g. US, GB, DE)",
          },
          region: { type: "string", description: "State or region (required for US)" },
          email: { type: "string", description: "Contact email" },
          phone: { type: "string", description: "Contact phone" },
          same_billing: {
            type: "boolean",
            description: "Use same address for billing (default true)",
          },
        },
        required: ["first_name", "last_name", "street", "city", "postal_code", "country"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "checkout_list_shipping",
      description:
        "List all available shipping methods with prices for the current cart",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "checkout_select_shipping",
      description:
        "Select a shipping method by name (e.g. 'Standard', 'Express'). Must match one of the available methods.",
      parameters: {
        type: "object",
        properties: {
          method_name: {
            type: "string",
            description: "Shipping method name (e.g. Standard, Express)",
          },
        },
        required: ["method_name"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "checkout_status",
      description:
        "Get the current checkout status: which steps are complete, what's missing, and current cart summary",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "checkout_start",
      description:
        "Start the checkout flow. Checks the cart and navigates to the appropriate first step.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "add_to_cart",
      description:
        "Search for a product by name and add it to the cart. If multiple products match, the first result is used. Optionally specify quantity.",
      parameters: {
        type: "object",
        properties: {
          product_name: {
            type: "string",
            description: "Product name or search keywords to find the product",
          },
          quantity: {
            type: "number",
            description: "Quantity to add (default 1)",
          },
        },
        required: ["product_name"],
      },
    },
  },
];
