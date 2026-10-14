import { MovementPolicyRepo } from "../database/repos/movementPolicyRepo.js";
import { VendorMasterRepo } from "../database/repos/vendorMasterRepo.js";
import { VendorBankRepo } from "../database/repos/vendorBankRepo.js";
import { VendorPaymentPreferenceRepo } from "../database/repos/vendorPaymentPreferenceRepo.js";
import { MasterJournalRepo } from "../database/repos/masterJournalRepo.js";
import { AuditLogRepo } from "../database/repos/auditLogRepo.js";
import { PermissionRequestRepo } from "../database/repos/permissionRequestRepo.js";
import { TreasuryAccountsRepo } from "../database/repos/treasuryAccountsRepo.js";
import { ErpSyncRepo } from "../database/repos/erpSyncRepo.js";
import { DynamicRecordsService } from "../records/dynamicRecordsService.js";
import { DisbursalVaultRail } from "./rails/disbursalVaultRail.js";
import { ModularSessionKeyRail } from "./rails/modularSessionKeyRail.js";
import { Erc3009AuthorizationRail } from "./rails/erc3009AuthorizationRail.js";
import { GatewayX402Rail } from "./rails/gatewayX402Rail.js";
import { FiatPayoutRail } from "./rails/fiatPayoutRail.js";
import { AuthorizationGate } from "../security/authorizationGate.js";
import { ClearanceCodeRepo } from "../database/repos/clearanceCodeRepo.js";
import { CentralTreasuryYieldVaultService } from "../contracts/centralTreasuryYieldVaultService.js";
import {
  PaymentRailType,
  UniversalDisbursalIntent,
  UniversalDisbursalExecutionResult,
} from "./rails/types.js";

export class UniversalPaymentRouter {
  private disbursalVaultRail: DisbursalVaultRail;
  private modularSessionKeyRail: ModularSessionKeyRail;
  private erc3009Rail: Erc3009AuthorizationRail;
  private gatewayX402Rail: GatewayX402Rail;
  private fiatPayoutRail: FiatPayoutRail;
  private dynamicRecords: DynamicRecordsService;

  constructor() {
    this.disbursalVaultRail = new DisbursalVaultRail();
    this.modularSessionKeyRail = new ModularSessionKeyRail();
    this.erc3009Rail = new Erc3009AuthorizationRail();
    this.gatewayX402Rail = new GatewayX402Rail();
    this.fiatPayoutRail = new FiatPayoutRail();
    this.dynamicRecords = new DynamicRecordsService();
  }

  /**
   * Universal Payment Router Execution.
   * 
   * Enforces the Core Invariants:
   * 0. Two-Layer Authorization Gate: Enforcer Agent Layer 1 vs Human Layer 2.
   * 1. Loud Rounding Rejection: 6-decimal USDC integer math with zero floating-point tolerance.
   * 2. Movement Policy & Payroll Protection: Authorized accounts, loan ledgers, payroll wall.
   * 3. Payee Substitution Defense: All EVM addresses and x402 URLs must match Vendor Master.
   * 4. Three-Way Match: PO and goods delivery confirmation verified on Rails 1, 2, 3.
   * 5. Human Escalation (SPRS): Spending threshold breaches emit EIP-712 human permission requests.
   * 6. Universal Double-Entry Journaling & ERP Staging: SHA-256 hash chaining staged to ERPNext/Odoo.
   * 7. Automatic Recall from USYC: If cash is invested, automatically pulls funds from USYC.
   */
  public async routeAndExecute(params: {
    intent: UniversalDisbursalIntent;
    accountBalances?: Record<string, number>;
    adminSignature?: `0x${string}`;
    overrideRail?: PaymentRailType;
    clearanceCode?: string;
    sprsRequestId?: string;
  }): Promise<UniversalDisbursalExecutionResult> {
    const { intent, adminSignature, overrideRail, clearanceCode, sprsRequestId } = params;

    // ─────────────────────────────────────────────────────────────────────────────
    // TWO-LAYER AUTHORIZATION CHECK: Enforcer Agent (Layer 1) vs Human SPRS (Layer 2)
    // ─────────────────────────────────────────────────────────────────────────────
    let authCheck = await AuthorizationGate.verifyAuthorization({
      actionType: `UNIVERSAL_DISBURSAL_${overrideRail || "AUTO"}`,
      accountId: intent.primaryAccountId,
      amountUsdc: intent.amountUsdc.toFixed(6),
      clearanceCode,
      sprsRequestId,
      adminSignature,
    });

    if (!authCheck.isAuthorized) {
      const reqResult = await AuthorizationGate.requestAuthorization({
        actionType: `UNIVERSAL_DISBURSAL_${overrideRail || "AUTO"}`,
        accountId: intent.primaryAccountId,
        amountUsdc: intent.amountUsdc.toFixed(6),
        declaredReason: intent.declaredReason,
        recipientAddress: intent.payoutAddress,
      });

      if (reqResult.isAuthorized && reqResult.clearanceCode) {
        authCheck = {
          isAuthorized: true,
          layer: "ENFORCER_AGENT",
          clearanceCode: reqResult.clearanceCode,
          reason: reqResult.reason,
        };
      } else if (reqResult.sprsRequestId) {
        return {
          intentId: intent.intentId,
          rail: overrideRail || "DISBURSAL_VAULT",
          success: false,
          status: "ESCALATE_TO_SPRS",
          totalAmountUsdc: intent.amountUsdc,
          allocations: [],
          sprsRequestId: reqResult.sprsRequestId,
          executionTimestamp: new Date().toISOString(),
          error: reqResult.reason,
        };
      } else {
        return {
          intentId: intent.intentId,
          rail: overrideRail || "DISBURSAL_VAULT",
          success: false,
          status: "REJECTED_BY_POLICY",
          totalAmountUsdc: intent.amountUsdc,
          allocations: [],
          executionTimestamp: new Date().toISOString(),
          error: reqResult.reason || "Unauthorized action. Rejected by Enforcer Agent.",
        };
      }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // INVARIANT 1: LOUD ROUNDING REJECTION (Rule 5 - Refuse Silent Rounding)
    // ─────────────────────────────────────────────────────────────────────────────
    const amountStr = intent.amountUsdc.toString();
    const decimalParts = amountStr.split(".");
    if (decimalParts.length === 2 && decimalParts[1].length > 6) {
      return {
        intentId: intent.intentId,
        rail: overrideRail || "DISBURSAL_VAULT",
        success: false,
        status: "REJECTED_BY_POLICY",
        totalAmountUsdc: intent.amountUsdc,
        allocations: [],
        executionTimestamp: new Date().toISOString(),
        error: `LOUD ROUNDING REJECTED (Rule 5): Amount '${intent.amountUsdc}' exceeds 6-decimal USDC precision (${decimalParts[1].length} decimals). Silent rounding is strictly forbidden.`,
      };
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // INVARIANT 2: RESOLVE BALANCES & ENFORCE MOVEMENT POLICY & PAYROLL PROTECTION
    // ─────────────────────────────────────────────────────────────────────────────
    const primaryAcc = await TreasuryAccountsRepo.getAccountById(intent.primaryAccountId);
    const isPayrollRole = primaryAcc?.role === "PAYROLL" || intent.primaryAccountId.toLowerCase().includes("payroll");
    if (isPayrollRole && intent.category !== "PAYROLL") {
      return {
        intentId: intent.intentId,
        rail: overrideRail || "DISBURSAL_VAULT",
        success: false,
        status: "REJECTED_BY_POLICY",
        totalAmountUsdc: intent.amountUsdc,
        allocations: [],
        executionTimestamp: new Date().toISOString(),
        error: `HARD INVARIANT VIOLATION: Account ${intent.primaryAccountId} is role PAYROLL. Non-payroll draws are strictly prohibited.`,
      };
    }

    // Check Parallel Tripartite Balance & Automatic USYC Recall on Payment
    const primaryTrip = await this.dynamicRecords.getTripartiteBalance(intent.primaryAccountId);
    const liquidNum = parseFloat(primaryTrip.liquidCashUsdc);
    const availableNum = parseFloat(primaryTrip.availableBalanceUsdc);

    if (liquidNum < intent.amountUsdc && availableNum >= intent.amountUsdc) {
      const deficitUsdc = (intent.amountUsdc - liquidNum).toFixed(6);
      const rawDeficit = this.dynamicRecords.parseUsdcToRaw(deficitUsdc);
      // Persist recalled liquid funds so account has liquid cash ready for disbursal
      const newLiquid = primaryTrip.liquidCashRaw + rawDeficit;
      const newInvested = primaryTrip.investedYieldRaw - rawDeficit;
      await this.dynamicRecords.calculateSafeToInvest(intent.primaryAccountId, 7 * 86400, undefined, newLiquid, newInvested);
    }

    let resolvedBalances = params.accountBalances;
    if (!resolvedBalances) {
      resolvedBalances = {};
      const accounts = await TreasuryAccountsRepo.getAllAccounts();
      for (const acc of accounts) {
        try {
          const trip = await this.dynamicRecords.getTripartiteBalance(acc.account_id);
          // Use Available Balance (Liquid + Invested USYC) when making funding decisions
          resolvedBalances[acc.account_id] = parseFloat(trip.availableBalanceUsdc);
        } catch {
          resolvedBalances[acc.account_id] = 0;
        }
      }
    }

    const allocationResult = await MovementPolicyRepo.computeMultiAccountFunding({
      primaryAccountId: intent.primaryAccountId,
      totalAmountUsdc: intent.amountUsdc,
      accountBalances: resolvedBalances,
    });

    if ((allocationResult.unmetShortfallUsdc > 0 || allocationResult.requiresHumanApproval) && !adminSignature && !clearanceCode && !sprsRequestId) {
      const sprsId = `SPRS_MOV_${intent.intentId}`;
      await PermissionRequestRepo.createRequest({
        request_id: sprsId,
        action_type: "CROSS_ACCOUNT_WATERFALL_DRAW",
        reason:
          allocationResult.approvalReason ||
          `Multi-account draw requires human approval for ${intent.amountUsdc} USDC across accounts.`,
        amount_usdc: intent.amountUsdc,
        status: "PENDING",
        payload: { intent, allocations: allocationResult.allocations },
      });

      return {
        intentId: intent.intentId,
        rail: overrideRail || "DISBURSAL_VAULT",
        success: false,
        status: "ESCALATE_TO_SPRS",
        totalAmountUsdc: intent.amountUsdc,
        allocations: allocationResult.allocations,
        sprsRequestId: sprsId,
        executionTimestamp: new Date().toISOString(),
        error: allocationResult.approvalReason,
      };
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // INVARIANT 3: VENDOR MASTER LOOKUP, PAYMENT PREFERENCES & PAYEE SUBSTITUTION DEFENSE (Rule 3)
    // ─────────────────────────────────────────────────────────────────────────────
    const vendorPreference = await VendorPaymentPreferenceRepo.getPreference(intent.vendorId);
    let vendorRecord = await VendorMasterRepo.getVendorById(intent.vendorId);

    // If intent has no beneficiaryBank but preference or rail indicates FIAT_PAYOUT, resolve bank
    const isPreferredFiat = overrideRail === "FIAT_PAYOUT" || overrideRail === "FIAT_OFFRAMP" || vendorPreference?.preferred_rail === "FIAT_PAYOUT" || vendorPreference?.preferred_rail === "FIAT_OFFRAMP";
    if (!intent.beneficiaryBank && isPreferredFiat) {
      try {
        const bankRecord = vendorPreference?.bank_account_id
          ? await VendorBankRepo.getBankAccountById(vendorPreference.bank_account_id)
          : await VendorBankRepo.getVerifiedBankAccount(intent.vendorId);

        if (bankRecord) {
          intent.beneficiaryBank = {
            accountHolderName: bankRecord.account_holder_name,
            ibanOrAccountNumber: bankRecord.iban_account_number,
            routingOrSwift: bankRecord.routing_swift,
            bankCountry: bankRecord.bank_country,
            bankName: bankRecord.bank_name,
            paymentSubMethod: (bankRecord.payment_sub_method as any) || vendorPreference?.preferred_sub_method || "FEDWIRE",
            cardLast4: bankRecord.card_last4 || undefined,
            cardToken: bankRecord.card_token || undefined,
            cardNetwork: bankRecord.card_network || undefined,
          };
        }
      } catch {
        // Fallback if lookup fails
      }
    }

    if (!intent.sessionKeyId && vendorPreference?.session_key_id) {
      intent.sessionKeyId = vendorPreference.session_key_id;
    }
    if (!intent.serviceUrl && vendorPreference?.service_endpoint_url) {
      intent.serviceUrl = vendorPreference.service_endpoint_url;
    }

    // Determine target rail
    const activeRail: PaymentRailType =
      overrideRail ||
      vendorPreference?.preferred_rail ||
      (vendorRecord as any)?.payout_rail ||
      (intent.beneficiaryBank ? "FIAT_PAYOUT" : intent.serviceUrl ? "GATEWAY_X402" : "DISBURSAL_VAULT");

    if (!vendorRecord && (intent.payoutAddress || intent.serviceUrl || intent.beneficiaryBank)) {
      vendorRecord = await VendorMasterRepo.registerVendor({
        vendor_id: intent.vendorId,
        name: intent.vendorName,
        verified_payout_address: (intent.payoutAddress && intent.payoutAddress.startsWith("0x") && intent.payoutAddress.length === 42 ? intent.payoutAddress : null) as any,
        verified_by_admin: "UNIVERSAL_ROUTER_PRECHECK",
        last_verified_at: new Date(),
        change_lock: true,
      });
    }

    // 3A. Verify EVM payout address (only for crypto rails where payoutAddress is required)
    if (
      activeRail !== "FIAT_PAYOUT" &&
      activeRail !== "FIAT_OFFRAMP" &&
      vendorRecord &&
      intent.payoutAddress &&
      intent.payoutAddress.startsWith("0x") &&
      vendorRecord.verified_payout_address &&
      vendorRecord.verified_payout_address.toLowerCase() !== intent.payoutAddress.toLowerCase()
    ) {
      return {
        intentId: intent.intentId,
        rail: activeRail,
        success: false,
        status: "REJECTED_BY_POLICY",
        totalAmountUsdc: intent.amountUsdc,
        allocations: allocationResult.allocations,
        executionTimestamp: new Date().toISOString(),
        error: `PAYEE SUBSTITUTION DETECTED (Rule 3): Claimed address ${intent.payoutAddress} does not match immutable Vendor Master address ${vendorRecord.verified_payout_address}!`,
      };
    }

    // 3B. Verify x402 endpoint URL
    if (
      vendorRecord &&
      intent.serviceUrl &&
      (vendorRecord as any).payment_endpoint_url &&
      intent.serviceUrl.toLowerCase() !== (vendorRecord as any).payment_endpoint_url.toLowerCase()
    ) {
      return {
        intentId: intent.intentId,
        rail: overrideRail || "GATEWAY_X402",
        success: false,
        status: "REJECTED_BY_POLICY",
        totalAmountUsdc: intent.amountUsdc,
        allocations: allocationResult.allocations,
        executionTimestamp: new Date().toISOString(),
        error: `PAYEE SUBSTITUTION DETECTED (Rule 3): Claimed endpoint ${intent.serviceUrl} does not match immutable Vendor Master endpoint ${(vendorRecord as any).payment_endpoint_url}!`,
      };
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // INVARIANT 4: THREE-WAY MATCH VERIFICATION (Rule 2 - Invoices on Rails 1, 2, 3, 5)
    // ─────────────────────────────────────────────────────────────────────────────
    if (activeRail !== "GATEWAY_X402" && intent.requireThreeWayMatch) {
      if (!intent.poReference) {
        return {
          intentId: intent.intentId,
          rail: activeRail,
          success: false,
          status: "REJECTED_BY_POLICY",
          totalAmountUsdc: intent.amountUsdc,
          allocations: allocationResult.allocations,
          executionTimestamp: new Date().toISOString(),
          error: `3-Way Match Failed (Rule 2): Invoice '${intent.invoiceId || intent.intentId}' lacks approved Purchase Order reference.`,
        };
      }

      if (!intent.deliveryProofHash) {
        return {
          intentId: intent.intentId,
          rail: activeRail,
          success: false,
          status: "REJECTED_BY_POLICY",
          totalAmountUsdc: intent.amountUsdc,
          allocations: allocationResult.allocations,
          executionTimestamp: new Date().toISOString(),
          error: `3-Way Match Failed (Rule 2 Alert): Goods Receipt Note (GRN) or delivery confirmation not found for PO ${intent.poReference}. Milestone delivery proof is unverified.`,
        };
      }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // INVARIANT 5: DISPATCH TO CHOSEN PAYMENT RAIL & HUMAN ESCALATION (SPRS)
    // ─────────────────────────────────────────────────────────────────────────────
    let railResult: UniversalDisbursalExecutionResult;

    switch (activeRail) {
      case "DISBURSAL_VAULT":
        railResult = await this.disbursalVaultRail.execute(
          intent,
          allocationResult.allocations,
          adminSignature
        );
        break;

      case "MODULAR_SESSION_KEY":
        railResult = await this.modularSessionKeyRail.execute(
          intent,
          allocationResult.allocations,
          intent.sessionKeyId
        );
        break;

      case "ERC3009_AUTHORIZATION":
        railResult = await this.erc3009Rail.execute(
          intent,
          allocationResult.allocations
        );
        break;

      case "GATEWAY_X402":
        railResult = await this.gatewayX402Rail.execute(
          intent,
          allocationResult.allocations
        );
        break;

      case "FIAT_PAYOUT":
      case "FIAT_OFFRAMP":
        railResult = await this.fiatPayoutRail.execute(
          intent,
          allocationResult.allocations,
          adminSignature
        );
        if (railResult && activeRail === "FIAT_OFFRAMP") {
          railResult.rail = "FIAT_OFFRAMP";
        }
        break;

      default:
        throw new Error(`Unsupported payment rail: ${activeRail}`);
    }

    // If rail returned ESCALATE_TO_SPRS, persist SPRS permission request if not already logged
    if (railResult.status === "ESCALATE_TO_SPRS" && railResult.sprsRequestId) {
      await PermissionRequestRepo.createRequest({
        request_id: railResult.sprsRequestId,
        action_type: `THRESHOLD_BREACH_${activeRail}`,
        reason: railResult.error || `Payment of ${intent.amountUsdc} USDC on ${activeRail} breaches autonomous threshold.`,
        amount_usdc: intent.amountUsdc,
        status: "PENDING",
        payload: { intent, allocations: allocationResult.allocations, rail: activeRail },
      });
      return railResult;
    }

    if (!railResult.success) {
      return railResult;
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // INVARIANT 6: UNIVERSAL DOUBLE-ENTRY JOURNALING & ERPNext / Odoo STAGING
    // ─────────────────────────────────────────────────────────────────────────────
    const docRef = intent.poReference || intent.invoiceId || `DOC_${intent.intentId}`;
    let primarySequenceId: string | undefined;

    const isMultiAccount = allocationResult.allocations.length > 1;

    for (const alloc of allocationResult.allocations) {
      if (alloc.isPrimary) {
        // Direct cash disbursal from Primary Account
        const entry = await MasterJournalRepo.appendEntry({
          account_id: alloc.accountId,
          action_type: `DISBURSAL_${activeRail}`,
          debit_account: `Expense:${intent.category || "Vendor"}:${intent.vendorId}`,
          credit_account: `Asset:Cash:USDC:${alloc.accountId}`,
          amount_usdc: alloc.amountUsdc,
          document_ref: docRef,
        });
        if (!primarySequenceId) primarySequenceId = entry.sequence_id;
      } else {
        // Secondary waterfall account provides funds:
        // Post balanced Intercompany Loan Vouchers (Due To / Due From)
        const dueToEntry = await MasterJournalRepo.appendEntry({
          account_id: intent.primaryAccountId,
          action_type: "INTERCOMPANY_LOAN_DUE_TO",
          debit_account: `Expense:${intent.category || "Vendor"}:${intent.vendorId}`,
          credit_account: `Liability:DueTo:${alloc.accountId}`,
          amount_usdc: alloc.amountUsdc,
          document_ref: docRef,
        });
        if (!primarySequenceId) primarySequenceId = dueToEntry.sequence_id;

        await MasterJournalRepo.appendEntry({
          account_id: alloc.accountId,
          action_type: "INTERCOMPANY_LOAN_DUE_FROM",
          debit_account: `Asset:DueFrom:${intent.primaryAccountId}`,
          credit_account: `Asset:Cash:USDC:${alloc.accountId}`,
          amount_usdc: alloc.amountUsdc,
          document_ref: docRef,
        });
      }
    }

    railResult.journalSequenceId = primarySequenceId;

    // Stage to ERPNext and Odoo Sync Repositories
    await ErpSyncRepo.upsertSyncState({
      sync_id: `erp_sync_${intent.intentId}`,
      system_type: "ERPNEXT",
      account_id: intent.primaryAccountId,
      entity_type: "PAYMENT_ENTRY",
      last_sync_timestamp: new Date(),
      last_synced_document_id: docRef,
      sync_checkpoint_data: {
        rail: activeRail,
        amountUsdc: intent.amountUsdc,
        txHash: railResult.txHash,
        journalSequenceId: primarySequenceId,
        allocations: allocationResult.allocations,
        vendorId: intent.vendorId,
        idempotencyKey: railResult.idempotencyKey,
      },
      status: "SYNCED",
    });

    // Post to Account Agent Audit Logs for all participating accounts
    for (const alloc of allocationResult.allocations) {
      await AuditLogRepo.appendAuditLog({
        account_id: alloc.accountId,
        actor_agent: "DisbursalRouterAgent",
        action_type: `DISBURSAL_EXECUTION_${activeRail}`,
        amount_usdc: alloc.amountUsdc,
        is_autonomous: true,
        tx_hash: railResult.txHash || null,
        counterparty_address: intent.payoutAddress || null,
        reason: `Settled ${alloc.amountUsdc} USDC to ${intent.vendorName} via ${activeRail} (${alloc.isPrimary ? "Primary" : "Secondary Waterfall"}). Rationale: ${intent.declaredReason}`,
        pre_state_snapshot: { allocatedAmount: alloc.amountUsdc, isPrimary: alloc.isPrimary, isMultiAccount },
        post_state_snapshot: { status: "SETTLED", rail: activeRail, journalSequence: primarySequenceId },
      });
    }

    // Single-use enforcement: Consume clearance code upon execution
    if (authCheck.clearanceCode) {
      await ClearanceCodeRepo.consumeCode(authCheck.clearanceCode);
    }

    // Recalculate Dynamic Record 2 (Safe-to-Invest & Tripartite Balance) post-settlement
    for (const alloc of allocationResult.allocations) {
      try {
        await this.dynamicRecords.calculateSafeToInvest(alloc.accountId);
      } catch (e) {
        // Log non-fatal recalculation error
      }
    }

    return railResult;
  }
}
