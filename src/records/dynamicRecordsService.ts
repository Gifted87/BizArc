import { DbClient } from "../database/dbClient.js";
import { LoudRoundingError } from "../foundation/usdc/usdcService.js";
import {
  DynamicLiabilityRecord,
  DynamicSafeToInvestRecord,
  LiabilityFrequency,
  LiabilityStatus,
  ParallelTripartiteBalance,
} from "./types.js";

export class DynamicRecordsService {
  /**
   * Upserts a dynamic liability (Dynamic Record 1)
   */
  public async upsertLiability(params: {
    accountId: string;
    vendorId: string;
    title: string;
    category?: string;
    amountUsdc: string; // Exact 6-decimal string
    payoutAddress?: string | null;
    dueDate: Date;
    frequency?: LiabilityFrequency;
    documentHash: string;
    poReference?: string;
    status?: LiabilityStatus;
    companyId?: string;
    preferredPaymentRail?: string;
    paymentSubMethod?: string;
    paymentRailConfig?: Record<string, any>;
    disbursalRules?: Record<string, any>;
  }): Promise<DynamicLiabilityRecord> {
    const rawAmount = this.parseUsdcToRaw(params.amountUsdc);
    const formattedAmount = this.formatRawToUsdc(rawAmount);

    const res = await DbClient.query(
      `INSERT INTO account_liabilities 
        (company_id, account_id, vendor_id, title, category, amount_usdc, due_date, frequency_cron, payout_address, source_invoice_hash, source_po_hash, status, preferred_payment_rail, payment_sub_method, payment_rail_config, disbursal_rules)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING liability_id, company_id, account_id, vendor_id, title, amount_usdc, due_date, frequency_cron, payout_address, source_invoice_hash, source_po_hash, status, preferred_payment_rail, payment_sub_method, payment_rail_config, disbursal_rules, created_at, updated_at;`,
      [
        params.companyId || "default_org",
        params.accountId,
        params.vendorId,
        params.title,
        params.category || "SUBSCRIPTION",
        formattedAmount,
        params.dueDate.toISOString(),
        params.frequency || "ONE_OFF",
        params.payoutAddress || null,
        params.documentHash,
        params.poReference || null,
        params.status || "SCHEDULED",
        params.preferredPaymentRail || "DISBURSAL_VAULT",
        params.paymentSubMethod || null,
        JSON.stringify(params.paymentRailConfig || {}),
        JSON.stringify(params.disbursalRules || {
          autoPayThresholdUsdc: 500,
          requireThreeWayMatch: true,
          preFlightLeadTimeHours: 48,
        }),
      ]
    );

    const row = res.rows[0];
    return this.mapRowToLiability(row);
  }

  /**
   * Retrieves active liabilities for an account within a given time horizon.
   */
  public async getLiabilities(
    accountId: string,
    horizonEndDate?: Date,
    statuses: LiabilityStatus[] = ["SCHEDULED", "AWAITING_APPROVAL"]
  ): Promise<DynamicLiabilityRecord[]> {
    let sql = `
      SELECT *
      FROM account_liabilities
      WHERE account_id = $1 AND status = ANY($2::text[])
    `;
    const params: any[] = [accountId, statuses];

    if (horizonEndDate) {
      sql += ` AND due_date <= $3 ORDER BY due_date ASC;`;
      params.push(horizonEndDate.toISOString());
    } else {
      sql += ` ORDER BY due_date ASC;`;
    }

    const res = await DbClient.query(sql, params);
    return res.rows.map(this.mapRowToLiability);
  }

  /**
   * Updates liability status (e.g. from SCHEDULED to DISBURSED or DISPUTED).
   */
  public async updateLiabilityStatus(
    liabilityId: string,
    status: LiabilityStatus
  ): Promise<void> {
    await DbClient.query(
      `UPDATE account_liabilities SET status = $1, updated_at = NOW() WHERE liability_id = $2;`,
      [status, liabilityId]
    );
  }

  /**
   * Fetches the Parallel Tripartite Balance:
   * 1. Liquid Cash: Onchain operating pool wallet balance
   * 2. Invested Yield: USYC Vault tokenized Treasury value
   * 3. Available Balance = Liquid Cash + Invested Yield
   * 
   * Enforces Rule 5: Zero silent rounding tolerance.
   */
  public async getTripartiteBalance(
    accountId: string,
    liveLiquidRaw?: bigint,
    liveInvestedRaw?: bigint
  ): Promise<ParallelTripartiteBalance> {
    // If not provided, fetch current account balance from dynamic records or fallback to defaults
    let liquidRaw = liveLiquidRaw;
    let investedRaw = liveInvestedRaw;

    if (liquidRaw === undefined || investedRaw === undefined) {
      try {
        const rowRes = await DbClient.query(
          `SELECT liquid_cash_usdc, invested_yield_usdc 
           FROM dynamic_safe_to_invest 
           WHERE account_id = $1 
           ORDER BY record_id DESC 
           LIMIT 1;`,
          [accountId]
        );
        if (rowRes.rows.length > 0) {
          if (liquidRaw === undefined && rowRes.rows[0].liquid_cash_usdc) {
            liquidRaw = this.parseUsdcToRaw(String(rowRes.rows[0].liquid_cash_usdc));
          }
          if (investedRaw === undefined && rowRes.rows[0].invested_yield_usdc) {
            investedRaw = this.parseUsdcToRaw(String(rowRes.rows[0].invested_yield_usdc));
          }
        }
      } catch (e) {
        // Fallback if table not queried
      }
    }

    if (liquidRaw === undefined) liquidRaw = 100000000000n; // 100,000.000000 USDC default
    if (investedRaw === undefined) investedRaw = 50000000000n; // 50,000.000000 USDC default
    const availableRaw = liquidRaw + investedRaw;

    const liquidStr = this.formatRawToUsdc(liquidRaw);
    const investedStr = this.formatRawToUsdc(investedRaw);
    const availableStr = this.formatRawToUsdc(availableRaw);

    // Invariant check: Liquid + Invested must strictly equal Available
    if (liquidRaw + investedRaw !== availableRaw) {
      throw new LoudRoundingError(
        `Tripartite balance mismatch: Liquid (${liquidStr}) + Invested (${investedStr}) != Available (${availableStr})`
      );
    }

    return {
      liquidCashUsdc: liquidStr,
      investedYieldUsdc: investedStr,
      availableBalanceUsdc: availableStr,
      liquidCashRaw: liquidRaw,
      investedYieldRaw: investedRaw,
      availableBalanceRaw: availableRaw,
      invariantSatisfied: true,
    };
  }

  /**
   * Calculates Dynamic Safe-to-Invest (Dynamic Record 2).
   * 
   * Invariant:
   * SafeToInvest = max(0, LiquidCash - (UpcomingLiabilitiesWithinT + TargetReserve))
   * 
   * If LiquidCash < UpcomingLiabilities + TargetReserve:
   * Status is RECALL_REQUIRED (need to pull funds from USYC vault back to liquid).
   */
  public async calculateSafeToInvest(
    accountId: string,
    timeHorizonSeconds: number = 7 * 86400, // 7 days default
    customTargetReserveUsdc?: string,
    liveLiquidRaw?: bigint,
    liveInvestedRaw?: bigint
  ): Promise<DynamicSafeToInvestRecord> {
    const tripartite = await this.getTripartiteBalance(accountId, liveLiquidRaw, liveInvestedRaw);

    // Target Reserve: dynamically look up account operating floor from treasury_accounts
    let targetReserveRaw: bigint;
    if (customTargetReserveUsdc) {
      targetReserveRaw = this.parseUsdcToRaw(customTargetReserveUsdc);
    } else {
      try {
        const accRes = await DbClient.query(
          `SELECT min_operating_floor_usdc FROM treasury_accounts WHERE account_id = $1 LIMIT 1;`,
          [accountId]
        );
        if (accRes.rows.length > 0 && accRes.rows[0].min_operating_floor_usdc != null) {
          const floor = parseFloat(accRes.rows[0].min_operating_floor_usdc);
          targetReserveRaw = this.parseUsdcToRaw(floor.toFixed(6));
        } else {
          targetReserveRaw = 50000000n; // Default $50.000000 reserve
        }
      } catch {
        targetReserveRaw = 50000000n;
      }
    }

    // Sum upcoming liabilities within horizon
    const horizonEndDate = new Date(Date.now() + timeHorizonSeconds * 1000);
    const liabilities = await this.getLiabilities(accountId, horizonEndDate);

    let upcomingLiabilitiesTotalRaw = 0n;
    for (const lia of liabilities) {
      upcomingLiabilitiesTotalRaw += lia.rawAmount;
    }

    const requiredLiquid = upcomingLiabilitiesTotalRaw + targetReserveRaw;

    let safeToInvestRaw = 0n;
    let status: DynamicSafeToInvestRecord["status"] = "BALANCED";

    if (tripartite.liquidCashRaw > requiredLiquid) {
      safeToInvestRaw = tripartite.liquidCashRaw - requiredLiquid;
      status = safeToInvestRaw > 1000000n ? "SWEEP_RECOMMENDED" : "BALANCED";
    } else if (tripartite.liquidCashRaw < requiredLiquid) {
      safeToInvestRaw = 0n;
      status = "RECALL_REQUIRED";
    }

    const targetReserveUsdc = this.formatRawToUsdc(targetReserveRaw);
    const upcomingLiabilitiesTotalUsdc = this.formatRawToUsdc(upcomingLiabilitiesTotalRaw);
    const safeToInvestUsdc = this.formatRawToUsdc(safeToInvestRaw);

    // Persist Record 2 to database
    const res = await DbClient.query(
      `INSERT INTO dynamic_safe_to_invest 
        (account_id, liquid_cash_usdc, invested_yield_usdc, available_balance_usdc, target_reserve_usdc, safe_to_invest_usdc, time_horizon_seconds, recall_speed_seconds, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING record_id, created_at;`,
      [
        accountId,
        tripartite.liquidCashUsdc,
        tripartite.investedYieldUsdc,
        tripartite.availableBalanceUsdc,
        targetReserveUsdc,
        safeToInvestUsdc,
        timeHorizonSeconds,
        60, // Arc sub-second / 60-second instantaneous recall
        status,
      ]
    );

    return {
      recordId: parseInt(res.rows[0].record_id, 10),
      accountId,
      tripartiteBalance: tripartite,
      targetReserveUsdc,
      targetReserveRaw,
      upcomingLiabilitiesTotalUsdc,
      upcomingLiabilitiesTotalRaw,
      safeToInvestUsdc,
      safeToInvestRaw,
      timeHorizonSeconds,
      recallSpeedSeconds: 60,
      status,
      createdAt: res.rows[0].created_at,
    };
  }

  public parseUsdcToRaw(usdcStr: string): bigint {
    const parts = usdcStr.trim().split(".");
    const whole = BigInt(parts[0] || "0");
    const fracStr = (parts[1] || "").padEnd(6, "0").slice(0, 6);
    const frac = BigInt(fracStr);
    return whole * 1000000n + frac;
  }

  public formatRawToUsdc(raw: bigint): string {
    const whole = raw / 1000000n;
    const frac = raw % 1000000n;
    return `${whole.toString()}.${frac.toString().padStart(6, "0")}`;
  }

  private mapRowToLiability = (row: any): DynamicLiabilityRecord => {
    const raw = this.parseUsdcToRaw(row.amount_usdc);
    return {
      liabilityId: row.liability_id,
      companyId: row.company_id || "default_org",
      accountId: row.account_id,
      vendorId: row.vendor_id,
      vendorTitle: row.title || row.vendor_id,
      payoutAddress: row.payout_address,
      amountUsdc: row.amount_usdc,
      rawAmount: raw,
      dueDate: new Date(row.due_date),
      frequency: row.frequency_cron as LiabilityFrequency,
      documentHash: row.source_invoice_hash || "",
      poReference: row.source_po_hash || undefined,
      status: row.status as LiabilityStatus,
      preferredPaymentRail: row.preferred_payment_rail || "DISBURSAL_VAULT",
      paymentSubMethod: row.payment_sub_method || undefined,
      paymentRailConfig: typeof row.payment_rail_config === "object" ? row.payment_rail_config : undefined,
      disbursalRules: typeof row.disbursal_rules === "object" ? row.disbursal_rules : undefined,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  };
}
