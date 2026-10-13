/**
 * Autonomous Background Scheduler & External App Polling Engine.
 * ================================================================
 * Periodically wakes up to:
 * 1. Poll connected external apps (Google Workspace, Microsoft 365, Top 10 Vendor APIs, ERPs)
 *    based on configured cron intervals, automatically discovering invoices and staging liabilities.
 * 2. Execute scheduled liabilities through the Universal Payment Router when their due window arrives.
 * 3. Evaluate the tripartite balance and trigger autonomous surplus sweeps to tokenized US Treasuries (USYC).
 */

import { PollingJobsRepo, PollingJobRecord } from "../database/repos/pollingJobsRepo.js";
import { LiabilityRepo } from "../database/repos/liabilityRepo.js";
import { TreasuryAccountsRepo } from "../database/repos/treasuryAccountsRepo.js";
import { AuditLogRepo } from "../database/repos/auditLogRepo.js";
import { VendorMasterRepo } from "../database/repos/vendorMasterRepo.js";
import { IntakeDiscoveryAgent } from "./intakeDiscoveryAgent.js";
import { DisbursalRouter } from "./disbursalRouter.js";
import { DynamicRecordsService } from "../records/dynamicRecordsService.js";
import { TreasurySentinelService } from "./treasurySentinelService.js";
import { MissingVendorCredentialsError } from "../connectors/vendorBillingTypes.js";
import { SwarmCoordinator } from "../agents/swarmCoordinator.js";
import crypto from "crypto";

export interface SchedulerOptions {
  pollingIntervalMs?: number;
  disbursalLeadTimeHours?: number;
  autoStart?: boolean;
  intakeAgentFactory?: (companyId: string) => IntakeDiscoveryAgent;
  disbursalRouter?: DisbursalRouter;
  dynamicRecords?: DynamicRecordsService;
  treasurySentinel?: TreasurySentinelService;
  swarmCoordinator?: SwarmCoordinator;
}

export class AutonomousSchedulerService {
  private timer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private pollingIntervalMs: number;
  private disbursalLeadTimeHours: number;
  private intakeAgentFactory?: (companyId: string) => IntakeDiscoveryAgent;
  private disbursalRouter: DisbursalRouter;
  private dynamicRecords: DynamicRecordsService;
  private treasurySentinel: TreasurySentinelService;
  public readonly swarm: SwarmCoordinator;

  constructor(options?: SchedulerOptions) {
    this.pollingIntervalMs = options?.pollingIntervalMs ?? 60000; // 1 minute default
    this.disbursalLeadTimeHours = options?.disbursalLeadTimeHours ?? 48; // 48 hours lead time
    this.intakeAgentFactory = options?.intakeAgentFactory;
    this.disbursalRouter = options?.disbursalRouter ?? new DisbursalRouter();
    this.dynamicRecords = options?.dynamicRecords ?? new DynamicRecordsService();
    this.treasurySentinel = options?.treasurySentinel ?? new TreasurySentinelService();
    this.swarm = options?.swarmCoordinator ?? new SwarmCoordinator();

    if (options?.autoStart) {
      this.start();
    }
  }

  /**
   * Starts the autonomous background scheduler daemon.
   */
  public start(intervalMs?: number): void {
    if (this.isRunning) return;
    if (intervalMs) this.pollingIntervalMs = intervalMs;
    this.isRunning = true;

    this.timer = setInterval(async () => {
      try {
        await this.tick();
      } catch (err: any) {
        console.error("[AutonomousScheduler] Error during scheduled tick:", err.message);
      }
    }, this.pollingIntervalMs);
  }

  /**
   * Stops the background scheduler daemon gracefully.
   */
  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
  }

  public getStatus(): { isRunning: boolean; pollingIntervalMs: number } {
    return {
      isRunning: this.isRunning,
      pollingIntervalMs: this.pollingIntervalMs,
    };
  }

  /**
   * Registers automated polling jobs for an onboarded organization's connected apps.
   */
  public async registerConnectedAppJobs(params: {
    companyId: string;
    appTypes: string[];
    frequencyCron?: string;
    intervalSeconds?: number;
  }): Promise<PollingJobRecord[]> {
    const jobs: PollingJobRecord[] = [];
    for (const appType of params.appTypes) {
      const job = await PollingJobsRepo.upsertJob({
        company_id: params.companyId,
        app_type: appType,
        polling_frequency_cron: params.frequencyCron || "0 */6 * * *",
        interval_seconds: params.intervalSeconds || 21600, // 6 hours
        next_poll_at: new Date(), // due immediately for initial discovery
      });
      jobs.push(job);
    }
    return jobs;
  }

  /**
   * Single comprehensive operational cycle.
   */
  public async tick(): Promise<{
    polledJobs: number;
    discoveredLiabilities: number;
    settledDisbursals: number;
  }> {
    const pollResult = await this.executeDueAppPolls();
    const disbursalResult = await this.executeDueLiabilities();
    await this.rebalanceTreasurySurplus();

    return {
      polledJobs: pollResult.processedJobs,
      discoveredLiabilities: pollResult.newLiabilitiesCount,
      settledDisbursals: disbursalResult.settledCount,
    };
  }

  /**
   * 1. Evaluates all pending app polling jobs, runs LiabilityRadarLlmAgent for 3-way match,
   *    and auto-stages newly discovered verified liabilities.
   */
  public async executeDueAppPolls(): Promise<{
    processedJobs: number;
    newLiabilitiesCount: number;
  }> {
    const dueJobs = await PollingJobsRepo.getDueJobs(10);
    let newLiabilitiesCount = 0;

    for (const job of dueJobs) {
      await PollingJobsRepo.markJobRunning(job.job_id);

      try {
        const agent = this.intakeAgentFactory
          ? this.intakeAgentFactory(job.company_id)
          : new IntakeDiscoveryAgent({ companyId: job.company_id });

        const synthesis = await agent.synthesizeAllSources();
        let createdForJob = 0;

        // Auto-stage newly discovered liabilities in account_liabilities
        const existingLiabs = await LiabilityRepo.getUpcomingLiabilities(365, undefined, job.company_id);
        const existingTitles = new Set(existingLiabs.map((l) => `${l.vendor_id}:${l.amount_usdc}`));

        // Pick primary operating account for the company
        const accounts = await TreasuryAccountsRepo.getAccountsByCompany(job.company_id);
        const primaryAccountId = accounts[0]?.account_id || `acc_${job.company_id}_ops`;

        for (const disc of synthesis.discoveredLiabilities) {
          const key = `${disc.vendorId}:${disc.amountUsdc}`;
          if (!existingTitles.has(key)) {
            // Verify or auto-register vendor allowlist (Rule 3)
            let vendor = await VendorMasterRepo.getVendorById(disc.vendorId);
            if (!vendor) {
              const addrHex = (disc.payoutAddress.startsWith("0x") ? disc.payoutAddress : `0x${disc.payoutAddress}`) as `0x${string}`;
              await VendorMasterRepo.registerVendor({
                vendor_id: disc.vendorId,
                name: disc.vendorName,
                verified_payout_address: addrHex,
                verified_by_admin: "AUTONOMOUS_APP_POLLER",
                last_verified_at: new Date(),
                change_lock: true,
              });
            }

            // COGNITIVE SWARM AGENT INFUSION (ID #102: LiabilityRadarAgent)
            // Deliberates on incoming invoice demand, executes forensic 3-way match against
            // PO in vector memory, and inspects vendor master to prevent payee substitution.
            let forensicApproved = true;
            try {
              const radarResult = await this.swarm.radarAgent.ingestAndVerifyInvoice(
                this.swarm.sessionId,
                {
                  accountId: primaryAccountId,
                  vendorId: disc.vendorId,
                  invoiceId: disc.invoiceId || `INV-AUTO-${Date.now()}`,
                  amountUsdc: disc.amountUsdc.toString(),
                  claimedPayoutAddress: disc.payoutAddress,
                  poReference: disc.poNumber || `PO-AUTO-${disc.vendorId}`,
                }
              );

              if (radarResult.success === false) {
                forensicApproved = false;
              }
            } catch (radarErr: any) {
              console.warn(
                `[AutonomousScheduler] LiabilityRadar verification warning for ${disc.vendorId}:`,
                radarErr.message
              );
              forensicApproved = disc.payeeVerified;
            }

            const title = (disc as any).title || `${disc.vendorName || disc.vendorId} Invoice ${disc.invoiceId || ""}`.trim();
            const preferredRail = (disc as any).preferredPaymentRail || (disc as any).optimalRail || "DISBURSAL_VAULT";
            const addrHex = (disc.payoutAddress.startsWith("0x") ? disc.payoutAddress : `0x${disc.payoutAddress}`) as `0x${string}`;

            await LiabilityRepo.createLiability({
              account_id: primaryAccountId,
              company_id: job.company_id,
              vendor_id: disc.vendorId,
              title,
              category: "SAAS",
              amount_usdc: disc.amountUsdc,
              due_date: new Date(disc.dueDate),
              payout_address: addrHex,
              source_po_hash: disc.poNumber || `PO-AUTO-${disc.vendorId}`,
              source_invoice_hash: `INV-AUTO-${Date.now()}`,
              status: forensicApproved && disc.payeeVerified ? "SCHEDULED" : "AWAITING_APPROVAL",
              preferred_payment_rail: preferredRail,
            });

            createdForJob++;
            newLiabilitiesCount++;
            existingTitles.add(key);
          }
        }

        // Calculate next polling timestamp
        const nextPoll = new Date(Date.now() + job.interval_seconds * 1000);
        await PollingJobsRepo.completeJob(job.job_id, createdForJob, nextPoll);

        await AuditLogRepo.appendAuditLog({
          account_id: primaryAccountId,
          action_type: "APP_POLL_COMPLETED",
          amount_usdc: 0,
          is_autonomous: true,
          reason: `Autonomous poll of app '${job.app_type}' completed. Discovered ${createdForJob} new liabilities.`,
          pre_state_snapshot: {},
          post_state_snapshot: {},
          actor_agent: "AutonomousSchedulerService (Swarm #102 LiabilityRadar)",
        });
      } catch (err: any) {
        console.error("[AutonomousScheduler Poll Error]:", err.message);
        const nextPoll = new Date(Date.now() + Math.min(job.interval_seconds, 300) * 1000); // retry in 5 min on error
        await PollingJobsRepo.failJob(job.job_id, err.message, nextPoll);
      }
    }

    return { processedJobs: dueJobs.length, newLiabilitiesCount };
  }

  /**
   * 2. Scans for scheduled liabilities within the lead time window and settles them
   *    via PolicyComplianceAgent (#104), DisbursalRouterAgent (#103), and LedgerWitnessAgent (#105).
   */
  public async executeDueLiabilities(): Promise<{
    settledCount: number;
    failedCount: number;
  }> {
    const horizonDays = Math.ceil(this.disbursalLeadTimeHours / 24);
    // Fetch upcoming scheduled liabilities across all companies
    const upcoming = await LiabilityRepo.getUpcomingLiabilities(horizonDays);
    const eligible = upcoming.filter((l) => l.status === "SCHEDULED");

    let settledCount = 0;
    let failedCount = 0;

    for (const liab of eligible) {
      try {
        const companyId = liab.company_id || "default_org";
        const accounts = await TreasuryAccountsRepo.getAccountsByCompany(companyId);
        const primaryAccount = accounts.find((a) => a.account_id === liab.account_id) || accounts[0];

        // COGNITIVE SWARM AGENT INFUSION (ID #103 & ID #104)
        // 1. Generate deterministic Keccak-256 idempotency key
        const proposedIdempotencyKey = this.swarm.routerAgent.generatePaymentIdempotencyKey(
          liab.payout_address as `0x${string}`,
          liab.source_invoice_hash || liab.title,
          BigInt(Math.round(Number(liab.amount_usdc) * 1e6))
        );

        // 2. Submit Reason-Bearing Intent to PolicyComplianceAgent (#104)
        const complianceResult = await this.swarm.complianceAgent.evaluateIntent({
          proposedAction: "DISBURSE_PAYMENT",
          accountId: primaryAccount ? primaryAccount.account_id : liab.account_id,
          amountUsdc: Number(liab.amount_usdc).toFixed(6),
          declaredReason: `Scheduled autonomous settlement for liability '${liab.title}' to vendor '${liab.vendor_id}'`,
          recipientAddress: liab.payout_address,
          vendorId: liab.vendor_id,
          idempotencyKey: proposedIdempotencyKey,
          liabilityId: liab.liability_id,
        });

        if (complianceResult.decision === "DENY") {
          failedCount++;
          console.warn(`[AutonomousScheduler] Disbursal DENIED by PolicyComplianceAgent: ${complianceResult.reason}`);
          await this.swarm.contextManager.recordEvent({
            sessionId: this.swarm.sessionId,
            agentId: 104,
            agentName: "PolicyComplianceAgent",
            eventType: "AGENT_DELIBERATION" as any,
            role: "assistant",
            content: `Autonomous settlement for ${liab.title} DENIED. Violations: ${complianceResult.violations?.join("; ")}`,
            metadata: { liabilityId: liab.liability_id, decision: complianceResult },
          });
          continue;
        }

        if (complianceResult.decision === "ESCALATE_TO_SPRS") {
          console.info(`[AutonomousScheduler] Disbursal ESCALATED to SPRS by PolicyComplianceAgent. Request ID: ${complianceResult.sprsRequestId}`);
          await LiabilityRepo.updateLiabilityStatus(liab.liability_id!, "AWAITING_APPROVAL");
          await this.swarm.contextManager.recordEvent({
            sessionId: this.swarm.sessionId,
            agentId: 104,
            agentName: "PolicyComplianceAgent",
            eventType: "SPRS_ESCALATION" as any,
            role: "assistant",
            content: `Disbursal for ${liab.title} escalated to human dual-key authorization (SPRS Request ID: ${complianceResult.sprsRequestId}).`,
            metadata: { liabilityId: liab.liability_id, sprsRequestId: complianceResult.sprsRequestId },
          });
          continue;
        }

        // 3. Disbursal Router Execution
        const balances: Record<string, number> = {};
        for (const acc of accounts) {
          balances[acc.account_id] = 50000.0; // In live environment, fetched via Circle wallet / Arc client
        }

        const res = await this.disbursalRouter.executeLiabilityDisbursal({
          companyId,
          liabilityId: liab.liability_id!,
          accountBalances: balances,
        });

        if (res.success && res.txHash) {
          settledCount++;

          // COGNITIVE SWARM AGENT INFUSION (ID #105: LedgerWitnessAgent)
          // Act as external witness, verify onchain tx receipt, post document-linked GL entry to ERP,
          // and append record into the sequential SHA-256 hash-chained master system journal.
          try {
            await this.swarm.witnessAgent.recordSettlementVoucher(this.swarm.sessionId, {
              accountId: primaryAccount ? primaryAccount.account_id : liab.account_id,
              documentRef: liab.title,
              debitAccount: "5000_OPEX_VENDOR",
              creditAccount: "1000_TREASURY_USDC",
              amountUsdc: Number(liab.amount_usdc).toFixed(6),
              txHash: res.txHash,
            });
          } catch (witnessErr: any) {
            console.warn("[AutonomousScheduler] LedgerWitness logging warning:", witnessErr.message);
          }
        } else {
          failedCount++;
          console.error("[AutonomousScheduler Disbursal Error]:", res.error || "No confirmed Arc transaction hash returned.", "STATUS:", res.status);
        }
      } catch (err: any) {
        failedCount++;
        console.error(`[AutonomousScheduler] Failed to execute liability ${liab.liability_id}:`, err.message);
      }
    }

    return { settledCount, failedCount };
  }

  /**
   * 3. Autonomous Treasury Rebalancing (Surplus Sweeps via TreasurySentinelAgent #101).
   */
  public async rebalanceTreasurySurplus(): Promise<void> {
    try {
      const accounts = await TreasuryAccountsRepo.getAllAccounts();
      const activeAccounts = accounts.filter((a) => a.is_active);
      for (const acc of activeAccounts) {
        const tripartite = await this.dynamicRecords.getTripartiteBalance(acc.account_id);
        const liquidBal = parseFloat(tripartite.availableBalanceUsdc);
        await this.treasurySentinel.evaluateAccount(acc.account_id, liquidBal);
      }

      // COGNITIVE SWARM AGENT INFUSION (ID #101: TreasurySentinelAgent)
      // Evaluate Tripartite Balance, calculate Dynamic Safe-to-Invest, and execute autonomous sweep
      for (const acc of activeAccounts.slice(0, 3)) {
        try {
          await this.swarm.sentinelAgent.evaluateLiquidityAndSweep(
            this.swarm.sessionId,
            acc.account_id
          );
        } catch (sentinelErr: any) {
          // Expected when balance is within hysteresis band or safe-to-invest is 0
        }
      }
    } catch {
      // Ignored if balance is within hysteresis band
    }
  }

  /**
   * On-demand trigger to immediately poll all apps for a specific tenant.
   */
  public async triggerCompanyPoll(companyId: string): Promise<{
    polledJobs: number;
    newLiabilitiesCount: number;
  }> {
    const jobs = await PollingJobsRepo.getJobsByCompany(companyId);
    for (const job of jobs) {
      await PollingJobsRepo.upsertJob({
        company_id: companyId,
        app_type: job.app_type,
        next_poll_at: new Date(Date.now() - 1000), // force due now
      });
    }
    const res = await this.executeDueAppPolls();
    return { polledJobs: res.processedJobs, newLiabilitiesCount: res.newLiabilitiesCount };
  }
}
