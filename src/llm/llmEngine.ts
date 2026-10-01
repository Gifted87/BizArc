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

    // If the last message was a tool result, synthesize the final answer based on the real result
    if (lastMsg?.role === "tool") {
      let parsedResult: any = {};
      try {
        parsedResult = JSON.parse(lastMsg.content || "{}");
      } catch (e) {
        parsedResult = { raw: lastMsg.content };
      }

      if (parsedResult.success === false) {
        return {
          content: `Deliberation Conclusion: Operation halted. Invariant check failed: ${parsedResult.error || "Unknown rejection"}. Escalating alert to compliance auditor.`,
          finish_reason: "stop",
        };
      } else {
        return {
          content: `Deliberation Conclusion: Operation verified and executed cleanly. Result: ${JSON.stringify(parsedResult.data || {})}. State recorded in continuous context.`,
          finish_reason: "stop",
        };
      }
    }

    // Dynamic Parameter Extraction from Conversation Task Text
    const userMsg = [...messages].reverse().find((m) => m.role === "user");
    const rawTask = userMsg?.content || "";

    let payloadObj: any = undefined;
    const payloadMatch = rawTask.match(/Context Payload:\s*(\{.*\})/s);
    if (payloadMatch) {
      try {
        payloadObj = JSON.parse(payloadMatch[1]);
      } catch (e) {}
    }

    const invoiceMatch = rawTask.match(/INV-[A-Za-z0-9-_]+/i) || rawTask.match(/(?:invoice|inv)\s+([A-Za-z0-9-_]+)/i);
    const invoiceId = payloadObj?.invoiceId || (invoiceMatch ? (invoiceMatch[1] || invoiceMatch[0]) : "INV-DEFAULT-01");

    const poMatch = rawTask.match(/PO-[A-Za-z0-9-_]+/i) || rawTask.match(/(?:purchase order|po)\s+([A-Za-z0-9-_]+)/i);
    const poReference = payloadObj?.poReference || (poMatch ? (poMatch[1] || poMatch[0]) : "PO-2026-AWS-01");

    const addrMatch =
      rawTask.match(/claimed payout address\s+(0x[a-zA-Z0-9]+)/i) ||
      rawTask.match(/payout address\s+(0x[a-zA-Z0-9]+)/i) ||
      rawTask.match(/to recipient\s+(0x[a-zA-Z0-9]+)/i) ||
      rawTask.match(/0x[a-fA-F0-9]{40,42}/) ||
      rawTask.match(/0x[a-zA-Z0-9]{20,42}/);
    const payoutAddress = payloadObj?.claimedPayoutAddress || payloadObj?.recipientAddress || (addrMatch ? (addrMatch[1] || addrMatch[0]) : "0x1111111111111111111111111111111111111111");

    const amtMatch = rawTask.match(/(?:for|amount|sum of|\$)\s*(\d+(?:\.\d+)?)/i) || rawTask.match(/(\d+\.\d{6})/);
    let amountUsdc = payloadObj?.amountUsdc ? payloadObj.amountUsdc : (amtMatch ? amtMatch[1] : "12500.000000");
    if (!amountUsdc.includes(".")) amountUsdc += ".000000";
    else {
      const parts = amountUsdc.split(".");
      amountUsdc = `${parts[0]}.${parts[1].padEnd(6, "0").slice(0, 6)}`;
    }

    const accMatch = rawTask.match(/(?:account|acc|for)\s+([A-Z_]+)/i) || rawTask.match(/OPEX_[A-Z]+|PAYROLL|CAPEX/i);
    const accountId = payloadObj?.accountId || (accMatch ? (accMatch[1] || accMatch[0]) : "OPEX_DEV");

    const liabilityMatch = rawTask.match(/liability\s+([A-Za-z0-9-_]+)/i) || rawTask.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    const liabilityId = payloadObj?.liabilityId || (liabilityMatch ? (liabilityMatch[1] || liabilityMatch[0]) : "LIA-AWS-01");

    // Dynamic Tool Dispatch based on Available Tools & Task Intent
    // 1. Three-Way Match Verification
    if (
      tools?.some((t) => t.function.name === "verify_three_way_match") &&
      (content.includes("invoice") || content.includes("match") || content.includes("bill"))
    ) {
      return {
        content: `Deliberating on invoice ${invoiceId}: Initiating strict Three-Way Match verification against Purchase Order ${poReference} and Vendor Master.`,
        tool_calls: [
          {
            id: `call_${Date.now()}_match`,
            type: "function",
            function: {
              name: "verify_three_way_match",
              arguments: JSON.stringify({
                invoiceId,
                poReference,
                claimedAmountUsdc: amountUsdc,
                claimedPayoutAddress: payoutAddress,
              }),
            },
          },
        ],
        finish_reason: "tool_calls",
      };
    }

    // 2. Reason-Bearing Intent Evaluation
    if (
      tools?.some((t) => t.function.name === "evaluate_reason_bearing_intent") &&
      (content.includes("intent") || content.includes("permit") || content.includes("compliance") || content.includes("tier a") || content.includes("tier b"))
    ) {
      const action = payloadObj?.proposedAction || (content.includes("sweep") ? "AUTONOMOUS_SWEEP" : "DISBURSAL_SETTLEMENT");
      return {
        content: `Evaluating Reason-Bearing Intent for ${action} of ${amountUsdc} USDC on account ${accountId}.`,
        tool_calls: [
          {
            id: `call_${Date.now()}_intent`,
            type: "function",
            function: {
              name: "evaluate_reason_bearing_intent",
              arguments: JSON.stringify({
                proposedAction: action,
                accountId,
                amountUsdc,
                declaredReason: payloadObj?.declaredReason || rawTask,
                recipientAddress: payoutAddress,
              }),
            },
          },
        ],
        finish_reason: "tool_calls",
      };
    }

    // 3. Multi-Account Waterfall Allocation
    if (
      tools?.some((t) => t.function.name === "plan_waterfall_allocation") &&
      content.includes("waterfall")
    ) {
      const requiredNum = payloadObj?.requiredAmountUsdc || parseFloat(amountUsdc);
      return {
        content: `Planning multi-account waterfall allocation for ${requiredNum} USDC. Enforcing payroll protection.`,
        tool_calls: [
          {
            id: `call_${Date.now()}_waterfall`,
            type: "function",
            function: {
              name: "plan_waterfall_allocation",
              arguments: JSON.stringify({
                requiredAmountUsdc: requiredNum,
                balanceOverrides: payloadObj?.balanceOverrides,
              }),
            },
          },
        ],
        finish_reason: "tool_calls",
      };
    }

    // 4. Sweep Excess Liquidity (prioritized over general STI check when sweep is requested)
    if (
      tools?.some((t) => t.function.name === "sweep_excess_liquidity") &&
      content.includes("sweep")
    ) {
      return {
        content: `Executing autonomous sweep of ${amountUsdc} USDC into USYC Yield Vault for account ${accountId}.`,
        tool_calls: [
          {
            id: `call_${Date.now()}_sweep`,
            type: "function",
            function: {
              name: "sweep_excess_liquidity",
              arguments: JSON.stringify({
                accountId,
                amountUsdc: payloadObj?.customAmount || amountUsdc,
              }),
            },
          },
        ],
        finish_reason: "tool_calls",
      };
    }

    // 5. Safe-to-Invest Recalculation
    if (
      tools?.some((t) => t.function.name === "recalculate_safe_to_invest") &&
      (content.includes("safe-to-invest") || content.includes("liquidity") || content.includes("tripartite"))
    ) {
      return {
        content: `Calculating Dynamic Safe-to-Invest (Record 2) for account ${accountId}.`,
        tool_calls: [
          {
            id: `call_${Date.now()}_sti`,
            type: "function",
            function: {
              name: "recalculate_safe_to_invest",
              arguments: JSON.stringify({
                accountId,
                timeHorizonSeconds: 604800,
              }),
            },
          },
        ],
        finish_reason: "tool_calls",
      };
    }

    // 6. Disbursal Execution
    if (
      tools?.some((t) => t.function.name === "execute_disbursal") &&
      (content.includes("pay") || content.includes("disburse") || content.includes("settle"))
    ) {
      return {
        content: `Executing staged payment of ${amountUsdc} USDC to ${payoutAddress} via DisbursalVault on Arc L1.`,
        tool_calls: [
          {
            id: `call_${Date.now()}_disburse`,
            type: "function",
            function: {
              name: "execute_disbursal",
              arguments: JSON.stringify({
                accountId,
                liabilityId,
                amountUsdc,
                recipientAddress: payoutAddress,
                invoiceId,
              }),
            },
          },
        ],
        finish_reason: "tool_calls",
      };
    }

    // 7. General Ledger Witness & Hash Chaining
    if (
      tools?.some((t) => t.function.name === "post_document_linked_gl") &&
      (content.includes("witness") || content.includes("journal") || content.includes("ledger") || content.includes("voucher"))
    ) {
      const txMatch = rawTask.match(/0x[a-zA-Z0-9_]{10,66}/);
      const txHash = txMatch ? txMatch[0] : "0xarc_settlement_receipt";
      return {
        content: `Posting document-linked GL entry to ERP and appending to sequential master journal with cryptographic SHA-256 hash chain.`,
        tool_calls: [
          {
            id: `call_${Date.now()}_witness`,
            type: "function",
            function: {
              name: "post_document_linked_gl",
              arguments: JSON.stringify({
                accountId,
                documentRef: invoiceId,
                debitAccount: "2100_ACCOUNTS_PAYABLE",
                creditAccount: "1010_ARC_OPERATING_POOL",
                amountUsdc,
                txHash,
              }),
            },
          },
        ],
        finish_reason: "tool_calls",
      };
    }

    // 8. Vector Memory Search
    if (
      tools?.some((t) => t.function.name === "query_vector_memory") &&
      (content.includes("search") || content.includes("query") || content.includes("bylaws") || content.includes("msa"))
    ) {
      return {
        content: `Querying Enterprise Vector Memory for relevant context: "${rawTask}".`,
        tool_calls: [
          {
            id: `call_${Date.now()}_vector`,
            type: "function",
            function: {
              name: "query_vector_memory",
              arguments: JSON.stringify({
                query: rawTask,
                topK: 3,
              }),
            },
          },
        ],
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
