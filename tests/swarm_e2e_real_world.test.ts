import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import crypto from "crypto";
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

  it("Step 1: OnboardingAgent initializes enterprise ground truth in pgvector memory", async () => {
    await swarm.initializeEnterpriseSwarm();

    const results = await swarm.vectorMemory.queryRelevantMemory(
      "Corporate treasury governance bylaws for Arc L1 and USYC",
      ["company_bylaws"],
      2
    );

    assert.ok(results.length > 0, "Vector memory must return corporate bylaws");
    assert.match(results[0].title, /Treasury Policy/i);
    console.log(`✓ Vector memory retrieved: "${results[0].title}" (similarity: ${results[0].similarity.toFixed(4)})`);
  });

  it("Step 2: Golden Rule 3 Protection: Block Payee Substitution Attack", async () => {
    const maliciousInvoice = {
      invoiceId: "INV-POISON-666",
      poReference: "PO-2026-AWS-01",
      claimedAmountUsdc: "12500.000000",
      claimedPayoutAddress: "0xAttackerAddress66666666666666666666666666", // Imposter address!
    };

    const result = await swarm.toolRegistry.executeTool("verify_three_way_match", maliciousInvoice);
    assert.strictEqual(result.success, false, "3-Way Match MUST fail on payee substitution");
    assert.match(result.error || "", /PAYEE SUBSTITUTION DETECTED/i);
    console.log(`✓ Payee substitution attack blocked cleanly: ${result.error}`);
  });

  it("Step 3: Golden Rule 5 Protection: Reject Silent Rounding on Discrepant Amount", async () => {
    const roundedInvoice = {
      invoiceId: "INV-ROUNDING-FAIL",
      poReference: "PO-2026-AWS-01",
      claimedAmountUsdc: "12500.100000", // Mismatched by $0.10
      claimedPayoutAddress: "0x1111111111111111111111111111111111111111",
    };

    const result = await swarm.toolRegistry.executeTool("verify_three_way_match", roundedInvoice);
    assert.strictEqual(result.success, false, "3-Way match MUST reject silent rounding");
    assert.match(result.error || "", /Silent rounding rejected/i);
    console.log(`✓ Silent rounding rejected cleanly: ${result.error}`);
  });

  it("Step 4: LiabilityRadarAgent verifies authentic invoice and updates Dynamic Record 1", async () => {
    const legitimateInvoice = {
      invoiceId: "INV-2026-AWS-01",
      poReference: "PO-2026-AWS-01",
      claimedAmountUsdc: "12500.000000",
      claimedPayoutAddress: "0x1111111111111111111111111111111111111111",
    };

    const matchResult = await swarm.toolRegistry.executeTool("verify_three_way_match", legitimateInvoice);
    assert.strictEqual(matchResult.success, true, "Valid invoice must pass 3-way match");

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
    console.log(`✓ Legitimate invoice passed 3-way match. Dynamic Record 1 Liability ID: ${lia.liabilityId}`);
  });

  it("Step 5: PolicyComplianceAgent (ID #104) Evaluates Reason-Bearing Intent (PERMIT)", async () => {
    const intent = {
      proposedAction: "AUTONOMOUS_SWEEP",
      accountId: "OPEX_DEV",
      amountUsdc: "15000.000000",
      declaredReason: "Operating cash exceeds 7-day liability buffer by $67,500. Sweeping $15,000 to capture 5.1% USYC yield on Arc L1.",
    };

    const evalResult = await swarm.complianceAgent.evaluateIntent(intent);
    assert.strictEqual(evalResult.decision, "PERMIT");
    assert.ok(evalResult.clearanceCode?.startsWith("CLEAR-"));
    console.log(`✓ Reason-Bearing Intent cleared with PERMIT: Clearance Code ${evalResult.clearanceCode}`);
  });

  it("Step 6: PolicyComplianceAgent strictly DENIES illegal payroll account drain", async () => {
    const payrollIntent = {
      proposedAction: "DISBURSAL_SETTLEMENT",
      accountId: "PAYROLL", // Protected payroll account!
      amountUsdc: "8000.000000",
      declaredReason: "Paying vendor software bill from payroll surplus.",
      recipientAddress: "0x1111111111111111111111111111111111111111",
    };

    const evalResult = await swarm.complianceAgent.evaluateIntent(payrollIntent);
    assert.strictEqual(evalResult.decision, "DENY");
    assert.match(evalResult.reason, /PAYROLL.*strictly prohibited/i);
    console.log(`✓ Illegal payroll draw caught and DENIED: ${evalResult.reason}`);
  });

  it("Step 7: PolicyComplianceAgent ESCALATES large transaction to EIP-712 SPRS", async () => {
    const largeIntent = {
      proposedAction: "DISBURSAL_SETTLEMENT",
      accountId: "OPEX_DEV",
      amountUsdc: "85000.000000", // Exceeds standard 25,000 USDC autonomous limit
      declaredReason: "Annual upfront datacenter reservation at 25% bulk discount. Sound commercial trade-off.",
      recipientAddress: "0x1111111111111111111111111111111111111111",
    };

    const evalResult = await swarm.complianceAgent.evaluateIntent(largeIntent);
    assert.strictEqual(evalResult.decision, "ESCALATE_TO_SPRS");
    assert.ok(evalResult.sprsRequestId?.startsWith("SPRS_"));
    console.log(`✓ Exceeded limit with sound reason escalated to SPRS: Request ID ${evalResult.sprsRequestId}`);
  });

  it("Step 8: TreasurySentinelAgent evaluates Tripartite Balance & Dynamic Safe-to-Invest", async () => {
    const sti = await swarm.dynamicRecords.calculateSafeToInvest(
      "OPEX_DEV",
      7 * 86400,
      "20000.000000",
      100000000000n,
      50000000000n
    );

    assert.strictEqual(sti.tripartiteBalance.invariantSatisfied, true);
    assert.strictEqual(sti.safeToInvestUsdc, "67500.000000");
    assert.strictEqual(sti.status, "SWEEP_RECOMMENDED");
    console.log(`✓ Dynamic Record 2 Safe-to-Invest: ${sti.safeToInvestUsdc} USDC (${sti.status})`);

    // Execute smart contract sweep payload
    const sweepResult = await swarm.toolRegistry.executeTool("sweep_excess_liquidity", {
      accountId: "OPEX_DEV",
      amountUsdc: "50000.000000",
      clearanceCode: "CLEAR-AUDIT-001",
    });

    assert.strictEqual(sweepResult.success, true);
    assert.ok(sweepResult.data.encodedFunctionCall);
    console.log(`✓ Smart contract sweep payload encoded: ${sweepResult.data.encodedFunctionCall.slice(0, 34)}...`);
  });

  it("Step 9: DisbursalRouterAgent executes payment with Keccak-256 Idempotency Protection", async () => {
    const liabilities = await swarm.dynamicRecords.getLiabilities("OPEX_DEV");
    const awsLiability = liabilities.find((l) => l.vendorId === "VEND-AWS-01");
    assert.ok(awsLiability);

    // First execution -> PASSES
    const disbursalResult = await swarm.toolRegistry.executeTool("execute_disbursal", {
      accountId: "OPEX_DEV",
      liabilityId: awsLiability.liabilityId,
      amountUsdc: awsLiability.amountUsdc,
      recipientAddress: awsLiability.payoutAddress,
      invoiceId: "INV-2026-AWS-01",
    });

    assert.strictEqual(disbursalResult.success, true);
    assert.strictEqual(disbursalResult.data.status, "SETTLED");
    assert.ok(disbursalResult.data.idempotencyKey);
    console.log(`✓ Disbursal executed with Idempotency Key: ${disbursalResult.data.idempotencyKey}`);

    // Second execution with SAME idempotency key -> STRICTLY BLOCKED!
    const duplicateDisbursal = await swarm.toolRegistry.executeTool("execute_disbursal", {
      accountId: "OPEX_DEV",
      liabilityId: awsLiability.liabilityId,
      amountUsdc: awsLiability.amountUsdc,
      recipientAddress: awsLiability.payoutAddress,
      invoiceId: "INV-2026-AWS-01",
    });

    assert.strictEqual(duplicateDisbursal.success, false, "Duplicate payment must be blocked");
    assert.match(duplicateDisbursal.error || "", /IDEMPOTENCY DUPLICATE DETECTED/i);
    console.log(`✓ Double-spend attack blocked via Idempotency Key: ${duplicateDisbursal.error}`);
  });

  it("Step 10: Multi-Account Waterfall Allocation strictly protects Payroll", async () => {
    const balanceOverrides = {
      OPEX_DEV: { liquidUsdc: 5000, investedUsyc: 0 },
      OPEX_GROWTH: { liquidUsdc: 8000, investedUsyc: 0 },
      PAYROLL: { liquidUsdc: 50000, investedUsyc: 0 },
    };
    const waterfallPlan = await swarm.routerAgent.planWaterfall(4000, balanceOverrides);
    assert.ok(waterfallPlan.eligibleAccounts.length > 0);

    // Verify PAYROLL was excluded from the candidates
    const payrollCandidate = waterfallPlan.eligibleAccounts.find((a) => a.metadata.role === "PAYROLL");
    assert.strictEqual(payrollCandidate, undefined, "PAYROLL account must NEVER be an eligible waterfall candidate");
    console.log(`✓ Waterfall Allocation evaluated: ${waterfallPlan.eligibleAccounts.length} eligible accounts (PAYROLL safely protected).`);
  });


  it("Step 11: LedgerWitnessAgent builds unbroken Cryptographic SHA-256 Hash Chain", async () => {
    // Post entry 1
    const entry1 = await swarm.toolRegistry.executeTool("post_document_linked_gl", {
      accountId: "OPEX_DEV",
      documentRef: "INV-2026-AWS-01",
      debitAccount: "2100_ACCOUNTS_PAYABLE",
      creditAccount: "1010_ARC_OPERATING_POOL",
      amountUsdc: "12500.000000",
      txHash: "0xarc_settlement_hash_aws",
    });
    assert.strictEqual(entry1.success, true);

    // Post entry 2
    const entry2 = await swarm.toolRegistry.executeTool("post_document_linked_gl", {
      accountId: "OPEX_DEV",
      documentRef: "INV-2026-AWS-02",
      debitAccount: "2100_ACCOUNTS_PAYABLE",
      creditAccount: "1010_ARC_OPERATING_POOL",
      amountUsdc: "3400.000000",
      txHash: "0xarc_settlement_hash_datadog",
    });
    assert.strictEqual(entry2.success, true);

    // Assert that entry2's previousHash matches entry1's currentHash!
    assert.strictEqual(entry2.data.previousHash, entry1.data.currentHash, "Cryptographic hash chain MUST be unbroken!");
    console.log(`✓ Unbroken Cryptographic Hash Chain verified: Sequence #${entry1.data.journalSequence} -> Sequence #${entry2.data.journalSequence}`);
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
