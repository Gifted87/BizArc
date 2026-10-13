import { DbClient } from "../database/dbClient.js";
import { DynamicRecordsService } from "../records/dynamicRecordsService.js";
import { PermissionRequestRepo } from "../database/repos/permissionRequestRepo.js";
import { VendorMasterRepo } from "../database/repos/vendorMasterRepo.js";
import { VendorBankRepo } from "../database/repos/vendorBankRepo.js";
import { VendorPaymentPreferenceRepo } from "../database/repos/vendorPaymentPreferenceRepo.js";
import { AuthorizationGate } from "../security/authorizationGate.js";

export interface RecurringLiabilitySpec {
  liabilityId?: string;
  companyId?: string;
  accountId: string;
  vendorId: string;
  title: string;
  category?: string;
  amountUsdc: string;
  dueDate: Date;
  frequencyCron: string;
  payoutAddress?: string | null;
  poReference?: string;
  documentHash?: string;
  preferredPaymentRail?: string;
  preferredSubMethod?: string;
  bankDetails?: Record<string, any>;
  cryptoDetails?: Record<string, any>;
}

export class RecurringLiabilityService {
  private static dynamicRecords = new DynamicRecordsService();

  /**
   * Adds a recurring liability for an account (Dynamic Record 1).
   * User Invariant: Can be added by human or agent, although such actions require human approval.
   */
  public static async addRecurringLiability(params: {
    spec: RecurringLiabilitySpec;
    proposedBy: "HUMAN" | string;
    rationale: string;
    sprsRequestId?: string;
    adminSignature?: string;
  }): Promise<{
    status: "CREATED" | "PENDING_HUMAN_APPROVAL";
    liabilityId?: string;
    sprsRequestId?: string;
    message: string;
  }> {
    const { spec, proposedBy, rationale, sprsRequestId, adminSignature } = params;

    // 1. Verify vendor is registered in Vendor Master Registry
    let vendor = await VendorMasterRepo.getVendorById(spec.vendorId);
    let payoutAddress = spec.payoutAddress || vendor?.verified_payout_address || null;
    const isFiat = spec.preferredPaymentRail === "FIAT_PAYOUT" || Boolean(spec.bankDetails) || (payoutAddress ? !payoutAddress.startsWith("0x") : false);

    if (!vendor) {
      if (isFiat || spec.bankDetails) {
        vendor = await VendorMasterRepo.registerVendor({
          vendor_id: spec.vendorId,
          name: spec.vendorId,
          verified_payout_address: payoutAddress && payoutAddress.startsWith("0x") ? (payoutAddress as `0x${string}`) : null,
          verified_by_admin: "RECURRING_LIABILITY_SERVICE",
          last_verified_at: new Date(),
          change_lock: true,
        });
      } else {
        throw new Error(`[RecurringLiabilityService] Vendor ${spec.vendorId} is not registered in Vendor Master Registry.`);
      }
    }

    let bankAccountId: string | undefined;
    if (spec.bankDetails) {
      const bankRecord = await VendorBankRepo.createBankAccount({
        vendor_id: spec.vendorId,
        account_holder_name: spec.bankDetails.accountHolderName || spec.vendorId,
        iban_account_number: spec.bankDetails.ibanOrAccountNumber || spec.bankDetails.ibanAccountNumber || "UNKNOWN",
        routing_swift: spec.bankDetails.routingOrSwift || spec.bankDetails.routingSwift || "000000000",
        bank_name: spec.bankDetails.bankName,
        bank_country: spec.bankDetails.bankCountry || "US",
        payment_sub_method: spec.preferredSubMethod || spec.bankDetails.paymentSubMethod || "FEDWIRE",
        is_verified: true,
      });
      bankAccountId = bankRecord.bank_account_id;
    }

    if (spec.preferredPaymentRail || spec.preferredSubMethod || spec.bankDetails || spec.cryptoDetails) {
      await VendorPaymentPreferenceRepo.setPreference({
        vendor_id: spec.vendorId,
        preferred_rail: (spec.preferredPaymentRail as any) || (isFiat ? "FIAT_PAYOUT" : "DISBURSAL_VAULT"),
        preferred_sub_method: spec.preferredSubMethod || null,
        bank_account_id: bankAccountId || null,
        crypto_wallet_address: spec.cryptoDetails?.walletAddress || (payoutAddress && payoutAddress.startsWith("0x") ? payoutAddress : null),
        crypto_chain_id: spec.cryptoDetails?.chainId ?? 5042,
        crypto_token_symbol: spec.cryptoDetails?.tokenSymbol || "USDC",
      });
    }

    // 2. Check Layer 2 Human Authorization
    const authCheck = await AuthorizationGate.verifyAuthorization({
      actionType: "ADD_RECURRING_LIABILITY",
      accountId: spec.accountId,
      amountUsdc: spec.amountUsdc,
      sprsRequestId,
      adminSignature,
    });

    const isHumanInitiated = proposedBy === "HUMAN" || authCheck.isAuthorized;

    if (!isHumanInitiated) {
      // Create EIP-712 Standardized Permission Request (SPRS) for Human CFO
      const sprsId = `SPRS_ADD_LIA_${Date.now()}`;
      await PermissionRequestRepo.createRequest({
        request_id: sprsId,
        action_type: "ADD_RECURRING_LIABILITY",
        reason: `Agent ${proposedBy} proposed new recurring liability '${spec.title}' (${spec.amountUsdc} USDC, cron ${spec.frequencyCron}) for account ${spec.accountId}. Rationale: ${rationale}`,
        amount_usdc: parseFloat(spec.amountUsdc),
        status: "PENDING",
        payload: { spec: { ...spec, payoutAddress }, proposedBy, rationale },
      });

      return {
        status: "PENDING_HUMAN_APPROVAL",
        sprsRequestId: sprsId,
        message: `Recurring liability proposal paused for Layer 2 Human CFO approval (SPRS ${sprsId}).`,
      };
    }

    // 3. Commit to Dynamic Record 1 (account_liabilities)
    const liability = await this.dynamicRecords.upsertLiability({
      companyId: spec.companyId,
      accountId: spec.accountId,
      vendorId: spec.vendorId,
      title: spec.title,
      category: spec.category || "SUBSCRIPTION",
      amountUsdc: spec.amountUsdc,
      dueDate: spec.dueDate,
      frequency: spec.frequencyCron as any,
      payoutAddress: payoutAddress || undefined,
      documentHash: spec.documentHash || `HASH_${Date.now()}`,
      poReference: spec.poReference,
      status: "SCHEDULED",
      preferredPaymentRail: (spec.preferredPaymentRail as any) || (isFiat ? "FIAT_PAYOUT" : "DISBURSAL_VAULT"),
      paymentSubMethod: spec.preferredSubMethod || undefined,
      paymentRailConfig: spec.bankDetails || spec.cryptoDetails || {},
    });

    // 4. Recalculate Dynamic Record 2 (Safe-to-Invest & Tripartite Balance)
    await this.dynamicRecords.calculateSafeToInvest(spec.accountId);

    return {
      status: "CREATED",
      liabilityId: liability.liabilityId,
      message: `Recurring liability '${spec.title}' successfully activated on account ${spec.accountId}. Dynamic Record 1 & 2 updated.`,
    };
  }

  /**
   * Edits an existing recurring liability for an account (amount, due date, schedule, or account).
   * Requires Layer 2 Human Approval if initiated by an agent.
   */
  public static async editRecurringLiability(params: {
    liabilityId: string;
    updates: Partial<RecurringLiabilitySpec>;
    proposedBy: "HUMAN" | string;
    rationale: string;
    sprsRequestId?: string;
    adminSignature?: string;
  }): Promise<{
    status: "UPDATED" | "PENDING_HUMAN_APPROVAL";
    liabilityId?: string;
    sprsRequestId?: string;
    message: string;
  }> {
    const { liabilityId, updates, proposedBy, rationale, sprsRequestId, adminSignature } = params;

    const existingRes = await DbClient.query(
      `SELECT * FROM account_liabilities WHERE liability_id = $1 LIMIT 1;`,
      [liabilityId]
    );

    if (existingRes.rows.length === 0) {
      throw new Error(`[RecurringLiabilityService] Liability ${liabilityId} not found.`);
    }

    const existing = existingRes.rows[0];

    const authCheck = await AuthorizationGate.verifyAuthorization({
      actionType: "EDIT_RECURRING_LIABILITY",
      accountId: updates.accountId || existing.account_id,
      amountUsdc: updates.amountUsdc || existing.amount_usdc,
      sprsRequestId,
      adminSignature,
    });

    const isHumanInitiated = proposedBy === "HUMAN" || authCheck.isAuthorized;

    if (!isHumanInitiated) {
      const sprsId = `SPRS_EDIT_LIA_${liabilityId}_${Date.now()}`;
      await PermissionRequestRepo.createRequest({
        request_id: sprsId,
        action_type: "EDIT_RECURRING_LIABILITY",
        reason: `Agent ${proposedBy} proposed editing liability ${liabilityId} (${existing.title}). Rationale: ${rationale}`,
        amount_usdc: parseFloat(updates.amountUsdc || existing.amount_usdc),
        status: "PENDING",
        payload: { liabilityId, updates, existing, proposedBy, rationale },
      });

      return {
        status: "PENDING_HUMAN_APPROVAL",
        sprsRequestId: sprsId,
        message: `Liability edit paused for Layer 2 Human CFO approval (SPRS ${sprsId}).`,
      };
    }

    // Execute update in PostgreSQL
    await DbClient.query(
      `UPDATE account_liabilities 
       SET title = COALESCE($1, title),
           amount_usdc = COALESCE($2, amount_usdc),
           due_date = COALESCE($3, due_date),
           frequency_cron = COALESCE($4, frequency_cron),
           account_id = COALESCE($5, account_id),
           updated_at = NOW()
       WHERE liability_id = $6;`,
      [
        updates.title || null,
        updates.amountUsdc || null,
        updates.dueDate ? updates.dueDate.toISOString() : null,
        updates.frequencyCron || null,
        updates.accountId || null,
        liabilityId,
      ]
    );

    // Recalculate Dynamic Record 2
    const targetAccount = updates.accountId || existing.account_id;
    await this.dynamicRecords.calculateSafeToInvest(targetAccount);

    return {
      status: "UPDATED",
      liabilityId,
      message: `Recurring liability ${liabilityId} updated successfully. Dynamic Record 1 & 2 recalculated.`,
    };
  }

  /**
   * Removes or cancels a recurring liability from an account.
   * Requires Layer 2 Human Approval if initiated by an agent.
   */
  public static async removeRecurringLiability(params: {
    liabilityId: string;
    proposedBy: "HUMAN" | string;
    rationale: string;
    sprsRequestId?: string;
    adminSignature?: string;
  }): Promise<{
    status: "REMOVED" | "PENDING_HUMAN_APPROVAL";
    liabilityId?: string;
    sprsRequestId?: string;
    message: string;
  }> {
    const { liabilityId, proposedBy, rationale, sprsRequestId, adminSignature } = params;

    const existingRes = await DbClient.query(
      `SELECT * FROM account_liabilities WHERE liability_id = $1 LIMIT 1;`,
      [liabilityId]
    );

    if (existingRes.rows.length === 0) {
      throw new Error(`[RecurringLiabilityService] Liability ${liabilityId} not found.`);
    }

    const existing = existingRes.rows[0];

    const authCheck = await AuthorizationGate.verifyAuthorization({
      actionType: "REMOVE_RECURRING_LIABILITY",
      accountId: existing.account_id,
      amountUsdc: existing.amount_usdc,
      sprsRequestId,
      adminSignature,
    });

    const isHumanInitiated = proposedBy === "HUMAN" || authCheck.isAuthorized;

    if (!isHumanInitiated) {
      const sprsId = `SPRS_REM_LIA_${liabilityId}_${Date.now()}`;
      await PermissionRequestRepo.createRequest({
        request_id: sprsId,
        action_type: "REMOVE_RECURRING_LIABILITY",
        reason: `Agent ${proposedBy} proposed removing liability ${liabilityId} (${existing.title}). Rationale: ${rationale}`,
        amount_usdc: parseFloat(existing.amount_usdc),
        status: "PENDING",
        payload: { liabilityId, existing, proposedBy, rationale },
      });

      return {
        status: "PENDING_HUMAN_APPROVAL",
        sprsRequestId: sprsId,
        message: `Liability removal paused for Layer 2 Human CFO approval (SPRS ${sprsId}).`,
      };
    }

    await DbClient.query(
      `UPDATE account_liabilities SET status = 'CANCELLED', updated_at = NOW() WHERE liability_id = $1;`,
      [liabilityId]
    );

    // Recalculate Dynamic Record 2
    await this.dynamicRecords.calculateSafeToInvest(existing.account_id);

    return {
      status: "REMOVED",
      liabilityId,
      message: `Recurring liability ${liabilityId} removed/cancelled. Dynamic Record 1 & 2 recalculated.`,
    };
  }
}
