import { DbClient } from "../dbClient.js";

export interface MovementPolicyRecord {
  policy_id: string;
  company_id?: string;
  name: string;
  priority_order: string[]; // Order of account IDs to drain/borrow from
  protected_accounts: string[]; // Strictly non-drainable accounts
  cross_account_borrowing_enabled: boolean;
  max_borrowing_ratio: number;
  human_approval_threshold_usdc: number;
  created_at?: Date;
  updated_at?: Date;
}

export interface MultiAccountAllocationResult {
  allocations: Array<{
    accountId: string;
    amountUsdc: number;
    isPrimary: boolean;
  }>;
  totalAllocatedUsdc: number;
  unmetShortfallUsdc: number;
  requiresHumanApproval: boolean;
  approvalReason?: string;
}

export class MovementPolicyRepo {
  public static async upsertPolicy(policy: MovementPolicyRecord): Promise<MovementPolicyRecord> {
    const text = `
      INSERT INTO movement_policies (
        policy_id, company_id, name, priority_order, protected_accounts,
        cross_account_borrowing_enabled, max_borrowing_ratio,
        human_approval_threshold_usdc, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT (policy_id) DO UPDATE SET
        company_id = EXCLUDED.company_id,
        name = EXCLUDED.name,
        priority_order = EXCLUDED.priority_order,
        protected_accounts = EXCLUDED.protected_accounts,
        cross_account_borrowing_enabled = EXCLUDED.cross_account_borrowing_enabled,
        max_borrowing_ratio = EXCLUDED.max_borrowing_ratio,
        human_approval_threshold_usdc = EXCLUDED.human_approval_threshold_usdc,
        updated_at = NOW()
      RETURNING *;
    `;
    const values = [
      policy.policy_id,
      policy.company_id || "default_org",
      policy.name,
      JSON.stringify(policy.priority_order || []),
      JSON.stringify(policy.protected_accounts || []),
      policy.cross_account_borrowing_enabled,
      policy.max_borrowing_ratio,
      policy.human_approval_threshold_usdc,
    ];

    const result = await DbClient.query<MovementPolicyRecord>(text, values);
    const row = result.rows[0];
    return {
      ...row,
      company_id: row.company_id || "default_org",
      human_approval_threshold_usdc: Number(row.human_approval_threshold_usdc),
      max_borrowing_ratio: Number(row.max_borrowing_ratio),
    };
  }

  public static async getPolicyById(policyId: string): Promise<MovementPolicyRecord | null> {
    const text = `SELECT * FROM movement_policies WHERE policy_id = $1 LIMIT 1;`;
    const result = await DbClient.query<MovementPolicyRecord>(text, [policyId]);
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      ...row,
      human_approval_threshold_usdc: Number(row.human_approval_threshold_usdc),
      max_borrowing_ratio: Number(row.max_borrowing_ratio),
    };
  }

  public static async getPolicyForCompany(companyId: string): Promise<MovementPolicyRecord | null> {
    const text = `SELECT * FROM movement_policies WHERE company_id = $1 ORDER BY updated_at DESC LIMIT 1;`;
    const result = await DbClient.query<MovementPolicyRecord>(text, [companyId]);
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      ...row,
      company_id: row.company_id || "default_org",
      human_approval_threshold_usdc: Number(row.human_approval_threshold_usdc),
      max_borrowing_ratio: Number(row.max_borrowing_ratio),
    };
  }

  public static async getPoliciesByCompany(companyId: string): Promise<MovementPolicyRecord[]> {
    const text = `SELECT * FROM movement_policies WHERE company_id = $1 ORDER BY updated_at DESC;`;
    const result = await DbClient.query<MovementPolicyRecord>(text, [companyId]);
    return result.rows.map((row) => ({
      ...row,
      company_id: row.company_id || "default_org",
      human_approval_threshold_usdc: Number(row.human_approval_threshold_usdc),
      max_borrowing_ratio: Number(row.max_borrowing_ratio),
    }));
  }

  public static async getDefaultPolicy(): Promise<MovementPolicyRecord> {
    const existing = await this.getPolicyById("default_movement_policy");
    if (existing) return existing;

    return await this.upsertPolicy({
      policy_id: "default_movement_policy",
      name: "Standard Corporate Inter-Account Movement Policy",
      priority_order: ["acc_engineering", "acc_marketing", "acc_general_treasury"],
      protected_accounts: ["acc_payroll"],
      cross_account_borrowing_enabled: true,
      max_borrowing_ratio: 0.50,
      human_approval_threshold_usdc: 1000.0,
    });
  }

  /**
   * Evaluates a multi-account draw according to the movement policy.
   * Strictly respects protected accounts and computes exact allocations per cost center.
   */
  public static async computeMultiAccountFunding(params: {
    primaryAccountId: string;
    totalAmountUsdc: number;
    accountBalances: Record<string, number>;
    policyId?: string;
  }): Promise<MultiAccountAllocationResult> {
    let policy: MovementPolicyRecord | null = null;
    if (params.policyId) {
      policy = await this.getPolicyById(params.policyId);
    }
    if (!policy) {
      const res = await DbClient.query<MovementPolicyRecord>(
        `SELECT * FROM movement_policies 
         WHERE priority_order::text ILIKE $1 OR protected_accounts::text ILIKE $1
         ORDER BY created_at DESC LIMIT 1;`,
        [`%${params.primaryAccountId}%`]
      );
      if (res.rows.length > 0) {
        policy = {
          ...res.rows[0],
          human_approval_threshold_usdc: Number(res.rows[0].human_approval_threshold_usdc),
          max_borrowing_ratio: Number(res.rows[0].max_borrowing_ratio),
        };
      }
    }
    if (!policy) {
      policy = await this.getDefaultPolicy();
    }

    const { primaryAccountId, totalAmountUsdc, accountBalances } = params;
    const protectedSet = new Set(policy.protected_accounts.map((a) => a.toLowerCase()));

    // Rule: Protected accounts cannot fund external draws
    if (protectedSet.has(primaryAccountId.toLowerCase())) {
      // If primary is payroll, it can ONLY disburse its own payroll obligations, never take secondary draws
    }

    const allocations: Array<{ accountId: string; amountUsdc: number; isPrimary: boolean }> = [];
    let remaining = totalAmountUsdc;

    // 1. Primary account funds first
    const primaryBalance = accountBalances[primaryAccountId] || 0;
    const primaryDraw = Math.min(primaryBalance, remaining);
    if (primaryDraw > 0) {
      allocations.push({
        accountId: primaryAccountId,
        amountUsdc: Number(primaryDraw.toFixed(6)),
        isPrimary: true,
      });
      remaining = Number((remaining - primaryDraw).toFixed(6));
    }

    // 2. If covered by primary, return immediately
    if (remaining <= 0) {
      return {
        allocations,
        totalAllocatedUsdc: totalAmountUsdc,
        unmetShortfallUsdc: 0,
        requiresHumanApproval: false,
      };
    }

    // 3. Multi-account draw required: Consult Movement Policy
    if (!policy.cross_account_borrowing_enabled) {
      return {
        allocations,
        totalAllocatedUsdc: primaryDraw,
        unmetShortfallUsdc: remaining,
        requiresHumanApproval: true,
        approvalReason: "Cross-account borrowing is disabled by Movement Policy.",
      };
    }

    // Iterate through priority order (excluding protected accounts and primary)
    for (const candidateId of policy.priority_order) {
      if (candidateId === primaryAccountId) continue;
      if (protectedSet.has(candidateId.toLowerCase())) continue; // NEVER draw protected accounts (Payroll)

      const candidateBalance = accountBalances[candidateId] || 0;
      if (candidateBalance <= 0) continue;

      const secondaryDraw = Math.min(candidateBalance, remaining);
      if (secondaryDraw > 0) {
        allocations.push({
          accountId: candidateId,
          amountUsdc: Number(secondaryDraw.toFixed(6)),
          isPrimary: false,
        });
        remaining = Number((remaining - secondaryDraw).toFixed(6));
      }

      if (remaining <= 0) break;
    }

    // If remaining shortfall exists and borrowing is permitted, fund from other non-protected accounts
    if (remaining > 0) {
      for (const [candidateId, candidateBalance] of Object.entries(accountBalances)) {
        if (candidateId === primaryAccountId) continue;
        if (protectedSet.has(candidateId.toLowerCase())) continue; // NEVER draw protected accounts (Payroll)
        if (allocations.some((a) => a.accountId === candidateId)) continue;
        if (candidateBalance <= 0) continue;

        const secondaryDraw = Math.min(candidateBalance, remaining);
        if (secondaryDraw > 0) {
          allocations.push({
            accountId: candidateId,
            amountUsdc: Number(secondaryDraw.toFixed(6)),
            isPrimary: false,
          });
          remaining = Number((remaining - secondaryDraw).toFixed(6));
        }

        if (remaining <= 0) break;
      }
    }

    const secondaryTotal = allocations
      .filter((a) => !a.isPrimary)
      .reduce((sum, a) => sum + a.amountUsdc, 0);

    const requiresHumanApproval =
      secondaryTotal > policy.human_approval_threshold_usdc || remaining > 0;

    return {
      allocations,
      totalAllocatedUsdc: Number((totalAmountUsdc - remaining).toFixed(6)),
      unmetShortfallUsdc: remaining,
      requiresHumanApproval,
      approvalReason: requiresHumanApproval
        ? `Cross-account secondary draw ($${secondaryTotal.toFixed(2)} USDC) exceeds movement policy threshold ($${policy.human_approval_threshold_usdc} USDC) or shortfall exists.`
        : undefined,
    };
  }
}
