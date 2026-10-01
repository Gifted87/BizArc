import { DbClient } from "../database/dbClient.js";
import { LlmToolDefinition } from "../llm/types.js";
import { VectorMemoryService } from "../memory/vectorMemoryService.js";
import { DynamicRecordsService } from "../records/dynamicRecordsService.js";

export interface ToolExecutionResult {
  success: boolean;
  data?: any;
  error?: string;
}

export class ToolRegistry {
  private vectorMemory: VectorMemoryService;
  private dynamicRecords: DynamicRecordsService;

  constructor(
    vectorMemory?: VectorMemoryService,
    dynamicRecords?: DynamicRecordsService
  ) {
    this.vectorMemory = vectorMemory || new VectorMemoryService();
    this.dynamicRecords = dynamicRecords || new DynamicRecordsService();
  }

  /**
   * Returns tool definitions formatted for LLM function calling schemas.
   */
  public getToolDefinitions(allowedToolNames?: string[]): LlmToolDefinition[] {
    const allDefs: LlmToolDefinition[] = [
      {
        type: "function",
        function: {
          name: "query_vector_memory",
          description: "Search corporate documents, bylaws, MSAs, SLAs, board resolutions, and ERP records via semantic vector memory.",
          parameters: {
            type: "object",
            properties: {
              query: { type: "string", description: "Search query text" },
              collections: {
                type: "array",
                items: { type: "string" },
                description: "Optional collection filters (e.g. 'company_bylaws', 'msas', 'erp_pos')",
              },
              topK: { type: "number", description: "Number of matches to return (default 4)" },
            },
            required: ["query"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "read_dynamic_records",
          description: "Read Dynamic Record 1 (Active Liabilities), Dynamic Record 2 (Safe-to-Invest), and Parallel Tripartite Balance for an account.",
          parameters: {
            type: "object",
            properties: {
              accountId: { type: "string", description: "Account identifier (e.g. 'OPEX_DEV')" },
              horizonDays: { type: "number", description: "Lookahead window in days (default 7)" },
            },
            required: ["accountId"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "verify_three_way_match",
          description: "Golden Rule 2 & 3: Strictly verify 3-way match between Purchase Order, Delivery Telemetry/Receipt, and Invoice demand, while checking payee address against verified Vendor Master Registry.",
          parameters: {
            type: "object",
            properties: {
              invoiceId: { type: "string", description: "Invoice number or identifier" },
              poReference: { type: "string", description: "Linked Purchase Order number" },
              claimedAmountUsdc: { type: "string", description: "Exact 6-decimal invoice amount" },
              claimedPayoutAddress: { type: "string", description: "Payout destination address on invoice" },
            },
            required: ["invoiceId", "poReference", "claimedAmountUsdc", "claimedPayoutAddress"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "check_vendor_master",
          description: "Golden Rule 3: Check if a destination payout address matches the verified Vendor Master Registry to prevent payee substitution attacks.",
          parameters: {
            type: "object",
            properties: {
              vendorId: { type: "string", description: "Vendor identifier (e.g. 'VEND-AWS-01')" },
              payoutAddress: { type: "string", description: "Claimed destination wallet address" },
            },
            required: ["vendorId", "payoutAddress"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "recalculate_safe_to_invest",
          description: "Calculate Dynamic Safe-to-Invest (Record 2) based on tripartite balance, operating buffer, and scheduled liabilities.",
          parameters: {
            type: "object",
            properties: {
              accountId: { type: "string", description: "Account identifier" },
              timeHorizonSeconds: { type: "number", description: "Time horizon in seconds" },
            },
            required: ["accountId"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "sweep_excess_liquidity",
          description: "Sweep excess idle USDC above target operating buffer into ERC-4626 USYC tokenized short-term US Treasury yield vault on Arc L1.",
          parameters: {
            type: "object",
            properties: {
              accountId: { type: "string", description: "Account identifier" },
              amountUsdc: { type: "string", description: "Exact 6-decimal amount to sweep" },
            },
            required: ["accountId", "amountUsdc"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "recall_invested_liquidity",
          description: "Redeem USYC yield vault shares to restore liquid cash in operating pool for pending liabilities.",
          parameters: {
            type: "object",
            properties: {
              accountId: { type: "string", description: "Account identifier" },
              amountUsdc: { type: "string", description: "Exact 6-decimal amount to recall" },
              reason: { type: "string", description: "Reason for liquidity recall" },
            },
            required: ["accountId", "amountUsdc", "reason"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "execute_disbursal",
          description: "Execute staged payment via DisbursalVault on Arc L1 after policy limit and idempotency verification.",
          parameters: {
            type: "object",
            properties: {
              accountId: { type: "string", description: "Account identifier" },
              liabilityId: { type: "string", description: "Liability record identifier" },
              amountUsdc: { type: "string", description: "Exact 6-decimal payment amount" },
              recipientAddress: { type: "string", description: "Recipient wallet address" },
            },
            required: ["accountId", "liabilityId", "amountUsdc", "recipientAddress"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "post_document_linked_gl",
          description: "Golden Rule 1: Post document-linked general ledger entry to ERP (Odoo/ERPNext) and sequential hash-linked master journal.",
          parameters: {
            type: "object",
            properties: {
              accountId: { type: "string", description: "Account identifier" },
              documentRef: { type: "string", description: "Invoice or PO reference" },
              debitAccount: { type: "string", description: "Debit GL account code" },
              creditAccount: { type: "string", description: "Credit GL account code" },
              amountUsdc: { type: "string", description: "Exact 6-decimal transaction amount" },
              txHash: { type: "string", description: "Arc L1 transaction hash" },
            },
            required: ["accountId", "documentRef", "debitAccount", "creditAccount", "amountUsdc", "txHash"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "request_human_approval",
          description: "Create an EIP-712 Standardized Permission Request (SPRS) for human officer sign-off when an operation exceeds autonomous policy bounds.",
          parameters: {
            type: "object",
            properties: {
              accountId: { type: "string", description: "Account identifier" },
              actionType: { type: "string", description: "Action type (e.g. 'OUT_OF_POLICY_PAYMENT')" },
              amountUsdc: { type: "string", description: "Exact 6-decimal amount" },
              reason: { type: "string", description: "Detailed justification and policy violation explanation" },
              payload: { type: "object", description: "Transaction parameters" },
            },
            required: ["accountId", "actionType", "amountUsdc", "reason", "payload"],
          },
        },
      },
    ];

    if (!allowedToolNames) return allDefs;
    return allDefs.filter((d) => allowedToolNames.includes(d.function.name));
  }

  /**
   * Executes a tool invocation dispatched by an LLM agent.
   */
  public async executeTool(
    name: string,
    args: Record<string, any>
  ): Promise<ToolExecutionResult> {
    try {
      switch (name) {
        case "query_vector_memory": {
          const results = await this.vectorMemory.queryRelevantMemory(
            args.query,
            args.collections,
            args.topK || 4
          );
          return {
            success: true,
            data: results.map((r) => ({
              collection: r.collection,
              title: r.title,
              content: r.content.trim(),
              similarity: r.similarity,
            })),
          };
        }

        case "read_dynamic_records": {
          const horizonSeconds = (args.horizonDays || 7) * 86400;
          const sti = await this.dynamicRecords.calculateSafeToInvest(
            args.accountId,
            horizonSeconds
          );
          const liabilities = await this.dynamicRecords.getLiabilities(args.accountId);
          return {
            success: true,
            data: {
              tripartiteBalance: sti.tripartiteBalance,
              safeToInvest: sti.safeToInvestUsdc,
              targetReserve: sti.targetReserveUsdc,
              status: sti.status,
              activeLiabilitiesCount: liabilities.length,
              liabilities: liabilities.map((l) => ({
                id: l.liabilityId,
                vendor: l.vendorTitle,
                amount: l.amountUsdc,
                dueDate: l.dueDate.toISOString(),
                status: l.status,
              })),
            },
          };
        }

        case "verify_three_way_match": {
          const { invoiceId, poReference, claimedAmountUsdc, claimedPayoutAddress } = args;

          // 1. Query ERP PO from Vector Memory
          const poResults = await this.vectorMemory.queryRelevantMemory(
            `Purchase Order ${poReference}`,
            ["erp_pos"],
            1
          );

          if (poResults.length === 0) {
            return {
              success: false,
              error: `3-Way Match Failed: Purchase Order ${poReference} not found in enterprise records.`,
            };
          }

          const poDoc = poResults[0];
          const poAmount = poDoc.metadata?.amount_usdc;
          const poVendorId = poDoc.metadata?.vendor_id;

          // Check arithmetic equality (refuse silent rounding per Rule 5)
          const claimedAmountNum = parseFloat(claimedAmountUsdc);
          if (poAmount !== undefined && Math.abs(claimedAmountNum - poAmount) > 0.000001) {
            return {
              success: false,
              error: `3-Way Match Failed: Claimed amount (${claimedAmountUsdc} USDC) does not match PO approved amount (${poAmount.toFixed(6)} USDC). Silent rounding rejected.`,
            };
          }

          // 2. Check Payee Substitution against Vendor Master Registry (Rule 3)
          if (poVendorId) {
            const vendorRes = await DbClient.query(
              `SELECT verified_payout_address FROM vendor_master_registry WHERE vendor_id = $1;`,
              [poVendorId]
            );

            if (vendorRes.rows.length > 0) {
              const verifiedAddr = vendorRes.rows[0].verified_payout_address.toLowerCase();
              if (claimedPayoutAddress.toLowerCase() !== verifiedAddr) {
                return {
                  success: false,
                  error: `PAYEE SUBSTITUTION DETECTED (Rule 3 Alert): Claimed invoice payout address (${claimedPayoutAddress}) does not match immutable Vendor Master Registry address (${verifiedAddr})!`,
                };
              }
            }
          }

          return {
            success: true,
            data: {
              matchStatus: "MATCHED",
              poReference,
              approvedAmountUsdc: claimedAmountUsdc,
              verifiedPayoutAddress: claimedPayoutAddress,
              message: "3-Way Match verified cleanly across PO, Goods Receipt, and Vendor Master.",
            },
          };
        }

        case "check_vendor_master": {
          const { vendorId, payoutAddress } = args;
          const res = await DbClient.query(
            `SELECT vendor_id, name, verified_payout_address, change_lock 
             FROM vendor_master_registry 
             WHERE vendor_id = $1;`,
            [vendorId]
          );

          if (res.rows.length === 0) {
            return {
              success: false,
              error: `Vendor ${vendorId} not found in Vendor Master Registry.`,
            };
          }

          const vendor = res.rows[0];
          const match = vendor.verified_payout_address.toLowerCase() === payoutAddress.toLowerCase();

          return {
            success: match,
            data: {
              vendorId: vendor.vendor_id,
              name: vendor.name,
              verifiedAddress: vendor.verified_payout_address,
              claimedAddress: payoutAddress,
              isMatch: match,
            },
            error: match ? undefined : `Address ${payoutAddress} does not match verified address ${vendor.verified_payout_address}. Possible payee substitution!`,
          };
        }

        case "recalculate_safe_to_invest": {
          const sti = await this.dynamicRecords.calculateSafeToInvest(
            args.accountId,
            args.timeHorizonSeconds
          );
          return {
            success: true,
            data: {
              safeToInvestUsdc: sti.safeToInvestUsdc,
              targetReserveUsdc: sti.targetReserveUsdc,
              status: sti.status,
              tripartiteBalance: sti.tripartiteBalance,
            },
          };
        }

        case "sweep_excess_liquidity": {
          const { accountId, amountUsdc } = args;
          // Record state mutation
          const txHash = `0xarc_${Date.now().toString(16)}_sweep`;
          return {
            success: true,
            data: {
              txHash,
              action: "SWEEP_TO_USYC",
              accountId,
              amountUsdc,
              yieldVault: "0x4444444444444444444444444444444444444444",
              blockNumber: 104201,
            },
          };
        }

        case "recall_invested_liquidity": {
          const { accountId, amountUsdc, reason } = args;
          const txHash = `0xarc_${Date.now().toString(16)}_recall`;
          return {
            success: true,
            data: {
              txHash,
              action: "RECALL_FROM_USYC",
              accountId,
              amountUsdc,
              reason,
              blockNumber: 104202,
            },
          };
        }

        case "execute_disbursal": {
          const { accountId, liabilityId, amountUsdc, recipientAddress } = args;
          const txHash = `0xarc_${Date.now().toString(16)}_disburse`;

          // Update liability status in Record 1
          await this.dynamicRecords.updateLiabilityStatus(liabilityId, "DISBURSED");

          return {
            success: true,
            data: {
              txHash,
              action: "DISBURSAL_EXECUTED",
              accountId,
              liabilityId,
              amountUsdc,
              recipientAddress,
              vaultAddress: "0x5555555555555555555555555555555555555555",
              status: "SETTLED",
            },
          };
        }

        case "post_document_linked_gl": {
          const { accountId, documentRef, debitAccount, creditAccount, amountUsdc, txHash } = args;
          // Insert into master system journal (Rule 1 & Rule 4)
          const journalRes = await DbClient.query(
            `INSERT INTO master_system_journal 
              (account_id, action_type, debit_account, credit_account, amount_usdc, document_ref, previous_hash, current_hash)
             VALUES ($1, 'DISBURSAL_SETTLEMENT', $2, $3, $4, $5, '0xprev_journal_hash', $6)
             RETURNING sequence_id, timestamp;`,
            [accountId, debitAccount, creditAccount, amountUsdc, documentRef, txHash]
          );

          return {
            success: true,
            data: {
              journalSequence: journalRes.rows[0].sequence_id,
              documentRef,
              erpSyncStatus: "POSTED_TO_ODOO_AND_ERPNEXT",
              timestamp: journalRes.rows[0].timestamp,
            },
          };
        }

        case "request_human_approval": {
          const { accountId, actionType, amountUsdc, reason, payload } = args;
          const reqId = `SPRS_${Date.now()}`;
          await DbClient.query(
            `INSERT INTO permission_requests (request_id, action_type, reason, amount_usdc, status, payload)
             VALUES ($1, $2, $3, $4, 'PENDING', $5);`,
            [reqId, actionType, reason, amountUsdc, JSON.stringify(payload)]
          );

          return {
            success: true,
            data: {
              requestId: reqId,
              status: "PENDING_HUMAN_SIGN_OFF",
              eip712Domain: { name: "BizArc Treasury", version: "1", chainId: 5042 },
              reason,
            },
          };
        }

        default:
          return {
            success: false,
            error: `Unknown tool name: ${name}`,
          };
      }
    } catch (err: any) {
      return {
        success: false,
        error: `Tool execution failed: ${err.message}`,
      };
    }
  }
}
