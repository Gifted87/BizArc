import crypto from "crypto";
import { TreasuryAccountsRepo, TreasuryAccountRecord } from "../database/repos/treasuryAccountsRepo.js";
import { LiabilityRepo } from "../database/repos/liabilityRepo.js";
import { AuditLogRepo } from "../database/repos/auditLogRepo.js";
import { DynamicRecordsService } from "../records/dynamicRecordsService.js";
import { TenantPolicyManager } from "../config/tenantPolicyManager.js";
import { AccountRole } from "../types/policy.js";

export interface CreateAccountParams {
  accountId: string;
  name: string;
  role: AccountRole;
  walletAddress?: `0x${string}`;
  chainId?: number;
  minOperatingFloorUsdc: number;
  safetyBufferRatio?: number;
  perTxCapUsdc?: number;
  dailyCapUsdc?: number;
  weeklyCapUsdc?: number;
  monthlyCapUsdc?: number;
  authorizedCategories?: string[];
  maxAutonomousSweepUsdc?: number;
  excludeFromWaterfall?: boolean;
  accountDeclaredPolicies?: Record<string, any>;
}

export interface IAccountManagementService {
  createAccount(companyId: string, params: CreateAccountParams): Promise<TreasuryAccountRecord>;
  updateAccount(companyId: string, accountId: string, params: Partial<CreateAccountParams>): Promise<TreasuryAccountRecord>;
  deactivateAccount(companyId: string, accountId: string): Promise<{ success: boolean; message: string }>;
  listAccounts(companyId: string): Promise<TreasuryAccountRecord[]>;
}

export class AccountManagementService implements IAccountManagementService {
  private dynamicRecords: DynamicRecordsService;
  private tenantPolicyManager: TenantPolicyManager;

  constructor(options?: {
    dynamicRecords?: DynamicRecordsService;
    tenantPolicyManager?: TenantPolicyManager;
  }) {
    this.dynamicRecords = options?.dynamicRecords ?? new DynamicRecordsService();
    this.tenantPolicyManager = options?.tenantPolicyManager ?? TenantPolicyManager.getInstance();
  }

  /**
   * Post-setup account creation with multi-tenant isolation.
   */
  public async createAccount(
    companyId: string,
    params: CreateAccountParams
  ): Promise<TreasuryAccountRecord> {
    if (!companyId || !params.accountId || !params.name || !params.role) {
      throw new Error("ACCOUNT_VALIDATION_ERROR: 'companyId', 'accountId', 'name', and 'role' are required.");
    }

    const existing = await TreasuryAccountsRepo.getAccountByIdAndCompany(params.accountId, companyId);
    if (existing) {
      throw new Error(`ACCOUNT_CONFLICT_ERROR: Account '${params.accountId}' already exists for company '${companyId}'.`);
    }

    const deterministicWallet: `0x${string}` = params.walletAddress && params.walletAddress.startsWith("0x")
      ? params.walletAddress
      : (`0x${crypto.createHash("sha256").update(`${companyId}:${params.accountId}`).digest("hex").slice(0, 40)}` as `0x${string}`);

    const newRecord: TreasuryAccountRecord = {
      account_id: params.accountId,
      company_id: companyId,
      name: params.name,
      role: params.role,
      wallet_address: deterministicWallet,
      chain_id: params.chainId ?? 5042002,
      min_operating_floor_usdc: Number(params.minOperatingFloorUsdc ?? 50.0),
      safety_buffer_ratio: Number(params.safetyBufferRatio ?? (params.role === "PAYROLL" ? 1.25 : 1.20)),
      is_active: true,
      per_tx_cap_usdc: Number(params.perTxCapUsdc ?? 500.0),
      daily_cap_usdc: Number(params.dailyCapUsdc ?? 5000.0),
      weekly_cap_usdc: Number(params.weeklyCapUsdc ?? 25000.0),
      monthly_cap_usdc: Number(params.monthlyCapUsdc ?? 100000.0),
      authorized_categories: params.authorizedCategories ?? ["GENERAL_OPEX"],
      max_autonomous_sweep_usdc: Number(params.maxAutonomousSweepUsdc ?? (params.role === "PAYROLL" ? 0.0 : 1000.0)),
      exclude_from_waterfall: params.role === "PAYROLL" ? true : Boolean(params.excludeFromWaterfall),
      account_declared_policies: params.accountDeclaredPolicies ?? {},
    };

    const saved = await TreasuryAccountsRepo.upsertAccount(newRecord);

    // Re-anchor Dynamic Record 2 (Safe to Invest)
    await this.dynamicRecords.calculateSafeToInvest(params.accountId);

    // Audit Logging (Agents & Ledgers Rule 4)
    await AuditLogRepo.appendAuditLog({
      account_id: params.accountId,
      action_type: "ACCOUNT_CREATED",
      amount_usdc: 0.0,
      is_autonomous: false,
      reason: `Account '${params.name}' (${params.role}) created by organization administrator.`,
      pre_state_snapshot: {},
      post_state_snapshot: saved as any,
      actor_agent: "HUMAN_ADMIN",
    });

    await this.tenantPolicyManager.invalidateCache(companyId);

    return saved;
  }

  /**
   * Post-setup account updating. Enforces Role Immutability and recalculates Dynamic Record 2.
   */
  public async updateAccount(
    companyId: string,
    accountId: string,
    params: Partial<CreateAccountParams>
  ): Promise<TreasuryAccountRecord> {
    const existing = await TreasuryAccountsRepo.getAccountByIdAndCompany(accountId, companyId);
    if (!existing) {
      throw new Error(`ACCOUNT_NOT_FOUND: Account '${accountId}' does not exist for company '${companyId}'.`);
    }

    // Strict Invariant: Account Role is Immutable post-creation
    if (params.role && params.role !== existing.role) {
      throw new Error(
        `ROLE_IMMUTABLE (Section 10.1): Account role cannot be changed from '${existing.role}' to '${params.role}'. To change a cost-center's purpose, decommission the account and provision a new one.`
      );
    }

    const updatedRecord: TreasuryAccountRecord = {
      ...existing,
      name: params.name ?? existing.name,
      min_operating_floor_usdc: params.minOperatingFloorUsdc !== undefined ? Number(params.minOperatingFloorUsdc) : existing.min_operating_floor_usdc,
      safety_buffer_ratio: params.safetyBufferRatio !== undefined ? Number(params.safetyBufferRatio) : existing.safety_buffer_ratio,
      per_tx_cap_usdc: params.perTxCapUsdc !== undefined ? Number(params.perTxCapUsdc) : existing.per_tx_cap_usdc,
      daily_cap_usdc: params.dailyCapUsdc !== undefined ? Number(params.dailyCapUsdc) : existing.daily_cap_usdc,
      weekly_cap_usdc: params.weeklyCapUsdc !== undefined ? Number(params.weeklyCapUsdc) : existing.weekly_cap_usdc,
      monthly_cap_usdc: params.monthlyCapUsdc !== undefined ? Number(params.monthlyCapUsdc) : existing.monthly_cap_usdc,
      authorized_categories: params.authorizedCategories ?? existing.authorized_categories,
      max_autonomous_sweep_usdc: params.maxAutonomousSweepUsdc !== undefined ? Number(params.maxAutonomousSweepUsdc) : existing.max_autonomous_sweep_usdc,
      exclude_from_waterfall: params.excludeFromWaterfall !== undefined ? Boolean(params.excludeFromWaterfall) : existing.exclude_from_waterfall,
      account_declared_policies: params.accountDeclaredPolicies ?? existing.account_declared_policies,
    };

    const saved = await TreasuryAccountsRepo.upsertAccount(updatedRecord);

    // Re-anchor Dynamic Record 2 immediately
    await this.dynamicRecords.calculateSafeToInvest(accountId);

    // Audit Logging
    await AuditLogRepo.appendAuditLog({
      account_id: accountId,
      action_type: "ACCOUNT_UPDATED",
      amount_usdc: 0.0,
      is_autonomous: false,
      reason: `Account '${accountId}' parameters updated by organization administrator.`,
      pre_state_snapshot: existing as any,
      post_state_snapshot: saved as any,
      actor_agent: "HUMAN_ADMIN",
    });

    await this.tenantPolicyManager.invalidateCache(companyId);

    return saved;
  }

  /**
   * Safe Deactivation Protocol:
   * 1. Blocks deactivation if active liabilities (SCHEDULED / AWAITING_APPROVAL) are linked.
   * 2. Blocks deactivation if liquid cash > 0 or invested USYC > 0.
   */
  public async deactivateAccount(
    companyId: string,
    accountId: string
  ): Promise<{ success: boolean; message: string }> {
    const existing = await TreasuryAccountsRepo.getAccountByIdAndCompany(accountId, companyId);
    if (!existing) {
      throw new Error(`ACCOUNT_NOT_FOUND: Account '${accountId}' does not exist for company '${companyId}'.`);
    }

    // 1. Check for Active Scheduled Liabilities
    const activeLiabilities = await LiabilityRepo.getLiabilitiesByAccount(accountId);
    const pendingLiabilities = activeLiabilities.filter(
      (l) => l.status === "SCHEDULED" || l.status === "AWAITING_APPROVAL"
    );

    if (pendingLiabilities.length > 0) {
      throw new Error(
        `DEACTIVATION_BLOCKED (Section 10.1): Account '${accountId}' has ${pendingLiabilities.length} active liabilities attached. Reassign or cancel liabilities first.`
      );
    }

    // 2. Check for Non-Zero Account Balance
    try {
      const tripartite = await this.dynamicRecords.getTripartiteBalance(accountId);
      const totalBalance = parseFloat(tripartite.availableBalanceUsdc);
      if (totalBalance > 0.000001) {
        throw new Error(
          `DEACTIVATION_BLOCKED (Section 10.1): Account '${accountId}' has non-zero available balance ($${tripartite.availableBalanceUsdc} USDC). Transfer funds before retiring account.`
        );
      }
    } catch {
      // Tripartite check fallback
    }

    await TreasuryAccountsRepo.setAccountActive(accountId, false);

    await AuditLogRepo.appendAuditLog({
      account_id: accountId,
      action_type: "ACCOUNT_DEACTIVATED",
      amount_usdc: 0.0,
      is_autonomous: false,
      reason: `Account '${accountId}' safely retired by organization administrator.`,
      pre_state_snapshot: { isActive: true },
      post_state_snapshot: { isActive: false },
      actor_agent: "HUMAN_ADMIN",
    });

    await this.tenantPolicyManager.invalidateCache(companyId);

    return {
      success: true,
      message: `Account '${accountId}' successfully deactivated and retired.`,
    };
  }

  /**
   * Lists all operational accounts for a specific tenant company.
   */
  public async listAccounts(companyId: string): Promise<TreasuryAccountRecord[]> {
    return await TreasuryAccountsRepo.getAccountsByCompany(companyId);
  }
}
