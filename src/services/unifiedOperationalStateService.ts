import { DbClient } from "../database/dbClient.js";
import { UnifiedAssetAggregatorService, CompanyUnifiedAssetDistribution, BalanceOverrideMap, AccountAssetDistribution } from "./unifiedAssetAggregatorService.js";
import { DynamicRecordsService } from "../records/dynamicRecordsService.js";
import { DynamicLiabilityRecord, DynamicSafeToInvestRecord } from "../records/types.js";
import { ErpSyncRepo, ErpSyncRecord } from "../database/repos/erpSyncRepo.js";
import { MasterJournalRepo, MasterJournalRecord } from "../database/repos/masterJournalRepo.js";
import { AuditLogRepo, AccountAuditLogRecord } from "../database/repos/auditLogRepo.js";
import { PermissionRequestRepo, PermissionRequestRecord } from "../database/repos/permissionRequestRepo.js";
import { AccountLockManager } from "../foundation/events/lockManager.js";
import { PolicyLoader } from "../config/policyLoader.js";
import { LoudRoundingError } from "../foundation/usdc/usdcService.js";

export interface UnifiedOperationalStateOptions {
  accountId?: string;
  balanceOverrides?: BalanceOverrideMap;
  horizonDays?: number;
  includeAuditHistoryLimit?: number;
}

export interface UnifiedOperationalState {
  timestamp: string;
  activeProfile: string;
  currency: "USDC";

  // 1. Balance States (Tripartite Invariant: BL + BY = BE)
  balances: {
    totalLiquidUsdc: string;
    totalLiquidRaw: bigint;
    totalInvestedUsyc: string;
    totalInvestedRaw: bigint;
    totalEffectiveUsdc: string;
    totalEffectiveRaw: bigint;
    tripartiteInvariantVerified: boolean;
    solvencyHealth: {
      isSolvent: boolean;
      totalSurplusUsdc: string;
      totalSurplusRaw: bigint;
      healthRatio: number;
    };
    accounts: Array<{
      accountId: string;
      name: string;
      role: string;
      chain: string;
      walletAddress: string;
      liquidUsdc: string;
      liquidRaw: bigint;
      investedUsyc: string;
      investedRaw: bigint;
      totalEffectiveUsdc: string;
      totalEffectiveRaw: bigint;
      freeCapitalUsdc: string;
      freeCapitalRaw: bigint;
      safeToInvestUsdc: string;
      safeToInvestRaw: bigint;
      protectedReserveUsdc: string;
      protectedReserveRaw: bigint;
      excludeFromWaterfall: boolean;
      isActive: boolean;
    }>;
  };

  // 2. Liabilities (Dynamic Record 1)
  liabilities: {
    totalUpcoming30dUsdc: string;
    totalUpcoming30dRaw: bigint;
    totalOverdueUsdc: string;
    totalOverdueRaw: bigint;
    totalLiabilitiesCount: number;
    activeScheduledCount: number;
    disbursedCount: number;
    categoryBreakdown: Record<string, string>;
    upcomingItems: Array<{
      liabilityId: string;
      accountId: string;
      vendorId: string;
      title: string;
      category: string;
      amountUsdc: string;
      amountRaw: bigint;
      dueDate: string;
      isOverdue: boolean;
      status: string;
      payoutAddress: string;
    }>;
  };

  // 3. Safe-to-Invest Horizon (Dynamic Record 2)
  safeToInvestHorizon: {
    evaluationHorizonDays: number;
    totalProtectedReserveUsdc: string;
    totalProtectedReserveRaw: bigint;
    totalSafeToInvestUsdc: string;
    totalSafeToInvestRaw: bigint;
    totalFreeCapitalUsdc: string;
    totalFreeCapitalRaw: bigint;
    hysteresis: {
      investHysteresisBandUsdc: number;
      recallHysteresisBandUsdc: number;
      minSweepAmountUsdc: number;
    };
    accountRecords: Array<{
      accountId: string;
      operatingFloorUsdc: string;
      safetyBufferRatio: number;
      protectedReserveUsdc: string;
      safeToInvestUsdc: string;
      safeToInvestRaw: bigint;
      status: "SAFE_TO_INVEST" | "RECALL_REQUIRED" | "BALANCED";
    }>;
  };

  // 4. ERP Sync Status (D20.B)
  erpSyncStatus: {
    overallStatus: "SYNCED" | "DEGRADED" | "DESYNCHRONIZED";
    lastSyncTimestamp?: string;
    threeWayMatchIntegrity: boolean;
    unreconciledCount: number;
    erpNext: {
      status: "CONNECTED" | "DISCONNECTED";
      lastDocName?: string;
      syncedCount: number;
    };
    odoo: {
      status: "CONNECTED" | "DISCONNECTED";
      lastPaymentId?: number;
      syncedCount: number;
    };
    recentCheckpoints: Array<{
      syncId: string;
      systemType: string;
      accountId?: string;
      entityType: string;
      lastSyncTimestamp: string;
      lastSyncedDocumentId?: string;
      status: string;
      invoiceId?: string;
      txHash?: string;
      threeWayMatchVerified?: boolean;
    }>;
  };

  // 5. Audit State (D7 / D19d7)
  auditState: {
    masterJournal: {
      totalVouchersCount: number;
      currentSequenceId: number;
      headBlockHash: string;
      genesisPreviousHash: string;
      chainIntegrityVerified: boolean;
    };
    auditLog: {
      totalAuditEntries: number;
      autonomousActionsCount: number;
      humanSupervisedActionsCount: number;
      recentAuditEvents: Array<{
        logId?: string;
        accountId: string;
        actionType: string;
        amountUsdc: number;
        isAutonomous: boolean;
        txHash?: string;
        reason: string;
        createdAt: string;
      }>;
    };
  };

  // 6. Transaction State (D16 / D17 / D19)
  transactionState: {
    spendingLimits: {
      dailyHardCapUsdc: string;
      dailySpent24hUsdc: string;
      dailyRemainingUsdc: string;
      singleTxHumanThresholdUsdc: string;
    };
    pendingSprs: {
      count: number;
      requests: Array<{
        requestId: string;
        actionType: string;
        amountUsdc: number;
        reason: string;
        createdAt: string;
        conflictingPolicy?: string;
      }>;
    };
    authorizedIntents: {
      count: number;
      requests: Array<{
        requestId: string;
        actionType: string;
        amountUsdc: number;
        authorizedAt: string;
      }>;
    };
    activeAccountLocks: string[];
    settledDisbursals24hCount: number;
  };
}

/**
 * D20: UnifiedOperationalStateService (DAG Node D20 / Sentences 11, 13, 19, 20.B)
 * Synthesizes the 8 foundational dimensions of the Autonomous Treasury into a single canonical source of truth:
 * 1. Live Liquid Balances (BL)
 * 2. Tokenized USYC Invested Balances (BY)
 * 3. Total Effective Purchasing Power (BE = BL + BY)
 * 4. Upcoming & Committed Liabilities (Dynamic Record 1)
 * 5. Safe-to-Invest Liquidity Horizon (Dynamic Record 2)
 * 6. Document-Linked ERP Sync Status (ERPNext & Odoo)
 * 7. Cryptographic Ledger & Audit Chain Integrity (SHA-256 Sequential Master Journal)
 * 8. Active Swarm Transaction & Policy Governance State (SPRS, Approvals, Daily Caps)
 */
export class UnifiedOperationalStateService {
  private aggregator: UnifiedAssetAggregatorService;
  private dynamicRecords: DynamicRecordsService;

  constructor(options?: {
    aggregator?: UnifiedAssetAggregatorService;
    dynamicRecords?: DynamicRecordsService;
  }) {
    this.dynamicRecords = options?.dynamicRecords ?? new DynamicRecordsService();
    this.aggregator = options?.aggregator ?? new UnifiedAssetAggregatorService({ dynamicRecords: this.dynamicRecords });
  }

  /**
   * Retrieves the comprehensive Unified Operational State for the entire organization
   * or targeted to a specific account.
   */
  public async getUnifiedOperationalState(
    options?: UnifiedOperationalStateOptions
  ): Promise<UnifiedOperationalState> {
    const horizonDays = options?.horizonDays ?? 30;
    const activeProfileObj = PolicyLoader.getActiveProfile();
    const activeProfile = activeProfileObj.profileName;
    const profile = activeProfileObj.profile;

    // 1. Balance States & Distribution (D14 / UnifiedAssetAggregatorService)
    const companyDistribution: CompanyUnifiedAssetDistribution = await this.aggregator.aggregateCompanyAssets(
      options?.balanceOverrides
    );

    // Filter accounts if accountId requested
    const filteredAccounts = options?.accountId
      ? companyDistribution.accountsDistribution.filter((a) => a.accountId === options.accountId)
      : companyDistribution.accountsDistribution;

    // 2. Liabilities (Dynamic Record 1)
    const now = new Date();
    const horizonEnd = new Date(now.getTime() + horizonDays * 86400 * 1000);

    let liabilitiesQuery = `
      SELECT liability_id, account_id, vendor_id, title, category, amount_usdc, due_date, 
             status, payout_address, source_invoice_hash, source_po_hash, created_at, updated_at
      FROM account_liabilities
    `;
    const queryParams: any[] = [];

    if (options?.accountId) {
      liabilitiesQuery += ` WHERE account_id = $1`;
      queryParams.push(options.accountId);
    }
    liabilitiesQuery += ` ORDER BY due_date ASC;`;

    const liabilitiesRes = await DbClient.query(liabilitiesQuery, queryParams);
    const allLiabilities = liabilitiesRes.rows;

    let totalUpcomingRaw = 0n;
    let totalOverdueRaw = 0n;
    let activeScheduledCount = 0;
    let disbursedCount = 0;
    const categoryTotalsRaw: Record<string, bigint> = {};

    const upcomingItems: Array<{
      liabilityId: string;
      accountId: string;
      vendorId: string;
      title: string;
      category: string;
      amountUsdc: string;
      amountRaw: bigint;
      dueDate: string;
      isOverdue: boolean;
      status: string;
      payoutAddress: string;
    }> = [];

    for (const row of allLiabilities) {
      const rawAmt = this.dynamicRecords.parseUsdcToRaw(String(row.amount_usdc));
      const dueDate = new Date(row.due_date);
      const isOverdue = dueDate < now && ["SCHEDULED", "AWAITING_APPROVAL"].includes(row.status);
      const category = row.category || "GENERAL";

      if (row.status === "SCHEDULED" || row.status === "AWAITING_APPROVAL") {
        activeScheduledCount++;
        if (dueDate <= horizonEnd) {
          totalUpcomingRaw += rawAmt;
          categoryTotalsRaw[category] = (categoryTotalsRaw[category] || 0n) + rawAmt;
        }
        if (isOverdue) {
          totalOverdueRaw += rawAmt;
        }
      } else if (row.status === "DISBURSED") {
        disbursedCount++;
      }

      if (dueDate <= horizonEnd || isOverdue) {
        upcomingItems.push({
          liabilityId: row.liability_id,
          accountId: row.account_id,
          vendorId: row.vendor_id,
          title: row.title,
          category,
          amountUsdc: this.dynamicRecords.formatRawToUsdc(rawAmt),
          amountRaw: rawAmt,
          dueDate: dueDate.toISOString(),
          isOverdue,
          status: row.status,
          payoutAddress: row.payout_address,
        });
      }
    }

    const categoryBreakdown: Record<string, string> = {};
    for (const [cat, rawVal] of Object.entries(categoryTotalsRaw)) {
      categoryBreakdown[cat] = this.dynamicRecords.formatRawToUsdc(rawVal);
    }

    // 3. Safe-to-Invest Horizon (Dynamic Record 2)
    const invRules = profile.investment_rules;
    const accountSafeRecords: Array<{
      accountId: string;
      operatingFloorUsdc: string;
      safetyBufferRatio: number;
      protectedReserveUsdc: string;
      safeToInvestUsdc: string;
      safeToInvestRaw: bigint;
      status: "SAFE_TO_INVEST" | "RECALL_REQUIRED" | "BALANCED";
    }> = [];

    for (const acc of filteredAccounts) {
      const safeRecord: DynamicSafeToInvestRecord = await this.dynamicRecords.calculateSafeToInvest(
        acc.accountId,
        horizonDays * 86400,
        acc.protectedReserveUsdc,
        acc.liquidRaw,
        acc.investedRaw
      );

      let recordStatus: "SAFE_TO_INVEST" | "RECALL_REQUIRED" | "BALANCED" = "BALANCED";
      if (safeRecord.safeToInvestRaw > 0n) {
        recordStatus = "SAFE_TO_INVEST";
      } else if (safeRecord.status === "RECALL_REQUIRED") {
        recordStatus = "RECALL_REQUIRED";
      }

      accountSafeRecords.push({
        accountId: acc.accountId,
        operatingFloorUsdc: acc.minOperatingFloorUsdc,
        safetyBufferRatio: acc.safetyBufferRatio,
        protectedReserveUsdc: acc.protectedReserveUsdc,
        safeToInvestUsdc: safeRecord.safeToInvestUsdc,
        safeToInvestRaw: safeRecord.safeToInvestRaw,
        status: recordStatus,
      });
    }

    // 4. ERP Sync Status (D20.B)
    const syncRes = await DbClient.query(
      `SELECT sync_id, system_type, account_id, entity_type, last_sync_timestamp, 
              last_synced_document_id, sync_checkpoint_data, status
       FROM erp_sync_state
       ${options?.accountId ? "WHERE account_id = $1" : ""}
       ORDER BY last_sync_timestamp DESC
       LIMIT 20;`,
      options?.accountId ? [options.accountId] : []
    );

    const erpNextCheckpoints = syncRes.rows.filter((r: any) => r.system_type === "ERPNEXT");
    const odooCheckpoints = syncRes.rows.filter((r: any) => r.system_type === "ODOO");

    const unreconciledCheckpoints = syncRes.rows.filter((r: any) => r.status === "FAILED");
    const allMatchesVerified = syncRes.rows.every((r: any) => {
      const data = typeof r.sync_checkpoint_data === "string" ? JSON.parse(r.sync_checkpoint_data) : r.sync_checkpoint_data;
      return data?.threeWayMatchVerified !== false;
    });

    let overallErpStatus: "SYNCED" | "DEGRADED" | "DESYNCHRONIZED" = "SYNCED";
    if (unreconciledCheckpoints.length > 0) {
      overallErpStatus = "DEGRADED";
    }

    const recentCheckpoints = syncRes.rows.map((r: any) => {
      const data = typeof r.sync_checkpoint_data === "string" ? JSON.parse(r.sync_checkpoint_data) : (r.sync_checkpoint_data || {});
      return {
        syncId: r.sync_id,
        systemType: r.system_type,
        accountId: r.account_id,
        entityType: r.entity_type,
        lastSyncTimestamp: new Date(r.last_sync_timestamp).toISOString(),
        lastSyncedDocumentId: r.last_synced_document_id,
        status: r.status,
        invoiceId: data.invoiceId,
        txHash: data.txHash,
        odooPaymentId: data.odooPaymentId,
        threeWayMatchVerified: data.threeWayMatchVerified,
      };
    });

    // 5. Audit State (D7 / D19d7)
    const chainVerification = await MasterJournalRepo.verifyChainIntegrity();
    const allJournalEntries = await MasterJournalRepo.getAllEntries();
    const currentSequenceId = allJournalEntries.length > 0 ? Number(allJournalEntries[allJournalEntries.length - 1].sequence_id || 0) : 0;
    const headBlockHash = allJournalEntries.length > 0 ? allJournalEntries[allJournalEntries.length - 1].current_hash : "0".repeat(64);

    const auditLimit = options?.includeAuditHistoryLimit ?? 15;
    const auditRes = await DbClient.query(
      `SELECT log_id, account_id, timestamp, action_type, amount_usdc, is_autonomous, tx_hash, reason
       FROM account_agent_audit_log
       ${options?.accountId ? "WHERE account_id = $1" : ""}
       ORDER BY timestamp DESC
       LIMIT $${options?.accountId ? 2 : 1};`,
      options?.accountId ? [options.accountId, auditLimit] : [auditLimit]
    );

    let autonomousCount = 0;
    let humanCount = 0;
    const recentAuditEvents: Array<{
      logId?: string;
      accountId: string;
      actionType: string;
      amountUsdc: number;
      isAutonomous: boolean;
      txHash?: string;
      reason: string;
      createdAt: string;
    }> = [];

    for (const row of auditRes.rows) {
      if (row.is_autonomous) {
        autonomousCount++;
      } else {
        humanCount++;
      }
      recentAuditEvents.push({
        logId: row.log_id,
        accountId: row.account_id,
        actionType: row.action_type,
        amountUsdc: Number(row.amount_usdc),
        isAutonomous: Boolean(row.is_autonomous),
        txHash: row.tx_hash,
        reason: row.reason,
        createdAt: new Date(row.timestamp).toISOString(),
      });
    }

    // 6. Transaction State (D16 / D17 / D19)
    const dailyCap = profile.spending_limits?.daily_hard_cap_usdc ?? 5000;
    const perTxCap = profile.spending_limits?.single_tx_human_gate_threshold_usdc ?? 500;

    const dailySpendRes = await DbClient.query(
      `SELECT COALESCE(SUM(amount_usdc), 0) AS daily_spent, COUNT(*) as settled_count
       FROM master_system_journal
       WHERE timestamp >= NOW() - INTERVAL '24 hours'
         AND action_type IN ('DISBURSAL_PAYMENT', 'DISBURSAL_SETTLEMENT')
         ${options?.accountId ? "AND account_id = $1" : ""};`,
      options?.accountId ? [options.accountId] : []
    );
    const dailySpent = parseFloat(dailySpendRes.rows[0]?.daily_spent || "0");
    const settled24hCount = parseInt(dailySpendRes.rows[0]?.settled_count || "0", 10);
    const dailyRemaining = Math.max(0, dailyCap - dailySpent);

    const pendingRequests = await PermissionRequestRepo.getPendingRequests();
    const approvedRequestsRes = await DbClient.query(
      `SELECT request_id, action_type, amount_usdc, created_at, status 
       FROM permission_requests 
       WHERE status = 'APPROVED'
       ORDER BY created_at DESC 
       LIMIT 10;`
    );

    // Active account locks
    const activeAccountLocks: string[] = [];
    for (const acc of filteredAccounts) {
      if (AccountLockManager.isLocked(acc.accountId)) {
        activeAccountLocks.push(acc.accountId);
      }
    }

    return {
      timestamp: new Date().toISOString(),
      activeProfile,
      currency: "USDC",

      balances: {
        totalLiquidUsdc: companyDistribution.totalLiquidUsdc,
        totalLiquidRaw: companyDistribution.totalLiquidRaw,
        totalInvestedUsyc: companyDistribution.totalInvestedUsyc,
        totalInvestedRaw: companyDistribution.totalInvestedRaw,
        totalEffectiveUsdc: companyDistribution.companyTotalNetWorthUsdc,
        totalEffectiveRaw: companyDistribution.companyTotalNetWorthRaw,
        tripartiteInvariantVerified:
          companyDistribution.totalLiquidRaw + companyDistribution.totalInvestedRaw ===
          companyDistribution.companyTotalNetWorthRaw,
        solvencyHealth: {
          isSolvent: companyDistribution.solvencyHealth.isSolvent,
          totalSurplusUsdc: companyDistribution.solvencyHealth.totalSurplusUsdc,
          totalSurplusRaw: companyDistribution.solvencyHealth.totalSurplusRaw,
          healthRatio: companyDistribution.solvencyHealth.healthRatio,
        },
        accounts: filteredAccounts.map((a) => ({
          accountId: a.accountId,
          name: a.name,
          role: a.role,
          chain: a.chain,
          walletAddress: a.address,
          liquidUsdc: a.liquidUsdc,
          liquidRaw: a.liquidRaw,
          investedUsyc: a.investedUsyc,
          investedRaw: a.investedRaw,
          totalEffectiveUsdc: a.totalEffectiveUsdc,
          totalEffectiveRaw: a.totalEffectiveRaw,
          freeCapitalUsdc: a.freeCapitalUsdc,
          freeCapitalRaw: a.freeCapitalRaw,
          safeToInvestUsdc: a.safeToInvestUsdc,
          safeToInvestRaw: a.safeToInvestRaw,
          protectedReserveUsdc: a.protectedReserveUsdc,
          protectedReserveRaw: a.protectedReserveRaw,
          excludeFromWaterfall: a.excludeFromWaterfall,
          isActive: a.isActive,
        })),
      },

      liabilities: {
        totalUpcoming30dUsdc: this.dynamicRecords.formatRawToUsdc(totalUpcomingRaw),
        totalUpcoming30dRaw: totalUpcomingRaw,
        totalOverdueUsdc: this.dynamicRecords.formatRawToUsdc(totalOverdueRaw),
        totalOverdueRaw: totalOverdueRaw,
        totalLiabilitiesCount: allLiabilities.length,
        activeScheduledCount,
        disbursedCount,
        categoryBreakdown,
        upcomingItems,
      },

      safeToInvestHorizon: {
        evaluationHorizonDays: horizonDays,
        totalProtectedReserveUsdc: companyDistribution.totalProtectedReserveUsdc,
        totalProtectedReserveRaw: companyDistribution.totalProtectedReserveRaw,
        totalSafeToInvestUsdc: companyDistribution.totalFreeCapitalUsdc,
        totalSafeToInvestRaw: companyDistribution.totalFreeCapitalRaw,
        totalFreeCapitalUsdc: companyDistribution.totalFreeCapitalUsdc,
        totalFreeCapitalRaw: companyDistribution.totalFreeCapitalRaw,
        hysteresis: {
          investHysteresisBandUsdc: invRules.invest_hysteresis_band_usdc,
          recallHysteresisBandUsdc: invRules.recall_hysteresis_band_usdc,
          minSweepAmountUsdc: invRules.min_sweep_amount_usdc,
        },
        accountRecords: accountSafeRecords,
      },

      erpSyncStatus: {
        overallStatus: overallErpStatus,
        lastSyncTimestamp: recentCheckpoints[0]?.lastSyncTimestamp,
        threeWayMatchIntegrity: allMatchesVerified,
        unreconciledCount: unreconciledCheckpoints.length,
        erpNext: {
          status: erpNextCheckpoints.length > 0 ? "CONNECTED" : "DISCONNECTED",
          lastDocName: recentCheckpoints.find((c) => c.systemType === "ERPNEXT")?.lastSyncedDocumentId,
          syncedCount: erpNextCheckpoints.length,
        },
        odoo: {
          status: odooCheckpoints.length > 0 ? "CONNECTED" : "DISCONNECTED",
          lastPaymentId: recentCheckpoints.find((c) => c.systemType === "ODOO")?.odooPaymentId,
          syncedCount: odooCheckpoints.length,
        },
        recentCheckpoints,
      },

      auditState: {
        masterJournal: {
          totalVouchersCount: allJournalEntries.length,
          currentSequenceId,
          headBlockHash,
          genesisPreviousHash: "0".repeat(64),
          chainIntegrityVerified: chainVerification.valid,
        },
        auditLog: {
          totalAuditEntries: auditRes.rows.length,
          autonomousActionsCount: autonomousCount,
          humanSupervisedActionsCount: humanCount,
          recentAuditEvents,
        },
      },

      transactionState: {
        spendingLimits: {
          dailyHardCapUsdc: dailyCap.toFixed(6),
          dailySpent24hUsdc: dailySpent.toFixed(6),
          dailyRemainingUsdc: dailyRemaining.toFixed(6),
          singleTxHumanThresholdUsdc: perTxCap.toFixed(6),
        },
        pendingSprs: {
          count: pendingRequests.length,
          requests: pendingRequests.map((r) => ({
            requestId: r.request_id,
            actionType: r.action_type,
            amountUsdc: r.amount_usdc,
            reason: r.reason,
            createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
            conflictingPolicy: (r.payload as any)?.conflicting_policy,
          })),
        },
        authorizedIntents: {
          count: approvedRequestsRes.rows.length,
          requests: approvedRequestsRes.rows.map((r: any) => ({
            requestId: r.request_id,
            actionType: r.action_type,
            amountUsdc: Number(r.amount_usdc),
            authorizedAt: new Date(r.created_at).toISOString(),
          })),
        },
        activeAccountLocks,
        settledDisbursals24hCount: settled24hCount,
      },
    };
  }
}
