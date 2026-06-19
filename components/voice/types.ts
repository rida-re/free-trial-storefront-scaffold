import Vapi from "@vapi-ai/web";

export type VapiInstance = InstanceType<typeof Vapi>;

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface ToolResult {
  success: boolean;
  message: string;
  [key: string]: unknown;
}

export const NAV_TIMEOUT_MS = 4000;
