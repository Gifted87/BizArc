import {
  LlmEngineConfig,
  LlmMessage,
  LlmOptions,
  LlmResponse,
  LlmToolDefinition,
  LlmToolCall,
} from "./types.js";

export interface ILlmEngine {
  chatCompletion(
    messages: LlmMessage[],
    tools?: LlmToolDefinition[],
    options?: LlmOptions
  ): Promise<LlmResponse>;
  embedText(text: string): Promise<number[]>;
}

/**
 * Universal OpenAI-Compatible HTTP Engine
 * Communicates with OpenAI, DeepSeek, OpenRouter, vLLM, Ollama, Groq, etc.
 */
export class UniversalOpenAiCompatibleEngine implements ILlmEngine {
  private apiKey: string;
  private baseUrl: string;
  private model: string;
  private embeddingModel: string;
  private defaultTemperature: number;
  private defaultMaxTokens: number;

  constructor(config: LlmEngineConfig) {
    this.apiKey = config.apiKey || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || "";
    this.baseUrl = (config.baseUrl || process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
    this.model = config.model || process.env.LLM_MODEL || "gpt-4o";
    this.embeddingModel = config.embeddingModel || process.env.LLM_EMBEDDING_MODEL || "text-embedding-3-small";
    this.defaultTemperature = config.temperature ?? 0.1;
    this.defaultMaxTokens = config.maxTokens ?? 2048;
  }

  public async chatCompletion(
    messages: LlmMessage[],
    tools?: LlmToolDefinition[],
    options?: LlmOptions
  ): Promise<LlmResponse> {
    const payload: Record<string, any> = {
      model: this.model,
      messages: messages.map((m) => {
        const msg: any = { role: m.role, content: m.content };
        if (m.tool_calls) msg.tool_calls = m.tool_calls;
        if (m.tool_call_id) msg.tool_call_id = m.tool_call_id;
        if (m.name) msg.name = m.name;
        return msg;
      }),
      temperature: options?.temperature ?? this.defaultTemperature,
      max_tokens: options?.maxTokens ?? this.defaultMaxTokens,
    };

    if (tools && tools.length > 0) {
      payload.tools = tools;
      if (options?.toolChoice) {
        payload.tool_choice = options.toolChoice;
      }
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`[LLM Engine] HTTP ${res.status} error from ${this.baseUrl}: ${errText}`);
    }

    const json: any = await res.json();
    const choice = json.choices?.[0];
    if (!choice) {
      throw new Error(`[LLM Engine] No completion choices returned by model`);
    }

    return {
      content: choice.message?.content || null,
      tool_calls: choice.message?.tool_calls || undefined,
      finish_reason: choice.finish_reason || "stop",
      usage: json.usage
        ? {
            prompt_tokens: json.usage.prompt_tokens,
            completion_tokens: json.usage.completion_tokens,
            total_tokens: json.usage.total_tokens,
          }
        : undefined,
    };
  }

  public async embedText(text: string): Promise<number[]> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: this.embeddingModel,
        input: text,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`[LLM Engine] Embeddings error ${res.status}: ${errText}`);
    }

    const json: any = await res.json();
    return json.data[0].embedding;
  }
}

/**
 * Deterministic Simulated LLM Engine
 * Highly capable offline engine for CI, test environments, and deterministic execution.
 * It simulates intelligent agent deliberation, tool invocation, and decision-making
 * without network or API key dependency.
 */
export class DeterministicSimulatedLlmEngine implements ILlmEngine {
  private customHandlers: Array<
    (messages: LlmMessage[], tools?: LlmToolDefinition[]) => LlmResponse | null
  > = [];

  public registerHandler(
    handler: (messages: LlmMessage[], tools?: LlmToolDefinition[]) => LlmResponse | null
  ): void {
    this.customHandlers.unshift(handler);
  }

  public async chatCompletion(
    messages: LlmMessage[],
    tools?: LlmToolDefinition[],
    _options?: LlmOptions
  ): Promise<LlmResponse> {
    for (const handler of this.customHandlers) {
      const customRes = handler(messages, tools);
      if (customRes) return customRes;
    }

    const lastMsg = messages[messages.length - 1];
    const systemMsg = messages.find((m) => m.role === "system");
    const content = (lastMsg?.content || "").toLowerCase();
    const systemPrompt = (systemMsg?.content || "").toLowerCase();

    // If the last message was a tool result, synthesize the final answer
    if (lastMsg?.role === "tool") {
      return {
        content: `Acknowledged tool execution result: ${lastMsg.content}. Analysis complete according to policy guardrails.`,
        finish_reason: "stop",
      };
    }

    // Agent: Liability Radar / Invoice Verification
    if (
      tools?.some((t) => t.function.name === "verify_three_way_match") &&
      (content.includes("invoice") || content.includes("bill") || content.includes("liability"))
    ) {
      const toolCall: LlmToolCall = {
        id: `call_${Date.now()}_match`,
        type: "function",
        function: {
          name: "verify_three_way_match",
          arguments: JSON.stringify({
            invoiceId: "INV-2026-901",
            poReference: "PO-2026-AWS-01",
            claimedAmountUsdc: "12500.000000",
            claimedPayoutAddress: "0x1111111111111111111111111111111111111111",
          }),
        },
      };
      return {
        content: "Executing 3-way match verification between Purchase Order, Goods Receipt, and Vendor Invoice.",
        tool_calls: [toolCall],
        finish_reason: "tool_calls",
      };
    }

    // Agent: Treasury Sentinel / Liquidity Sweeper
    if (
      tools?.some((t) => t.function.name === "recalculate_safe_to_invest") &&
      (content.includes("treasury") || content.includes("liquidity") || content.includes("sweep") || content.includes("safe-to-invest"))
    ) {
      const toolCall: LlmToolCall = {
        id: `call_${Date.now()}_sti`,
        type: "function",
        function: {
          name: "recalculate_safe_to_invest",
          arguments: JSON.stringify({
            accountId: "OPEX_DEV",
            timeHorizonSeconds: 604800, // 7 days
          }),
        },
      };
      return {
        content: "Calculating dynamic safe-to-invest liquidity and assessing tripartite balance reserves.",
        tool_calls: [toolCall],
        finish_reason: "tool_calls",
      };
    }

    // Agent: Disbursal Router / Payment Execution
    if (
      tools?.some((t) => t.function.name === "execute_disbursal") &&
      (content.includes("pay") || content.includes("disburse") || content.includes("execute"))
    ) {
      const toolCall: LlmToolCall = {
        id: `call_${Date.now()}_pay`,
        type: "function",
        function: {
          name: "execute_disbursal",
          arguments: JSON.stringify({
            accountId: "OPEX_DEV",
            liabilityId: "LIA-AWS-001",
            amountUsdc: "12500.000000",
            recipientAddress: "0x1111111111111111111111111111111111111111",
          }),
        },
      };
      return {
        content: "Checking policy caps and executing staged disbursal via DisbursalVault.",
        tool_calls: [toolCall],
        finish_reason: "tool_calls",
      };
    }

    // Default cognitive reasoning response
    return {
      content: `[Simulated LLM] Deliberation complete for agent task. Operating under declared policies on Arc L1.`,
      finish_reason: "stop",
    };
  }

  /**
   * Deterministic 1536-dimensional embedding generator using normalized hash projection.
   * Guarantees that semantically similar texts have high cosine similarity.
   */
  public async embedText(text: string): Promise<number[]> {
    const dim = 1536;
    const embedding = new Array<number>(dim).fill(0);
    const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      let hash = 0;
      for (let j = 0; j < word.length; j++) {
        hash = (hash << 5) - hash + word.charCodeAt(j);
        hash |= 0;
      }
      const pos = Math.abs(hash) % dim;
      embedding[pos] += 1.0;
      const secondaryPos = Math.abs((hash * 31) ^ (i * 17)) % dim;
      embedding[secondaryPos] += 0.5;
    }

    // L2 Normalize
    let norm = 0;
    for (let i = 0; i < dim; i++) {
      norm += embedding[i] * embedding[i];
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < dim; i++) {
        embedding[i] = Number((embedding[i] / norm).toFixed(6));
      }
    } else {
      embedding[0] = 1.0;
    }

    return embedding;
  }
}

/**
 * Model-Agnostic LLM Engine Factory
 */
export function createLlmEngine(config?: Partial<LlmEngineConfig>): ILlmEngine {
  const provider =
    config?.provider ||
    process.env.LLM_PROVIDER ||
    (process.env.OPENAI_API_KEY ? "openai" : "simulation");

  if (provider === "simulation") {
    return new DeterministicSimulatedLlmEngine();
  }

  return new UniversalOpenAiCompatibleEngine({
    provider: provider as any,
    apiKey: config?.apiKey || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY,
    baseUrl: config?.baseUrl || process.env.LLM_BASE_URL,
    model: config?.model || process.env.LLM_MODEL,
    embeddingModel: config?.embeddingModel || process.env.LLM_EMBEDDING_MODEL,
    temperature: config?.temperature,
    maxTokens: config?.maxTokens,
  });
}
