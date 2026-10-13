import { keccak256, stringToHex } from "viem";
import { LiabilityRepo, LiabilityDbRecord } from "../database/repos/liabilityRepo.js";
import { TreasuryAccountsRepo } from "../database/repos/treasuryAccountsRepo.js";
import { VendorMasterRepo } from "../database/repos/vendorMasterRepo.js";
import { AuditLogRepo } from "../database/repos/auditLogRepo.js";
import { DynamicRecordsService } from "../records/dynamicRecordsService.js";
import { LiabilityCategory, LiabilityStatus } from "../types/accounts.js";
import { PaymentRailType } from "../payments/rails/types.js";

export interface CreateLiabilityParams {
  accountId: string;
  vendorId: string;
  vendorName?: string;
  title: string;
  category: LiabilityCategory;
  amountUsdc: number;
  dueDate: Date | string;
  frequencyCron?: string;
  payoutAddress?: `0x${string}`;
  serviceUrl?: string;
  poReference?: string;
  preferredPaymentRail?: PaymentRailType;
  paymentRailConfig?: Record<string, any>;
  disbursalRules?: Record<string, any>;
  waterfallOverride?: Record<string, any>;
}

export interface ILiabilityManagementService {
  createLiability(companyId: string, params: CreateLiabilityParams): Promise<LiabilityDbRecord>;
  updateLiability(companyId: string, liabilityId: string, params: Partial<CreateLiabilityParams>): Promise<LiabilityDbRecord>;
  cancelLiability(companyId: string, liabilityId: string, adminInstruction: string): Promise<LiabilityDbRecord>;
  listLiabilities(companyId: string, filter?: { accountId?: string; status?: LiabilityStatus }): Promise<LiabilityDbRecord[]>;
}

export class LiabilityManagementService implements ILiabilityManagementService {
  private dynamicRecords: DynamicRecordsService;

  constructor(options?: { dynamicRecords?: DynamicRecordsService }) {
    this.dynamicRecords = options?.dynamicRecords ?? new DynamicRecordsService();
  }

  /**
   * Post-setup liability creation. Enforces account ownership, Rule 5 Loud Rounding, and updates Dynamic Records.
   */
  public async createLiability(
    companyId: string,
    params: CreateLiabilityParams
  ): Promise<LiabilityDbRecord> {
    if (!companyId || !params.accountId || !params.vendorId || !params.title) {
      throw new Error("LIABILITY_VALIDATION_ERROR: 'companyId', 'accountId', 'vendorId', and 'title' are required.");
    }

    // 1. Verify account belongs to tenant
    const account = await TreasuryAccountsRepo.getAccountByIdAndCompany(params.accountId, companyId);
    if (!account) {
      throw new Error(`LIABILITY_ATTACHMENT_ERROR: Account '${params.accountId}' not found for company '${companyId}'.`);
    }

    // 2. Rule 5 Loud Rounding & Value Validation
    const amountNum = Number(params.amountUsdc);
    if (isNaN(amountNum) || amountNum <= 0) {
      throw new Error("LOUD_ROUNDING_ERROR (Rule 5): Liability amount must be strictly greater than 0 USDC.");
    }
    const decParts = amountNum.toString().split(".");
    if (decParts.length === 2 && decParts[1].length > 6) {
      throw new Error(`LOUD_ROUNDING_ERROR (Rule 5): Amount '${params.amountUsdc}' exceeds 6-decimal USDC precision.`);
    }

    // 3. Register Vendor in Vendor Master Registry
    const payoutAddr = (params.payoutAddress || "0x0000000000000000000000000000000000000001") as `0x${string}`;
    await VendorMasterRepo.registerVendor({
      vendor_id: params.vendorId,
      name: params.vendorName || params.vendorId,
      verified_payout_address: payoutAddr,
      verified_by_admin: "LIABILITY_MANAGEMENT_SERVICE",
      last_verified_at: new Date(),
      change_lock: true,
    });

    // 4. Compute Document Hashes
    const poHash = params.poReference
      ? keccak256(stringToHex(`PO:${params.poReference}:${params.amountUsdc}`))
      : null;
    const invHash = keccak256(stringToHex(`INV:${params.title}:${params.amountUsdc}:${Date.now()}`));

    const dueDateObj = typeof params.dueDate === "string" ? new Date(params.dueDate) : params.dueDate;

    const liabilityRecord: LiabilityDbRecord = {
      company_id: companyId,
      account_id: params.accountId,
      vendor_id: params.vendorId,
      title: params.title,
      category: params.category || "SAAS",
      amount_usdc: amountNum,
      due_date: dueDateObj,
      frequency_cron: params.frequencyCron || "0 0 1 * *",
      payout_address: payoutAddr,
      source_po_hash: poHash,
      source_invoice_hash: invHash,
      status: "SCHEDULED",
      preferred_payment_rail: params.preferredPaymentRail || (params.serviceUrl ? "GATEWAY_X402" : "DISBURSAL_VAULT"),
      payment_rail_config: params.paymentRailConfig || {},
      disbursal_rules: params.disbursalRules || {
        autoPayThresholdUsdc: 500,
        requireThreeWayMatch: true,
        preFlightLeadTimeHours: 48,
      },
      waterfall_override: params.waterfallOverride || null,
    };

    const saved = await LiabilityRepo.createLiability(liabilityRecord);

    // Re-anchor Dynamic Record 2 immediately
    await this.dynamicRecords.calculateSafeToInvest(params.accountId);

    // Audit Logging
    await AuditLogRepo.appendAuditLog({
      account_id: params.accountId,
      action_type: "LIABILITY_SCHEDULED",
      amount_usdc: amountNum,
      is_autonomous: false,
      reason: `Liability '${params.title}' scheduled for vendor '${params.vendorId}'. Rail: ${saved.preferred_payment_rail}`,
      pre_state_snapshot: {},
      post_state_snapshot: saved as any,
      actor_agent: "HUMAN_ADMIN",
    });

    return saved;
  }

  /**
   * Post-setup liability parameter updates. Re-anchors Dynamic Record 1 and recalculates Record 2.
   */
  public async updateLiability(
    companyId: string,
    liabilityId: string,
    params: Partial<CreateLiabilityParams>
  ): Promise<LiabilityDbRecord> {
    const existing = await LiabilityRepo.getLiabilityByIdAndCompany(liabilityId, companyId);
    if (!existing) {
      throw new Error(`LIABILITY_NOT_FOUND: Liability '${liabilityId}' does not exist for company '${companyId}'.`);
    }

    // If changing account, verify new account belongs to company
    if (params.accountId && params.accountId !== existing.account_id) {
      const newAcc = await TreasuryAccountsRepo.getAccountByIdAndCompany(params.accountId, companyId);
      if (!newAcc) {
        throw new Error(`LIABILITY_ATTACHMENT_ERROR: Target account '${params.accountId}' not found for company '${companyId}'.`);
      }
    }

    if (params.amountUsdc !== undefined) {
      const amountNum = Number(params.amountUsdc);
      if (isNaN(amountNum) || amountNum <= 0) {
        throw new Error("LOUD_ROUNDING_ERROR (Rule 5): Liability amount must be strictly positive.");
      }
      const decParts = amountNum.toString().split(".");
      if (decParts.length === 2 && decParts[1].length > 6) {
        throw new Error(`LOUD_ROUNDING_ERROR (Rule 5): Amount '${params.amountUsdc}' exceeds 6-decimal precision.`);
      }
    }

    const updates: Partial<LiabilityDbRecord> = {};
    if (params.accountId) updates.account_id = params.accountId;
    if (params.vendorId) updates.vendor_id = params.vendorId;
    if (params.title) updates.title = params.title;
    if (params.category) updates.category = params.category;
    if (params.amountUsdc !== undefined) updates.amount_usdc = Number(params.amountUsdc);
    if (params.dueDate) updates.due_date = typeof params.dueDate === "string" ? new Date(params.dueDate) : params.dueDate;
    if (params.frequencyCron !== undefined) updates.frequency_cron = params.frequencyCron;
    if (params.payoutAddress) updates.payout_address = params.payoutAddress;
    if (params.preferredPaymentRail) updates.preferred_payment_rail = params.preferredPaymentRail;
    if (params.paymentRailConfig) updates.payment_rail_config = params.paymentRailConfig;
    if (params.disbursalRules) updates.disbursal_rules = params.disbursalRules;
    if (params.waterfallOverride !== undefined) updates.waterfall_override = params.waterfallOverride;

    const saved = await LiabilityRepo.updateLiability(liabilityId, companyId, updates);
    if (!saved) {
      throw new Error(`LIABILITY_UPDATE_FAILED: Failed to update liability '${liabilityId}'.`);
    }

    // Re-anchor Dynamic Record 2 for the affected account(s)
    await this.dynamicRecords.calculateSafeToInvest(existing.account_id);
    if (params.accountId && params.accountId !== existing.account_id) {
      await this.dynamicRecords.calculateSafeToInvest(params.accountId);
    }

    // Audit Logging
    await AuditLogRepo.appendAuditLog({
      account_id: saved.account_id,
      action_type: "LIABILITY_UPDATED",
      amount_usdc: saved.amount_usdc,
      is_autonomous: false,
      reason: `Liability '${liabilityId}' parameters modified by organization administrator.`,
      pre_state_snapshot: existing as any,
      post_state_snapshot: saved as any,
      actor_agent: "HUMAN_ADMIN",
    });

    return saved;
  }

  /**
   * Cancels a recurring liability.
   * Strict Invariant: Records are never deleted. Status is set to CANCELLED and task memo is recorded.
   */
  public async cancelLiability(
    companyId: string,
    liabilityId: string,
    adminInstruction: string
  ): Promise<LiabilityDbRecord> {
    const existing = await LiabilityRepo.getLiabilityByIdAndCompany(liabilityId, companyId);
    if (!existing) {
      throw new Error(`LIABILITY_NOT_FOUND: Liability '${liabilityId}' does not exist for company '${companyId}'.`);
    }

    const mergedRules = {
      ...(existing.disbursal_rules || {}),
      cancellationMemo: adminInstruction,
      cancelledAt: new Date().toISOString(),
      cancelledBy: "HUMAN_ADMIN",
    };

    const updated = await LiabilityRepo.updateLiability(liabilityId, companyId, {
      status: "CANCELLED",
      disbursal_rules: mergedRules,
    });

    if (!updated) {
      throw new Error(`LIABILITY_CANCEL_FAILED: Failed to cancel liability '${liabilityId}'.`);
    }

    // Re-anchor Dynamic Record 2 (releases reserved operating funds)
    await this.dynamicRecords.calculateSafeToInvest(existing.account_id);

    // Audit Logging
    await AuditLogRepo.appendAuditLog({
      account_id: existing.account_id,
      action_type: "LIABILITY_CANCELLED",
      amount_usdc: existing.amount_usdc,
      is_autonomous: false,
      reason: `Liability '${existing.title}' cancelled by admin. Instruction: ${adminInstruction}`,
      pre_state_snapshot: { status: existing.status },
      post_state_snapshot: { status: "CANCELLED", cancellationMemo: adminInstruction },
      actor_agent: "HUMAN_ADMIN",
    });

    return updated;
  }

  /**
   * Lists liabilities for a company with optional filters.
   */
  public async listLiabilities(
    companyId: string,
    filter?: { accountId?: string; status?: LiabilityStatus }
  ): Promise<LiabilityDbRecord[]> {
    return await LiabilityRepo.getLiabilitiesByCompany(companyId, filter);
  }
}
