import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { SwarmCoordinator } from "../src/agents/swarmCoordinator.js";
import { DbClient } from "../src/database/dbClient.js";

describe("BizArc Swarm E2E Real-World Multi-Agent Audit", () => {
  let swarm: SwarmCoordinator;
  const testSessionId = `audit_session_${Date.now()}`;

  before(async () => {
    swarm = new SwarmCoordinator({
      sessionId: testSessionId,
      compactionThreshold: 6,
    });

    // Clean up test tables for clean reproducible run
    await DbClient.query(`DELETE FROM account_liabilities WHERE account_id LIKE 'OPEX_%' OR account_id = 'PAYROLL';`);
    await DbClient.query(`DELETE FROM master_system_journal WHERE account_id LIKE 'OPEX_%';`);

    // Seed test accounts in database across multiple cost centers
    await DbClient.query(`
      INSERT INTO treasury_accounts (account_id, name, role, wallet_address, min_operating_floor_usdc, is_active)
      VALUES 
        ('OPEX_DEV', 'Dev Ops Pool', 'OPEX_DEV', '0x9999999999999999999999999999999999999999', 500.000000, true),
        ('OPEX_GROWTH', 'Marketing Pool', 'OPEX_GROWTH', '0x8888888888888888888888888888888888888888', 500.000000, true),
        ('PAYROLL', 'Employee Payroll Reserve', 'PAYROLL', '0x7777777777777777777777777777777777777777', 10000.000000, true)
      ON CONFLICT (account_id) DO UPDATE SET is_active = true;
    `);

    // Seed verified vendor master registry (Golden Rule 3)
    await DbClient.query(`
      INSERT INTO vendor_master_registry (vendor_id, name, verified_payout_address, verified_by_admin, last_verified_at, change_lock)
      VALUES ('VEND-AWS-01', 'Amazon Web Services Inc.', '0x1111111111111111111111111111111111111111', 'CFO_ADMIN', NOW(), TRUE)
      ON CONFLICT (vendor_id) DO UPDATE SET verified_payout_address = EXCLUDED.verified_payout_address;
    `);
  });

  after(async () => {
    await DbClient.closePool();
  });

  it("Step 1: OnboardingAgent (ID #100) initializes enterprise ground truth in pgvector memory", async () => {
    await swarm.initializeEnterpriseSwarm();

    const agentResult = await swarm.onboardingAgent.executeTask(
      testSessionId,
      "Search enterprise vector memory for corporate treasury governance bylaws for Arc L1 and USYC"
    );

    assert.strictEqual(agentResult.success, true);
    assert.ok(agentResult.toolCallsExecuted.length > 0);
    console.log(`✓ OnboardingAgent executed ReAct task: ${agentResult.finalResponse.slice(0, 100)}...`);
  });

  it("Step 2: LiabilityRadarAgent (ID #102) ReAct Loop: Block Payee Substitution Attack", async () => {
    const maliciousInvoice = {
      accountId: "OPEX_DEV",
      vendorId: "VEND-AWS-01",
      invoiceId: "INV-POISON-666",
      amountUsdc: "12500.000000",
      claimedPayoutAddress: "0xAttackerAddress66666666666666666666666666", // Imposter address!
      poReference: "PO-2026-AWS-01",
    };

    const agentResult = await swarm.radarAgent.ingestAndVerifyInvoice(testSessionId, maliciousInvoice);

    // Agent ReAct loop executed verify_three_way_match tool, caught the payee substitution, and concluded with failure
    assert.strictEqual(agentResult.success, false, "Agent must conclude with failure on payee substitution");
    const matchTool = agentResult.toolCallsExecuted.find((t) => t.name === "verify_three_way_match");
    assert.ok(matchTool);
    assert.strictEqual(matchTool.result.success, false);
    assert.match(matchTool.result.error || "", /PAYEE SUBSTITUTION DETECTED/i);
    console.log(`✓ LiabilityRadarAgent autonomous ReAct loop blocked payee substitution: ${matchTool.result.error}`);
  });

  it("Step 3: LiabilityRadarAgent (ID #102) ReAct Loop: Reject Silent Rounding on Discrepant Amount", async () => {
    const roundedInvoice = {
      accountId: "OPEX_DEV",
      vendorId: "VEND-AWS-01",
      invoiceId: "INV-ROUNDING-FAIL",
      amountUsdc: "12500.100000", // Mismatched by $0.10
      claimedPayoutAddress: "0x1111111111111111111111111111111111111111",
      poReference: "PO-2026-AWS-01",
    };

    const agentResult = await swarm.radarAgent.ingestAndVerifyInvoice(testSessionId, roundedInvoice);

    assert.strictEqual(agentResult.success, false, "Agent must reject silent rounding");
    const matchTool = agentResult.toolCallsExecuted.find((t) => t.name === "verify_three_way_match");
    assert.ok(matchTool);
    assert.strictEqual(matchTool.result.success, false);
    assert.match(matchTool.result.error || "", /Silent rounding rejected/i);
    console.log(`✓ LiabilityRadarAgent autonomous ReAct loop rejected silent rounding: ${matchTool.result.error}`);
  });

  it("Step 4: LiabilityRadarAgent (ID #102) verifies authentic invoice and updates Dynamic Record 1", async () => {
    const legitimateInvoice = {
      accountId: "OPEX_DEV",
      vendorId: "VEND-AWS-01",
      invoiceId: "INV-2026-AWS-01",
      amountUsdc: "12500.000000",
      claimedPayoutAddress: "0x1111111111111111111111111111111111111111",
      poReference: "PO-2026-AWS-01",
    };

    const agentResult = await swarm.radarAgent.ingestAndVerifyInvoice(testSessionId, legitimateInvoice);
    assert.strictEqual(agentResult.success, true);
    assert.ok(agentResult.toolCallsExecuted.some((t) => t.name === "verify_three_way_match" && t.result.success));

    // Update Dynamic Record 1
    const lia = await swarm.dynamicRecords.upsertLiability({
      accountId: "OPEX_DEV",
      vendorId: "VEND-AWS-01",
      title: "AWS Cloud Infrastructure - October 2026",
      amountUsdc: "12500.000000",
      payoutAddress: legitimateInvoice.claimedPayoutAddress,
      dueDate: new Date(Date.now() + 4 * 86400 * 1000), // Due in 4 days
      frequency: "MONTHLY",
      documentHash: "0x7fa26a310c812d87e0ef6b7bfa9c3e981f211320ef2294101e1dc59c4059a4bb",
      poReference: "PO-2026-AWS-01",
      status: "SCHEDULED",
    });

    assert.ok(lia.liabilityId);
    assert.strictEqual(lia.amountUsdc, "12500.000000");
    console.log(`✓ LiabilityRadarAgent verified invoice. Dynamic Record 1 Liability ID: ${lia.liabilityId}`);
  });

  it("Step 5: PolicyComplianceAgent (ID #104) ReAct Loop: Evaluates Reason-Bearing Intent (PERMIT)", async () => {
    const intent = {
      proposedAction: "AUTONOMOUS_SWEEP",
      accountId: "OPEX_DEV",
      amountUsdc: "15000.000000",
      declaredReason: "Operating cash exceeds 7-day liability buffer by $67,500. Sweeping $15,000 to capture 5.1% USYC yield on Arc L1.",
    };

    const agentResult = await swarm.complianceAgent.evaluateReasonBearingIntentTask(testSessionId, intent);
    assert.strictEqual(agentResult.success, true);
    const intentTool = agentResult.toolCallsExecuted.find((t) => t.name === "evaluate_reason_bearing_intent");
    assert.ok(intentTool);
    assert.strictEqual(intentTool.result.data.decision, "PERMIT");
    assert.ok(intentTool.result.data.clearanceCode?.startsWith("CLEAR-"));
    console.log(`✓ PolicyComplianceAgent ReAct loop issued PERMIT: ${intentTool.result.data.clearanceCode}`);
  });

  it("Step 6: PolicyComplianceAgent (ID #104) ReAct Loop: strictly DENIES illegal payroll account drain", async () => {
    const payrollIntent = {
      proposedAction: "DISBURSAL_SETTLEMENT",
      accountId: "PAYROLL",
      amountUsdc: "8000.000000",
      declaredReason: "Paying vendor software bill from payroll surplus.",
      recipientAddress: "0x1111111111111111111111111111111111111111",
    };

    const agentResult = await swarm.complianceAgent.evaluateReasonBearingIntentTask(testSessionId, payrollIntent);
    assert.strictEqual(agentResult.success, false, "Payroll draw must fail");
    const intentTool = agentResult.toolCallsExecuted.find((t) => t.name === "evaluate_reason_bearing_intent");
    assert.ok(intentTool);
    assert.strictEqual(intentTool.result.data.decision, "DENY");
    assert.match(intentTool.result.data.reason, /PAYROLL.*strictly prohibited/i);
    console.log(`✓ PolicyComplianceAgent ReAct loop DENIED payroll draw: ${intentTool.result.data.reason}`);
  });

  it("Step 7: PolicyComplianceAgent (ID #104) ReAct Loop: ESCALATES large transaction to EIP-712 SPRS", async () => {
    const largeIntent = {
      proposedAction: "DISBURSAL_SETTLEMENT",
      accountId: "OPEX_DEV",
      amountUsdc: "85000.000000", // Exceeds standard 25,000 USDC autonomous limit
      declaredReason: "Annual upfront datacenter reservation at 25% bulk discount. Sound commercial trade-off.",
      recipientAddress: "0x1111111111111111111111111111111111111111",
    };

    const agentResult = await swarm.complianceAgent.evaluateReasonBearingIntentTask(testSessionId, largeIntent);
    assert.strictEqual(agentResult.success, true);
    const intentTool = agentResult.toolCallsExecuted.find((t) => t.name === "evaluate_reason_bearing_intent");
    assert.ok(intentTool);
    assert.strictEqual(intentTool.result.data.decision, "ESCALATE_TO_SPRS");
    assert.ok(intentTool.result.data.sprsRequestId?.startsWith("SPRS_"));
    console.log(`✓ PolicyComplianceAgent ReAct loop escalated to SPRS: Request ID ${intentTool.result.data.sprsRequestId}`);
  });

  it("Step 8: TreasurySentinelAgent (ID #101) ReAct Loop: evaluates Tripartite Balance & Sweeps", async () => {
    const agentResult = await swarm.sentinelAgent.evaluateLiquidityAndSweep(testSessionId, "OPEX_DEV", "50000.000000");
    assert.strictEqual(agentResult.success, true);
    const sweepTool = agentResult.toolCallsExecuted.find((t) => t.name === "sweep_excess_liquidity");
    assert.ok(sweepTool);
    assert.ok(sweepTool.result.data.encodedFunctionCall);
    console.log(`✓ TreasurySentinelAgent ReAct loop executed sweep: Tx ${sweepTool.result.data.txHash}`);
  });

  it("Step 9: DisbursalRouterAgent (ID #103) ReAct Loop: Disbursal with Keccak-256 Idempotency", async () => {
    const liabilities = await swarm.dynamicRecords.getLiabilities("OPEX_DEV");
    const awsLiability = liabilities.find((l) => l.vendorId === "VEND-AWS-01");
    assert.ok(awsLiability);

    const payment = {
      accountId: "OPEX_DEV",
      liabilityId: awsLiability.liabilityId,
      amountUsdc: awsLiability.amountUsdc,
      recipientAddress: awsLiability.payoutAddress,
      invoiceId: "INV-2026-AWS-01",
    };

    // First execution through agent -> PASSES
    const agentResult = await swarm.routerAgent.executeDisbursalTask(testSessionId, payment);
    assert.strictEqual(agentResult.success, true);
    const disburseTool = agentResult.toolCallsExecuted.find((t) => t.name === "execute_disbursal");
    assert.ok(disburseTool);
    assert.strictEqual(disburseTool.result.data.status, "SETTLED");
    assert.ok(disburseTool.result.data.idempotencyKey);
    console.log(`✓ DisbursalRouterAgent ReAct loop settled payment: Idempotency Key ${disburseTool.result.data.idempotencyKey}`);

    // Second execution through agent with SAME key -> STRICTLY BLOCKED!
    const duplicateResult = await swarm.routerAgent.executeDisbursalTask(testSessionId, payment);
    assert.strictEqual(duplicateResult.success, false, "Duplicate payment must be blocked");
    const dupTool = duplicateResult.toolCallsExecuted.find((t) => t.name === "execute_disbursal");
    assert.ok(dupTool);
    assert.match(dupTool.result.error || "", /IDEMPOTENCY DUPLICATE DETECTED/i);
    console.log(`✓ DisbursalRouterAgent ReAct loop blocked double spend: ${dupTool.result.error}`);
  });

  it("Step 10: DisbursalRouterAgent (ID #103) ReAct Loop: Multi-Account Waterfall Allocation protects Payroll", async () => {
    const balanceOverrides = {
      OPEX_DEV: { liquidUsdc: 5000, investedUsyc: 0 },
      OPEX_GROWTH: { liquidUsdc: 8000, investedUsyc: 0 },
      PAYROLL: { liquidUsdc: 50000, investedUsyc: 0 },
    };
    const agentResult = await swarm.routerAgent.planWaterfall(testSessionId, 4000, balanceOverrides);
    assert.strictEqual(agentResult.success, true);
    const waterfallTool = agentResult.toolCallsExecuted.find((t) => t.name === "plan_waterfall_allocation");
    assert.ok(waterfallTool);
    const waterfallPlan = waterfallTool.result.data;
    assert.ok(waterfallPlan.eligibleAccounts.length > 0);

    const payrollCandidate = waterfallPlan.eligibleAccounts.find((a: any) => a.metadata?.role === "PAYROLL");
    assert.strictEqual(payrollCandidate, undefined, "PAYROLL account must NEVER be an eligible waterfall candidate");
    console.log(`✓ DisbursalRouterAgent ReAct loop evaluated Waterfall: ${waterfallPlan.eligibleAccounts.length} eligible accounts (PAYROLL safely protected).`);
  });

  it("Step 11: LedgerWitnessAgent (ID #105) ReAct Loop: Unbroken Cryptographic SHA-256 Hash Chain", async () => {
    const voucher1 = {
      accountId: "OPEX_DEV",
      documentRef: "INV-2026-AWS-01",
      debitAccount: "2100_ACCOUNTS_PAYABLE",
      creditAccount: "1010_ARC_OPERATING_POOL",
      amountUsdc: "12500.000000",
      txHash: "0xarc_settlement_hash_aws",
    };

    const voucher2 = {
      accountId: "OPEX_DEV",
      documentRef: "INV-2026-AWS-02",
      debitAccount: "2100_ACCOUNTS_PAYABLE",
      creditAccount: "1010_ARC_OPERATING_POOL",
      amountUsdc: "3400.000000",
      txHash: "0xarc_settlement_hash_datadog",
    };

    const res1 = await swarm.witnessAgent.recordSettlementVoucher(testSessionId, voucher1);
    assert.strictEqual(res1.success, true);
    const tool1 = res1.toolCallsExecuted.find((t) => t.name === "post_document_linked_gl");
    assert.ok(tool1);

    const res2 = await swarm.witnessAgent.recordSettlementVoucher(testSessionId, voucher2);
    assert.strictEqual(res2.success, true);
    const tool2 = res2.toolCallsExecuted.find((t) => t.name === "post_document_linked_gl");
    assert.ok(tool2);

    assert.strictEqual(tool2.result.data.previousHash, tool1.result.data.currentHash, "Cryptographic hash chain MUST be unbroken!");
    console.log(`✓ LedgerWitnessAgent ReAct loop posted unbroken hash chain: Seq #${tool1.result.data.journalSequence} -> Seq #${tool2.result.data.journalSequence}`);
  });

  it("Step 12: Continuous Context Blackboard & Dual-Stream Compaction Verification", async () => {
    for (let i = 1; i <= 8; i++) {
      await swarm.contextManager.recordEvent({
        sessionId: testSessionId,
        agentId: 101,
        agentName: "TreasurySentinelAgent",
        eventType: "STATE_MUTATION",
        role: "assistant",
        content: `Audit cycle ${i}: Safe-to-invest assessed at 67,500 USDC.`,
        metadata: { cycle: i },
      });
    }

    const latestEpisode = await swarm.contextManager.getLatestCompactedEpisode(testSessionId);
    assert.ok(latestEpisode, "Background compaction episode must exist");
    assert.ok(latestEpisode.episodeIndex >= 1);
    assert.strictEqual(latestEpisode.deterministicAnchors.invariantCheckPassed, true);
    console.log(`✓ Dual-Stream Compaction verified: Episode #${latestEpisode.episodeIndex}`);
    console.log(` - Narrative Summary: ${latestEpisode.narrativeSummary}`);
    console.log(` - Locked Safe-to-Invest: ${latestEpisode.deterministicAnchors.safeToInvestUsdc} USDC`);
  });
});
