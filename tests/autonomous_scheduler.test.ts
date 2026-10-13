import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { DbClient } from "../src/database/dbClient.js";
import { PollingJobsRepo } from "../src/database/repos/pollingJobsRepo.js";
import { LiabilityRepo } from "../src/database/repos/liabilityRepo.js";
import { TreasuryAccountsRepo } from "../src/database/repos/treasuryAccountsRepo.js";
import { VendorMasterRepo } from "../src/database/repos/vendorMasterRepo.js";
import { AutonomousSchedulerService } from "../src/services/autonomousSchedulerService.js";
import { IntakeDiscoveryAgent } from "../src/services/intakeDiscoveryAgent.js";

describe("Autonomous Scheduler & External App Polling Engine", () => {
  const companyId = `cmp_sched_${Date.now()}`;
  const accountId = `acc_${companyId}_ops`;
  const vendorAws = `vnd_sched_aws_${Date.now()}`;
  const walletAddress = `0x${crypto.randomBytes(20).toString("hex")}`;

  before(async () => {
    // Provision primary operating account
    await TreasuryAccountsRepo.upsertAccount({
      account_id: accountId,
      company_id: companyId,
      chain_id: 5042002,
      name: "Primary Operating Account",
      role: "OPEX_DEV",
      wallet_address: walletAddress,
      min_operating_floor_usdc: 1000.0,
      safety_buffer_ratio: 1.2,
      is_active: true,
      authorized_categories: ["SAAS", "CLOUD_COMPUTE"],
    });

    // Seed verified vendor
    await VendorMasterRepo.registerVendor({
      vendor_id: vendorAws,
      name: "Amazon Web Services (AWS)",
      verified_payout_address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      verified_by_admin: "admin_tester",
      last_verified_at: new Date(),
      change_lock: true,
    });
  });

  after(async () => {
    await DbClient.query("DELETE FROM external_app_polling_jobs WHERE company_id = $1", [companyId]);
    await DbClient.query("DELETE FROM account_liabilities WHERE company_id = $1", [companyId]);
    await DbClient.query("DELETE FROM dynamic_safe_to_invest WHERE account_id = $1", [accountId]);
    await DbClient.query("DELETE FROM account_agent_audit_log WHERE account_id = $1", [accountId]);
    await DbClient.query("DELETE FROM treasury_accounts WHERE company_id = $1", [companyId]);
    await DbClient.closePool();
  });

  it("1. Automatically registers recurring polling jobs for connected apps", async () => {
    const scheduler = new AutonomousSchedulerService();

    const jobs = await scheduler.registerConnectedAppJobs({
      companyId,
      appTypes: ["GOOGLE_WORKSPACE", "AWS", "GITHUB"],
      frequencyCron: "0 */4 * * *", // every 4 hours
      intervalSeconds: 14400,
    });

    assert.equal(jobs.length, 3);
    assert.equal(jobs[0].company_id, companyId);
    assert.equal(jobs[0].status, "IDLE");
    assert.equal(jobs[0].interval_seconds, 14400);

    const storedJobs = await PollingJobsRepo.getJobsByCompany(companyId);
    assert.equal(storedJobs.length, 3);
  });

  it("2. Polling engine executes due jobs, ingests documents, and auto-stages liabilities", async () => {
    // Inject mock intake discovery returning AWS and GitHub liabilities
    const testAwsTransport = {
      async request() {
        return {
          monthlySpend: 4200.0,
          forecastedSpend: 4500.0,
          costCenters: [{ tag: "Cloud Infrastructure", amount: 4200.0 }],
        };
      },
    };

    const testGoogleTransport = {
      async callTool(name: string) {
        if (name === "gmail_search_messages") return { messageIds: ["msg_sched_01"] };
        if (name === "gmail_get_message") {
          return {
            id: "msg_sched_01",
            bodyText: "Datadog Invoice INV-2026-DD-99 for $350.00 USDC due 2026-10-20 to 0x2222222222222222222222222222222222222222 PO: PO-DATADOG-99 Cost Center: Monitoring",
          };
        }
        return {};
      },
    };

    const scheduler = new AutonomousSchedulerService({
      intakeAgentFactory: (cid) =>
        new IntakeDiscoveryAgent({
          companyId: cid,
          googleTransport: testGoogleTransport,
          vendorTransports: { AWS: testAwsTransport },
        }),
    });

    const result = await scheduler.executeDueAppPolls();
    assert.ok(result.processedJobs >= 1, "Should process due polling jobs");
    assert.ok(result.newLiabilitiesCount >= 1, "Should auto-stage new liabilities");

    // Verify staged liabilities in account_liabilities
    const liabilities = await LiabilityRepo.getUpcomingLiabilities(365, undefined, companyId);
    assert.ok(liabilities.length >= 1, "Must find staged liabilities in database");
    assert.ok(
      liabilities.some((l) => l.vendor_id.toLowerCase().includes("aws") || l.vendor_id.toLowerCase().includes("datadog")),
      "Must stage discovered liabilities"
    );

    // Verify polling job timestamps updated
    const jobs = await PollingJobsRepo.getJobsByCompany(companyId);
    const completedJob = jobs.find((j) => j.last_polled_at !== null);
    assert.ok(completedJob, "Completed job must have last_polled_at set");
    assert.ok(completedJob!.next_poll_at.getTime() > Date.now(), "next_poll_at must be advanced");

    // COGNITIVE SWARM AGENT VERIFICATION:
    // Verify LiabilityRadarAgent (#102) deliberated and recorded events to continuous context blackboard
    const radarEvents = await DbClient.query(
      `SELECT * FROM agent_continuous_context 
       WHERE session_id = $1 AND agent_id = 102 
       ORDER BY event_seq ASC`,
      [scheduler.swarm.sessionId]
    );
    assert.ok(radarEvents.rows.length >= 1, "LiabilityRadarAgent (#102) must record cognitive deliberation to continuous context");
  });

  it("3. Disbursal loop automatically executes scheduled liabilities within the lead time window", async () => {
    // Create an immediately due scheduled liability
    const dueLiability = await LiabilityRepo.createLiability({
      account_id: accountId,
      company_id: companyId,
      vendor_id: vendorAws,
      title: "AWS Cloud Services Due Today",
      category: "CLOUD_COMPUTE",
      amount_usdc: 300.0,
      due_date: new Date(Date.now() + 1000 * 3600 * 2), // due in 2 hours (within 48h lead time)
      payout_address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      source_po_hash: "PO-AWS-SCHED-01",
      status: "SCHEDULED",
      preferred_payment_rail: "DISBURSAL_VAULT",
    });

    const scheduler = new AutonomousSchedulerService({
      disbursalLeadTimeHours: 48,
    });

    const disbursalResult = await scheduler.executeDueLiabilities();
    assert.ok(disbursalResult.settledCount >= 1, "Must settle due scheduled liabilities");

    // Verify liability status transitioned to SETTLED
    const updated = await LiabilityRepo.getLiabilityById(dueLiability.liability_id!);
    assert.equal(updated?.status, "SETTLED", "Liability must be transitioned to SETTLED");

    // COGNITIVE SWARM AGENT VERIFICATION:
    // Verify LedgerWitnessAgent (#105) witnessed the settlement voucher
    const witnessEvents = await DbClient.query(
      `SELECT * FROM agent_continuous_context 
       WHERE session_id = $1 AND agent_id = 105 
       ORDER BY event_seq ASC`,
      [scheduler.swarm.sessionId]
    );
    assert.ok(witnessEvents.rows.length >= 1, "LedgerWitnessAgent (#105) must witness and record voucher to continuous context");
  });

  it("4. Daemon lifecycle controls (start, tick, stop) function deterministically", async () => {
    const scheduler = new AutonomousSchedulerService({ pollingIntervalMs: 500 });
    assert.equal(scheduler.getStatus().isRunning, false);

    scheduler.start();
    assert.equal(scheduler.getStatus().isRunning, true);

    // Run a manual tick cycle
    const tickResult = await scheduler.tick();
    assert.ok(tickResult !== undefined);

    scheduler.stop();
    assert.equal(scheduler.getStatus().isRunning, false);
  });
});
