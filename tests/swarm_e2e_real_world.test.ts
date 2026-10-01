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
      compactionThreshold: 6, // Low threshold to test rolling compaction
    });

    // Clean up test account liabilities for clean calculation
    await DbClient.query(`DELETE FROM account_liabilities WHERE account_id = 'OPEX_DEV';`);

    // Seed test accounts in database
    await DbClient.query(`
      INSERT INTO treasury_accounts (account_id, name, role, wallet_address, min_operating_floor_usdc)
      VALUES ('OPEX_DEV', 'Dev Ops Pool', 'OPEX_DEV', '0x9999999999999999999999999999999999999999', 500.000000)
      ON CONFLICT (account_id) DO NOTHING;
    `);

    // Seed verified vendor master registry (Rule 3)
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

    // Query vector memory to verify HNSW cosine index
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
    // Attempt to verify an invoice with an attacker's modified payout address
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
    // Attempt to verify an invoice where amount differs by 10 cents
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
    // Legitimate invoice
    const legitimateInvoice = {
      invoiceId: "INV-2026-AWS-01",
      poReference: "PO-2026-AWS-01",
      claimedAmountUsdc: "12500.000000",
      claimedPayoutAddress: "0x1111111111111111111111111111111111111111",
    };

    const matchResult = await swarm.toolRegistry.executeTool("verify_three_way_match", legitimateInvoice);
    assert.strictEqual(matchResult.success, true, "Valid invoice must pass 3-way match");

    // Upsert into Dynamic Record 1
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

  it("Step 5: TreasurySentinelAgent evaluates Tripartite Balance & Dynamic Safe-to-Invest", async () => {
    // Current state: 100,000 Liquid, 50,000 Invested in USYC -> Available: 150,000
    // Target reserve: 20,000. Liabilities: 12,500 AWS.
    // Expected SafeToInvest: 100,000 - (12,500 + 20,000) = 67,500.000000 USDC.
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
    console.log(`✓ Dynamic Record 2 Safe-to-Invest calculated: ${sti.safeToInvestUsdc} USDC (${sti.status})`);

    // Execute autonomous sweep to USYC Yield Vault
    const sweepResult = await swarm.toolRegistry.executeTool("sweep_excess_liquidity", {
      accountId: "OPEX_DEV",
      amountUsdc: "50000.000000",
    });

    assert.strictEqual(sweepResult.success, true);
    assert.ok(sweepResult.data.txHash);
    console.log(`✓ Autonomous sweep to USYC executed: TxHash ${sweepResult.data.txHash}`);
  });

  it("Step 6: DisbursalRouterAgent stages & executes payment on Arc L1", async () => {
    const liabilities = await swarm.dynamicRecords.getLiabilities("OPEX_DEV");
    const awsLiability = liabilities.find((l) => l.vendorId === "VEND-AWS-01");
    assert.ok(awsLiability, "Must find AWS liability in Record 1");

    const disbursalResult = await swarm.toolRegistry.executeTool("execute_disbursal", {
      accountId: "OPEX_DEV",
      liabilityId: awsLiability.liabilityId,
      amountUsdc: awsLiability.amountUsdc,
      recipientAddress: awsLiability.payoutAddress,
    });

    assert.strictEqual(disbursalResult.success, true);
    assert.strictEqual(disbursalResult.data.status, "SETTLED");
    console.log(`✓ Disbursal executed via DisbursalVault: ${disbursalResult.data.txHash}`);
  });

  it("Step 7: LedgerWitnessAgent posts document-linked entry to ERP & Master System Journal", async () => {
    const witnessResult = await swarm.toolRegistry.executeTool("post_document_linked_gl", {
      accountId: "OPEX_DEV",
      documentRef: "INV-2026-AWS-01",
      debitAccount: "2100_ACCOUNTS_PAYABLE",
      creditAccount: "1010_ARC_OPERATING_POOL",
      amountUsdc: "12500.000000",
      txHash: "0xarc_settlement_hash_aws",
    });

    assert.strictEqual(witnessResult.success, true);
    assert.ok(witnessResult.data.journalSequence);
    console.log(`✓ Master Journal entry recorded: Sequence #${witnessResult.data.journalSequence}`);
  });

  it("Step 8: Continuous Context Blackboard & Dual-Stream Compaction Verification", async () => {
    // Generate additional swarm events to force background rolling compaction
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
