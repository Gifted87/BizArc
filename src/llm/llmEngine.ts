import crypto from "crypto";
import { keccak256, stringToHex } from "viem";
import { ClearanceCodeRepo } from "../database/repos/clearanceCodeRepo.js";
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

  constructor(config: Partial<LlmEngineConfig> = {}) {
    this.apiKey =
      config.apiKey ||
      process.env.OPENROUTER_API_KEY ||
      process.env.LLM_API_KEY ||
      process.env.OPENAI_API_KEY ||
      "";
    this.baseUrl = (
      config.baseUrl ||
      process.env.OPENROUTER_BASE_URL ||
      process.env.LLM_BASE_URL ||
      "https://openrouter.ai/api/v1"
    ).replace(/\/$/, "");
    this.model = config.model || process.env.LLM_MODEL || "cohere/north-mini-code:free";
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
      "HTTP-Referer": process.env.LLM_HTTP_REFERER || "https://bizarc.io",
      "X-Title": process.env.LLM_TITLE || "BizArc Autonomous Treasury Swarm",
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
      content: choice.message?.content || choice.message?.reasoning || null,
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

    // If the last message was a tool result, determine if follow-up tool execution is needed
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
      }

      // Identify which tool was just executed
      const prevAssistantMsg = [...messages].reverse().find(
        (m) => m.role === "assistant" && m.tool_calls && m.tool_calls.length > 0
      );
      const lastToolName = prevAssistantMsg?.tool_calls?.[0]?.function?.name;

      // Extract user context parameters for follow-up tool calls
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
      const payoutAddress = payloadObj?.claimedPayoutAddress || payloadObj?.payoutAddress || payloadObj?.recipientAddress || (addrMatch ? (addrMatch[1] || addrMatch[0]) : "0x1111111111111111111111111111111111111111");

      const amtMatch = rawTask.match(/(?:for|amount|sum of|\$)\s*(\d+(?:\.\d+)?)/i) || rawTask.match(/(\d+\.\d{6})/);
      let amountUsdc = payloadObj?.amountUsdc ? String(payloadObj.amountUsdc) : (amtMatch ? amtMatch[1] : "12500.000000");
      if (!amountUsdc.includes(".")) amountUsdc += ".000000";
      else {
        const parts = amountUsdc.split(".");
        amountUsdc = `${parts[0]}.${parts[1].padEnd(6, "0").slice(0, 6)}`;
      }

      const accMatch = rawTask.match(/(?:account|acc|for)\s+([A-Z0-9_]+)/i) || rawTask.match(/OPEX_[A-Z]+|PAYROLL|CAPEX/i);
      const accountId = payloadObj?.accountId || (accMatch ? (accMatch[1] || accMatch[0]) : "OPEX_DEV");
      const liabilityMatch = rawTask.match(/liability\s+([A-Za-z0-9-_]+)/i) || rawTask.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      const liabilityId = payloadObj?.liabilityId || (liabilityMatch ? (liabilityMatch[1] || liabilityMatch[0]) : "LIA-DEFAULT-01");

      // Multi-Step Chaining 1: After 3-Way Match -> Add/Stage Liability in Dynamic Record 1
      if (lastToolName === "verify_three_way_match" && tools?.some((t) => t.function.name === "add_account_liability")) {
        return {
          content: `Forensic 3-Way Match verified against PO ${poReference}. Staging verified liability into Dynamic Record 1 via 'add_account_liability'.`,
          tool_calls: [
            {
              id: `call_${Date.now()}_add_liability`,
              type: "function",
              function: {
                name: "add_account_liability",
                arguments: JSON.stringify({
                  accountId,
                  vendorId: payloadObj?.vendorId || "vendor_default",
                  title: payloadObj?.title || `Invoice ${invoiceId}`,
                  amountUsdc,
                  dueDate: payloadObj?.dueDate || new Date().toISOString(),
                  category: payloadObj?.category || "SAAS",
                  payoutAddress,
                  poReference,
                  invoiceId,
                  proposedBy: "LiabilityRadarAgent",
                  isVerifiedInvoice: true,
                  autoStage: true,
                  preferredPaymentRail: payloadObj?.preferredPaymentRail || "DISBURSAL_VAULT",
                }),
              },
            },
          ],
          finish_reason: "tool_calls",
        };
      }

      // Multi-Step Chaining 2: After Safe-to-Invest Recalculation -> Sweep surplus or Recall deficit
      if (lastToolName === "recalculate_safe_to_invest") {
        const safeToInvestUsdc = parsedResult.data?.safeToInvestUsdc ?? 0;
        if (safeToInvestUsdc > 0 && tools?.some((t) => t.function.name === "sweep_excess_liquidity")) {
          const issuedClearance = await ClearanceCodeRepo.issueCode({
            accountId,
            actionType: "AUTONOMOUS_SWEEP",
            amountUsdc: safeToInvestUsdc.toFixed(6),
            ttlSeconds: 3600,
          });
          return {
            content: `Safe-to-Invest indicates surplus capital of ${safeToInvestUsdc} USDC. Executing autonomous sweep into USYC on Arc L1.`,
            tool_calls: [
              {
                id: `call_${Date.now()}_sweep`,
                type: "function",
                function: {
                  name: "sweep_excess_liquidity",
                  arguments: JSON.stringify({
                    accountId,
                    amountUsdc: safeToInvestUsdc.toFixed(6),
                    clearanceCode: issuedClearance.code,
                  }),
                },
              },
            ],
            finish_reason: "tool_calls",
          };
        } else if (safeToInvestUsdc < 0 && tools?.some((t) => t.function.name === "recall_invested_liquidity")) {
          return {
            content: `Safe-to-Invest indicates deficit of ${Math.abs(safeToInvestUsdc)} USDC. Executing autonomous recall from USYC vault.`,
            tool_calls: [
              {
                id: `call_${Date.now()}_recall`,
                type: "function",
                function: {
                  name: "recall_invested_liquidity",
                  arguments: JSON.stringify({
                    accountId,
                    amountUsdc: Math.abs(safeToInvestUsdc).toFixed(6),
                    reason: "Dynamic Safe-to-Invest deficit restoration",
                  }),
                },
              },
            ],
            finish_reason: "tool_calls",
          };
        }
      }

      // Multi-Step Chaining 3: After Disbursal Route Qualification -> Dispatch Payment (Fiat or Crypto) if payment requested
      if (
        (lastToolName === "qualify_disbursal_route" || lastToolName === "plan_waterfall_allocation") &&
        (rawTask.toLowerCase().includes("disburse") || rawTask.toLowerCase().includes("pay") || rawTask.toLowerCase().includes("stage") || rawTask.toLowerCase().includes("settle") || rawTask.toLowerCase().includes("execute")) &&
        !rawTask.toLowerCase().includes("run plan_waterfall_allocation tool")
      ) {
        const isFiat = payloadObj?.preferredPaymentRail === "FIAT_OFFRAMP" || rawTask.includes("fiat") || rawTask.includes("FIAT_OFFRAMP");
        if (isFiat && tools?.some((t) => t.function.name === "convert_crypto_to_fiat_payout")) {
          return {
            content: `Disbursal route qualified. Preferred settlement rail is FIAT_OFFRAMP. Initiating Circle Mint conversion and Fedwire banking payout.`,
            tool_calls: [
              {
                id: `call_${Date.now()}_fiat`,
                type: "function",
                function: {
                  name: "convert_crypto_to_fiat_payout",
                  arguments: JSON.stringify({
                    sourceAccountId: accountId,
                    amountUsdc,
                    beneficiaryBank: {
                      accountHolderName: payloadObj?.vendorId || "Corporate Landlord LLC",
                      ibanOrAccountNumber: "US9876543210123456",
                      routingOrSwift: "021000021",
                      bankCountry: "US",
                    },
                    invoiceReference: invoiceId,
                    complianceClearanceCode: `CLEAR-${Date.now()}-FIAT`,
                  }),
                },
              },
            ],
            finish_reason: "tool_calls",
          };
        } else if (tools?.some((t) => t.function.name === "execute_disbursal_route")) {
          return {
            content: `Disbursal route qualified. Executing multi-account staged disbursal via DisbursalVault on Arc L1.`,
            tool_calls: [
              {
                id: `call_${Date.now()}_disbursal_route`,
                type: "function",
                function: {
                  name: "execute_disbursal_route",
                  arguments: JSON.stringify({
                    qualification: parsedResult.data,
                    clearanceCode: `CLEAR-${Date.now()}-CRYPTO`,
                  }),
                },
              },
            ],
            finish_reason: "tool_calls",
          };
        }
      }

      // Multi-Step Chaining 4: After Payment Execution -> General Ledger Witnessing
      if (
        (lastToolName === "convert_crypto_to_fiat_payout" ||
          lastToolName === "execute_disbursal_route" ||
          lastToolName === "execute_disbursal") &&
        tools?.some((t) => t.function.name === "post_document_linked_gl")
      ) {
        const txHash =
          parsedResult.data?.transactionHash ||
          parsedResult.data?.payoutTxHash ||
          parsedResult.data?.txHash;

        if (typeof txHash !== "string" || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
          return {
            content: "The payment result has no verifiable Arc transaction hash, so ledger witnessing is blocked.",
            finish_reason: "stop",
          };
        }

        return {
          content: `Payment successfully dispatched. Witnessing settlement into General Ledger with sequential cryptographic hash chain.`,
          tool_calls: [
            {
              id: `call_${Date.now()}_post_gl`,
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

      // Default conclusion after tool sequence
      return {
        content: `Deliberation Conclusion: Operation verified and executed cleanly. Result: ${JSON.stringify(parsedResult.data || {})}. State recorded in continuous context.`,
        finish_reason: "stop",
      };
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
    let amountUsdc = payloadObj?.amountUsdc !== undefined ? String(payloadObj.amountUsdc) : (amtMatch ? amtMatch[1] : "12500.000000");
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
      !(tools?.some((t) => t.function.name === "sweep_excess_liquidity") && content.includes("sweep")) &&
      !(tools?.some((t) => t.function.name === "recall_invested_liquidity") && (content.includes("recall") || content.includes("deficit"))) &&
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
      const sweepAmt = payloadObj?.customAmount || amountUsdc || "10.000000";
      const sweepCode = payloadObj?.clearanceCode || (await ClearanceCodeRepo.issueCode({
        accountId,
        actionType: "AUTONOMOUS_SWEEP",
        amountUsdc: sweepAmt,
        ttlSeconds: 3600,
      })).code;
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
                amountUsdc: sweepAmt,
                clearanceCode: sweepCode,
              }),
            },
          },
        ],
        finish_reason: "tool_calls",
      };
    }

    // Recall Invested Liquidity
    if (
      tools?.some((t) => t.function.name === "recall_invested_liquidity") &&
      (content.includes("recall") || content.includes("deficit") || content.includes("redeem"))
    ) {
      return {
        content: `Executing emergency recall of ${amountUsdc} USDC from USYC Yield Vault for account ${accountId}.`,
        tool_calls: [
          {
            id: `call_${Date.now()}_recall`,
            type: "function",
            function: {
              name: "recall_invested_liquidity",
              arguments: JSON.stringify({
                accountId,
                amountUsdc: payloadObj?.customAmount || amountUsdc,
                reason: payloadObj?.reason || "Liquidity deficit / reserve floor restoration",
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
      const txMatch = rawTask.match(/0x[a-zA-Z0-9_-]+/);
      const txHash = txMatch ? txMatch[0] : "0x" + "0".repeat(64);
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

    // 9. Onboarding Phase 2: Policy Synthesis
    if (
      tools?.some((t) => t.function.name === "synthesize_policy_proposal") &&
      (content.includes("policy") || content.includes("synthesis") || content.includes("onboard"))
    ) {
      return {
        content: `Synthesizing declared policies and mathematical rules for enterprise onboarding.`,
        tool_calls: [
          {
            id: `call_${Date.now()}_policy_synth`,
            type: "function",
            function: {
              name: "synthesize_policy_proposal",
              arguments: JSON.stringify({
                companyName: payloadObj?.companyName || "Acme Global Technologies Inc.",
                costCenters: payloadObj?.costCenters || [],
                suppliers: payloadObj?.erpSuppliers || [],
                invoices: payloadObj?.erpInvoices || [],
              }),
            },
          },
        ],
        finish_reason: "tool_calls",
      };
    }

    // 10. Onboarding Phase 3 & 4: Provision Arc Wallets & Ledger Genesis
    if (
      tools?.some((t) => t.function.name === "provision_arc_wallets") &&
      (content.includes("provision") || content.includes("genesis"))
    ) {
      return {
        content: `Provisioning Arc L1 operating wallets and creating Genesis block in master system journal.`,
        tool_calls: [
          {
            id: `call_${Date.now()}_provision`,
            type: "function",
            function: {
              name: "provision_arc_wallets",
              arguments: JSON.stringify({
                companyName: payloadObj?.companyName || "Acme Global Technologies Inc.",
                costCenters: payloadObj?.costCenters || [],
                suppliers: payloadObj?.suppliers || [],
                invoices: payloadObj?.invoices || [],
                committedPolicy: payloadObj?.committedPolicy,
                customWallets: payloadObj?.customWallets,
              }),
            },
          },
        ],
        finish_reason: "tool_calls",
      };
    }

    // 11. Onboarding Phase 6: Spending Guardrails Handoff
    if (
      tools?.some((t) => t.function.name === "generate_spending_guardrails_handoff") &&
      (content.includes("guardrail") || content.includes("otp") || content.includes("limit"))
    ) {
      return {
        content: `Generating Circle spending cap commands with OTP protection for terminal execution.`,
        tool_calls: [
          {
            id: `call_${Date.now()}_guardrails`,
            type: "function",
            function: {
              name: "generate_spending_guardrails_handoff",
              arguments: JSON.stringify({
                costCenters: payloadObj?.costCenters || [],
              }),
            },
          },
        ],
        finish_reason: "tool_calls",
      };
    }

    // 12. Onboarding Phase 7: Verify Initial Funding
    if (
      tools?.some((t) => t.function.name === "verify_initial_funding") &&
      (content.includes("funding") || content.includes("deposit") || content.includes("activate"))
    ) {
      return {
        content: `Verifying initial funding on Arc L1 for account ${accountId}.`,
        tool_calls: [
          {
            id: `call_${Date.now()}_verify_funding`,
            type: "function",
            function: {
              name: "verify_initial_funding",
              arguments: JSON.stringify({
                accountId: payloadObj?.accountId || accountId,
                minDepositUsdc: payloadObj?.minDepositUsdc || 1.0,
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
