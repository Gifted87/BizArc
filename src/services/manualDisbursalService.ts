import crypto from "node:crypto";
import { UniversalPaymentRouter } from "../payments/universalPaymentRouter.js";
import {
  PaymentRailType,
  FiatSubMethodType,
  UniversalDisbursalIntent,
  UniversalDisbursalExecutionResult,
} from "../payments/rails/types.js";
import { TreasuryAccountsRepo } from "../database/repos/treasuryAccountsRepo.js";
import { VendorMasterRepo } from "../database/repos/vendorMasterRepo.js";
import { VendorBankRepo } from "../database/repos/vendorBankRepo.js";
import { MasterJournalRepo } from "../database/repos/masterJournalRepo.js";
import { AuditLogRepo } from "../database/repos/auditLogRepo.js";
import { TokenSwapService } from "./tokenSwapService.js";
import { DynamicRecordsService } from "../records/dynamicRecordsService.js";

export interface ManualPaymentFiatDetails {
  subMethod?: FiatSubMethodType;
  accountHolderName: string;
  ibanOrAccountNumber: string;
  routingOrSwift?: string;
  bankCountry?: string;
  bankName?: string;
  cardToken?: string;
  cardLast4?: string;
  cardNetwork?: string;
}

export interface ManualPaymentCryptoDetails {
  walletAddress: `0x${string}` | string;
  chainId?: number;
  tokenSymbol?: string; // e.g. "USDC", "USDT", "ETH"
  targetChain?: string;
  sessionKeyId?: string;
  serviceUrl?: string;
}

export interface ExecuteManualPaymentParams {
  companyId: string;
  sourceAccountId: string;
  vendorId: string;
  vendorName: string;
  amountUsdc: number;
  paymentRail?: PaymentRailType;
  fiatDetails?: ManualPaymentFiatDetails;
  cryptoDetails?: ManualPaymentCryptoDetails;
  declaredReason: string;
  invoiceId?: string;
  poReference?: string;
  category?: string;
  adminSignature?: `0x${string}`;
  clearanceCode?: string;
  sprsRequestId?: string;
}

export interface ManualPaymentResult {
  success: boolean;
  intentId: string;
  rail: PaymentRailType;
  subMethod?: string;
  status: "EXECUTED" | "AWAITING_SETTLEMENT" | "ESCALATE_TO_SPRS" | "REJECTED_BY_POLICY";
  amountUsdc: number;
  sourceAccountId: string;
  vendorId: string;
  txHash?: string;
  fiatPayoutId?: string;
  cardPayoutRef?: string;
  imadOmadTrace?: string;
  journalSequenceId?: string;
  sprsRequestId?: string;
  error?: string;
  timestamp: string;
}

/**
 * ManualDisbursalService
 *
 * Handles manual payments initiated by human users/admins.
 * Accepts flexible payment details that can be either:
 * - Fiat-based: Fedwire, ACH, Push-to-Card, SEPA, SWIFT.
 * - Crypto-based: Direct Arc L1 Vault, ERC-3009 signed mandate, Session Key, x402, or Cross-Token Swap.
 *
 * Enforces:
 * 1. Source Account Liquidity & Payroll Protection Wall.
 * 2. Automatic Currency / Token Swap if payee requires non-USDC token.
 * 3. Anti-Payee Substitution Defense.
 * 4. Dual-Control Human Gate (EIP-712 CFO signature or clearance code).
 * 5. Hash-Chained Double-Entry Master Journal Vouchers.
 */
export class ManualDisbursalService {
  private paymentRouter: UniversalPaymentRouter;
  private tokenSwapService: TokenSwapService;
  private dynamicRecords: DynamicRecordsService;

  constructor(options?: {
    paymentRouter?: UniversalPaymentRouter;
    tokenSwapService?: TokenSwapService;
    dynamicRecords?: DynamicRecordsService;
  }) {
    this.paymentRouter = options?.paymentRouter ?? new UniversalPaymentRouter();
    this.tokenSwapService = options?.tokenSwapService ?? new TokenSwapService();
    this.dynamicRecords = options?.dynamicRecords ?? new DynamicRecordsService();
  }

  public async executeManualDisbursal(
    params: ExecuteManualPaymentParams
  ): Promise<ManualPaymentResult> {
    const timestamp = new Date().toISOString();
    const intentId = `MANUAL_PAY_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    // 1. Verify Source Treasury Account
    const account = await TreasuryAccountsRepo.getAccountById(params.sourceAccountId);
    if (!account) {
      return {
        success: false,
        intentId,
        rail: params.paymentRail || "DISBURSAL_VAULT",
        status: "REJECTED_BY_POLICY",
        amountUsdc: params.amountUsdc,
        sourceAccountId: params.sourceAccountId,
        vendorId: params.vendorId,
        error: `Source account '${params.sourceAccountId}' does not exist.`,
        timestamp,
      };
    }

    // Payroll Protection Wall
    const isPayrollAccount = account.role === "PAYROLL" || params.sourceAccountId.toLowerCase().includes("payroll");
    if (isPayrollAccount && params.category !== "PAYROLL") {
      return {
        success: false,
        intentId,
        rail: params.paymentRail || "DISBURSAL_VAULT",
        status: "REJECTED_BY_POLICY",
        amountUsdc: params.amountUsdc,
        sourceAccountId: params.sourceAccountId,
        vendorId: params.vendorId,
        error: `HARD INVARIANT VIOLATION: Source account '${params.sourceAccountId}' is role PAYROLL. Non-payroll draws are strictly prohibited.`,
        timestamp,
      };
    }

    // 2. Determine Payment Rail & Sub-Method
    let activeRail: PaymentRailType = params.paymentRail || "DISBURSAL_VAULT";
    let subMethod: string | undefined = undefined;

    if (params.fiatDetails) {
      activeRail = "FIAT_PAYOUT";
      subMethod = params.fiatDetails.subMethod || (params.fiatDetails.cardToken ? "PUSH_TO_CARD" : "FEDWIRE");
    } else if (params.cryptoDetails?.serviceUrl) {
      activeRail = "GATEWAY_X402";
    } else if (params.cryptoDetails?.sessionKeyId) {
      activeRail = "MODULAR_SESSION_KEY";
    }

    // 3. Handle Cross-Asset Token Swap if payee requires non-USDC token
    let executedAmountUsdc = params.amountUsdc;
    if (
      params.cryptoDetails?.tokenSymbol &&
      params.cryptoDetails.tokenSymbol.toUpperCase() !== "USDC"
    ) {
      const fromToken = "USDC";
      const toToken = params.cryptoDetails.tokenSymbol.toUpperCase();
      const targetChain = params.cryptoDetails.targetChain || "BASE";

      // Execute cross-chain or token conversion to desired asset
      await this.tokenSwapService.executeSwap({
        accountId: params.sourceAccountId,
        fromChain: "ARC",
        fromToken,
        toChain: targetChain,
        toToken,
        amount: params.amountUsdc.toFixed(6),
        slippage: 0.005,
      });
    }

    // 4. Construct Universal Disbursal Intent
    const intent: UniversalDisbursalIntent = {
      intentId,
      primaryAccountId: params.sourceAccountId,
      vendorId: params.vendorId,
      vendorName: params.vendorName,
      amountUsdc: executedAmountUsdc,
      payoutAddress: params.cryptoDetails?.walletAddress,
      serviceUrl: params.cryptoDetails?.serviceUrl,
      declaredReason: params.declaredReason || `Manual disbursal to ${params.vendorName} via ${activeRail}`,
      invoiceId: params.invoiceId,
      poReference: params.poReference,
      category: params.category || "DISBURSAL",
      sessionKeyId: params.cryptoDetails?.sessionKeyId,
      sprsRequestId: params.sprsRequestId,
      beneficiaryBank: params.fiatDetails ? {
        accountHolderName: params.fiatDetails.accountHolderName,
        ibanOrAccountNumber: params.fiatDetails.ibanOrAccountNumber,
        routingOrSwift: params.fiatDetails.routingOrSwift || (subMethod === "PUSH_TO_CARD" ? "CARD_OCT" : "021000018"),
        bankCountry: params.fiatDetails.bankCountry || "US",
        bankName: params.fiatDetails.bankName,
        paymentSubMethod: subMethod,
        cardToken: params.fiatDetails.cardToken,
        cardLast4: params.fiatDetails.cardLast4,
        cardNetwork: params.fiatDetails.cardNetwork,
      } : undefined,
    };

    // 5. Route and execute through UniversalPaymentRouter
    const result: UniversalDisbursalExecutionResult = await this.paymentRouter.routeAndExecute({
      intent,
      adminSignature: params.adminSignature,
      overrideRail: activeRail,
      clearanceCode: params.clearanceCode,
      sprsRequestId: params.sprsRequestId,
    });

    if (result.success || result.status === "EXECUTED") {
      // Recalculate dynamic liquidity record
      await this.dynamicRecords.calculateSafeToInvest(params.sourceAccountId);

      // Audit log entry
      await AuditLogRepo.appendAuditLog({
        account_id: params.sourceAccountId,
        actor_agent: "ManualDisbursalAdmin",
        action_type: `MANUAL_PAYMENT_${activeRail}`,
        amount_usdc: params.amountUsdc,
        is_autonomous: false,
        tx_hash: result.txHash,
        counterparty_address: params.cryptoDetails?.walletAddress,
        reason: params.declaredReason,
        pre_state_snapshot: { accountId: params.sourceAccountId },
        post_state_snapshot: { status: "EXECUTED", txHash: result.txHash, rail: activeRail },
      });
    }

    return {
      success: result.success,
      intentId,
      rail: activeRail,
      subMethod: result.subMethod || subMethod,
      status: result.status,
      amountUsdc: params.amountUsdc,
      sourceAccountId: params.sourceAccountId,
      vendorId: params.vendorId,
      txHash: result.txHash,
      fiatPayoutId: result.fiatPayoutId,
      cardPayoutRef: result.cardPayoutRef,
      imadOmadTrace: result.imadOmadTrace,
      journalSequenceId: result.journalSequenceId,
      sprsRequestId: result.sprsRequestId,
      error: result.error,
      timestamp,
    };
  }
}
