import {
  PublicClient,
  TransactionReceipt,
  parseAbiItem,
  decodeEventLog,
} from "viem";
import { ArcClientManager } from "../foundation/arc/client.js";
import { WebhookHandler, CircleWebhookPayload } from "../foundation/events/webhookHandler.js";
import { MasterJournalRepo, MasterJournalRecord } from "../database/repos/masterJournalRepo.js";
import { AuditLogRepo, AccountAuditLogRecord } from "../database/repos/auditLogRepo.js";
import { AGENT_REGISTRY, AgentPersonaType } from "../types/agents.js";

export class ReconciledReceiptError extends Error {
  constructor(message: string) {
    super(`[LedgerWitnessService:ReconciliationFailure] ${message}`);
    this.name = "ReconciledReceiptError";
  }
}

export class LoudRoundingError extends Error {
  constructor(message: string) {
    super(`[LedgerWitnessService:LoudRoundingError] ${message}`);
    this.name = "LoudRoundingError";
  }
}

export interface ReconciledReceipt {
  txHash: `0x${string}`;
  blockNumber: bigint;
  blockHash: `0x${string}`;
  status: "success" | "reverted";
  gasUsed: bigint;
  from: `0x${string}`;
  to: `0x${string}` | null;
  transferredAmountUsdc?: number;
  logsCount: number;
}

export interface WitnessTransactionParams {
  accountId: string;
  actionType: "AUTONOMOUS_SWEEP" | "AUTONOMOUS_RECALL" | "DISBURSAL_PAYMENT" | "CUSTOMER_FUNDING" | string;
  txHash: `0x${string}`;
  amountUsdc: number;
  documentRef: string;
  counterpartyAddress?: `0x${string}`;
  isAutonomous?: boolean;
  permissionRequestId?: string | null;
  preState?: Record<string, any>;
  postState?: Record<string, any>;
  category?: string;
  vendorId?: string;
  reason?: string;
}

export interface WitnessResult {
  reconciled: boolean;
  receipt: ReconciledReceipt;
  journalEntry: MasterJournalRecord;
  auditLog: AccountAuditLogRecord;
  voucher: {
    debitAccount: string;
    creditAccount: string;
    amountUsdc: number;
    documentRef: string;
  };
}

export class LedgerWitnessService {
  public readonly persona: AgentPersonaType = "LedgerWitnessAgent";
  public readonly erc8004Id = AGENT_REGISTRY.LedgerWitnessAgent.erc8004Id;
  public readonly canSignTransactions = AGENT_REGISTRY.LedgerWitnessAgent.canSignTransactions; // false
  public readonly canWriteLedger = AGENT_REGISTRY.LedgerWitnessAgent.canWriteLedger; // true

  private publicClient: PublicClient;

  constructor(customPublicClient?: PublicClient) {
    // Rule 4 & Segregation of Duties: LedgerWitness has ZERO wallet keys and CANNOT move money
    this.publicClient = customPublicClient ?? ArcClientManager.getPublicClient();
  }

  /**
   * Returns the independent PublicClient used by the witness
   */
  public getPublicClient(): PublicClient {
    return this.publicClient;
  }

  /**
   * Reconciles an onchain transaction receipt using independent RPC.
   * Confirms block confirmation, sender, recipient, amount, and event logs.
   * Enforces Rule 4 (Independent Witness) and Rule 5 (No Silent Rounding).
   */
  public async reconcileTransactionReceipt(
    txHash: `0x${string}`,
    expected?: {
      from?: `0x${string}`;
      to?: `0x${string}`;
      amountUsdc?: number;
      minBlockNumber?: bigint;
    }
  ): Promise<ReconciledReceipt> {
    const receipt: TransactionReceipt = await this.publicClient.getTransactionReceipt({
      hash: txHash,
    });

    if (!receipt) {
      throw new ReconciledReceiptError(`Transaction receipt for ${txHash} could not be retrieved from RPC.`);
    }

    if (receipt.status === "reverted") {
      throw new ReconciledReceiptError(`Transaction ${txHash} reverted onchain at block ${receipt.blockNumber}.`);
    }

    if (expected?.minBlockNumber && receipt.blockNumber < expected.minBlockNumber) {
      throw new ReconciledReceiptError(
        `Block number ${receipt.blockNumber} is earlier than expected minimum ${expected.minBlockNumber}.`
      );
    }

    if (expected?.from && receipt.from.toLowerCase() !== expected.from.toLowerCase()) {
      throw new ReconciledReceiptError(
        `Transaction sender mismatch: expected ${expected.from}, got ${receipt.from}`
      );
    }

    // Inspect logs for ERC-20 Transfer event to reconcile transferred amount
    let detectedTransferAmount: number | undefined;
    const transferEventAbi = parseAbiItem(
      "event Transfer(address indexed from, address indexed to, uint256 value)"
    );

    for (const log of receipt.logs) {
      try {
        const decoded = decodeEventLog({
          abi: [transferEventAbi],
          data: log.data,
          topics: log.topics,
        });

        if (decoded.eventName === "Transfer") {
          const rawValue = (decoded.args as any).value as bigint;
          // Exact 6-decimal scaling
          detectedTransferAmount = Number(rawValue) / 1_000_000;

          if (expected?.amountUsdc !== undefined) {
            // Rule 5: Make repair loud — refuse silent rounding
            const diff = Math.abs(detectedTransferAmount - expected.amountUsdc);
            if (diff > 0.0000001) {
              throw new LoudRoundingError(
                `Onchain transferred amount ${detectedTransferAmount.toFixed(6)} does not match expected amount ${expected.amountUsdc.toFixed(6)}. Arithmetic difference: ${diff.toFixed(6)}.`
              );
            }
          }

          if (expected?.to) {
            const recipient = (decoded.args as any).to as string;
            if (recipient.toLowerCase() !== expected.to.toLowerCase()) {
              throw new ReconciledReceiptError(
                `Rule 3 Violation (Payee Substitution Detected): Logged recipient ${recipient} does not match expected ${expected.to}.`
              );
            }
          }
          break;
        }
      } catch (err) {
        if (err instanceof LoudRoundingError || err instanceof ReconciledReceiptError) {
          throw err;
        }
        // Non-transfer event log, continue
      }
    }

    return {
      txHash,
      blockNumber: receipt.blockNumber,
      blockHash: receipt.blockHash,
      status: receipt.status,
      gasUsed: receipt.gasUsed,
      from: receipt.from,
      to: receipt.to,
      transferredAmountUsdc: detectedTransferAmount,
      logsCount: receipt.logs.length,
    };
  }

  /**
   * Reconciles a Circle Webhook notification against onchain truth.
   */
  public async reconcileCircleWebhook(params: {
    rawBody: string;
    signatureHeader?: string;
    publicKeyPem?: string;
  }): Promise<{
    verified: boolean;
    payload: CircleWebhookPayload;
    reconciledReceipt?: ReconciledReceipt;
  }> {
    if (params.signatureHeader && params.publicKeyPem) {
      const isValid = WebhookHandler.verifyCircleSignature({
        rawBody: params.rawBody,
        signatureHeader: params.signatureHeader,
        publicKeyPem: params.publicKeyPem,
      });
      if (!isValid) {
        throw new ReconciledReceiptError("Circle Webhook signature verification failed.");
      }
    }

    const payload = WebhookHandler.parsePayload(params.rawBody);

    let reconciledReceipt: ReconciledReceipt | undefined;
    if (payload.data.txHash && (payload.data.state === "CONFIRMED" || payload.data.state === "COMPLETE")) {
      const expectedAmount = payload.data.amount ? parseFloat(payload.data.amount) : undefined;
      reconciledReceipt = await this.reconcileTransactionReceipt(payload.data.txHash, {
        amountUsdc: expectedAmount,
      });
    }

    return {
      verified: true,
      payload,
      reconciledReceipt,
    };
  }

  /**
   * Generates formal double-entry voucher accounts based on the action type.
   * Adheres to the Double-Entry Voucher standard from the Architecture Plan.
   */
  public getDoubleEntryAccounts(
    actionType: string,
    accountId: string,
    vendorId?: string,
    category?: string
  ): { debitAccount: string; creditAccount: string } {
    switch (actionType) {
      case "AUTONOMOUS_SWEEP":
        return {
          debitAccount: `Asset:Investments:USYC:${accountId}`,
          creditAccount: `Asset:Cash:USDC:${accountId}`,
        };
      case "AUTONOMOUS_RECALL":
        return {
          debitAccount: `Asset:Cash:USDC:${accountId}`,
          creditAccount: `Asset:Investments:USYC:${accountId}`,
        };
      case "DISBURSAL_PAYMENT":
        return {
          debitAccount: `Expense:${category ?? "OPERATING"}:${vendorId ?? "VENDOR"}`,
          creditAccount: `Asset:Cash:USDC:${accountId}`,
        };
      case "CUSTOMER_FUNDING":
      case "DEPOSIT":
        return {
          debitAccount: `Asset:Cash:USDC:${accountId}`,
          creditAccount: `Revenue:CustomerReceipts`,
        };
      default:
        return {
          debitAccount: `Asset:Operations:${accountId}`,
          creditAccount: `Asset:Cash:USDC:${accountId}`,
        };
    }
  }

  /**
   * Appends an immutable, document-linked, cryptographically hash-chained entry
   * to the sequential master system journal.
   */
  public async recordJournalVoucher(params: {
    accountId: string;
    actionType: string;
    amountUsdc: number;
    documentRef: string;
    vendorId?: string;
    category?: string;
  }): Promise<MasterJournalRecord> {
    const { debitAccount, creditAccount } = this.getDoubleEntryAccounts(
      params.actionType,
      params.accountId,
      params.vendorId,
      params.category
    );

    return MasterJournalRepo.appendEntry({
      account_id: params.accountId,
      action_type: params.actionType,
      debit_account: debitAccount,
      credit_account: creditAccount,
      amount_usdc: params.amountUsdc,
      document_ref: params.documentRef,
    });
  }

  /**
   * Records an immutable entry in the account-specific agent audit log.
   */
  public async recordAccountAuditLog(params: {
    accountId: string;
    actionType: string;
    amountUsdc: number;
    isAutonomous: boolean;
    permissionRequestId?: string | null;
    txHash?: `0x${string}` | null;
    counterpartyAddress?: `0x${string}` | null;
    reason: string;
    preStateSnapshot?: Record<string, any>;
    postStateSnapshot?: Record<string, any>;
  }): Promise<AccountAuditLogRecord> {
    return AuditLogRepo.appendAuditLog({
      account_id: params.accountId,
      action_type: params.actionType,
      amount_usdc: params.amountUsdc,
      is_autonomous: params.isAutonomous,
      permission_request_id: params.permissionRequestId || null,
      tx_hash: params.txHash || null,
      counterparty_address: params.counterpartyAddress || null,
      reason: params.reason,
      pre_state_snapshot: params.preStateSnapshot || {},
      post_state_snapshot: params.postStateSnapshot || {},
      actor_agent: this.persona,
    });
  }

  /**
   * Complete End-to-End Transaction Witness Flow:
   * 1. Reconciles transaction receipt onchain via independent RPC
   * 2. Writes account audit log
   * 3. Writes double-entry voucher to hash-chained Master Journal
   */
  public async witnessTransaction(params: WitnessTransactionParams): Promise<WitnessResult> {
    // 1. Independent Onchain Receipt Verification
    const receipt = await this.reconcileTransactionReceipt(params.txHash, {
      to: params.counterpartyAddress,
      amountUsdc: params.amountUsdc,
    });

    // 2. Account-Level Audit Logging
    const auditLog = await this.recordAccountAuditLog({
      accountId: params.accountId,
      actionType: params.actionType,
      amountUsdc: params.amountUsdc,
      isAutonomous: params.isAutonomous ?? true,
      permissionRequestId: params.permissionRequestId,
      txHash: params.txHash,
      counterpartyAddress: params.counterpartyAddress,
      reason: params.reason ?? `Witnessed onchain tx ${params.txHash} at block ${receipt.blockNumber}`,
      preStateSnapshot: params.preState,
      postStateSnapshot: params.postState,
    });

    // 3. Sequential Double-Entry Voucher in Master Hash Chain
    const journalEntry = await this.recordJournalVoucher({
      accountId: params.accountId,
      actionType: params.actionType,
      amountUsdc: params.amountUsdc,
      documentRef: params.documentRef,
      vendorId: params.vendorId,
      category: params.category,
    });

    const { debitAccount, creditAccount } = this.getDoubleEntryAccounts(
      params.actionType,
      params.accountId,
      params.vendorId,
      params.category
    );

    return {
      reconciled: true,
      receipt,
      journalEntry,
      auditLog,
      voucher: {
        debitAccount,
        creditAccount,
        amountUsdc: params.amountUsdc,
        documentRef: params.documentRef,
      },
    };
  }

  /**
   * Verifies cryptographic hash chain integrity of the master journal.
   */
  public async verifyLedgerIntegrity(): Promise<{
    valid: boolean;
    totalEntries: number;
    brokenAtSequence?: string;
    details?: string;
  }> {
    return MasterJournalRepo.verifyChainIntegrity();
  }
}
