export type LlmRole = "system" | "user" | "assistant" | "tool";

export interface LlmToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON stringified arguments
  };
}

export interface LlmMessage {
  role: LlmRole;
  content: string | null;
  tool_calls?: LlmToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface LlmToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, any>;
      required?: string[];
    };
  };
}

export interface LlmResponse {
  content: string | null;
  tool_calls?: LlmToolCall[];
  finish_reason: "stop" | "tool_calls" | "length" | "error";
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface LlmOptions {
  temperature?: number;
  maxTokens?: number;
  toolChoice?: "auto" | "none" | "required" | { type: "function"; function: { name: string } };
}

export interface LlmEngineConfig {
  provider: "openai" | "gemini" | "anthropic" | "ollama" | "deepseek" | "simulation";
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  embeddingModel?: string;
  temperature?: number;
  maxTokens?: number;
}
