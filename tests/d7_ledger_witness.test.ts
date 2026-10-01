import {
  LedgerWitnessService as LedgerWitnessAgent,
  ReconciledReceiptError,
  LoudRoundingError,
} from "../src/services/ledgerWitnessService.js";
import { DbClient } from "../src/database/dbClient.js";
import { MasterJournalRepo } from "../src/database/repos/masterJournalRepo.js";
import { AuditLogRepo } from "../src/database/repos/auditLogRepo.js";
import { TreasuryAccountsRepo } from "../src/database/repos/treasuryAccountsRepo.js";
import { PolicyLoader } from "../src/config/policyLoader.js";
import { PublicClient, encodeEventTopics, parseAbiItem, toHex } from "viem";

async function runD7Tests() {
  console.log("==================================================");
  console.log("  D6 -> D7: LedgerWitnessAgent Comprehensive Audit");
  console.log("==================================================");

  let pass = 0;
  let fail = 0;
  const failures: string[] = [];

  function assert(condition: boolean, label: string) {
    if (condition) {
      console.log(`  ✓ ${label}`);
      pass++;
    } else {
      console.error(`  ✗ FAIL: ${label}`);
      fail++;
      failures.push(label);
    }
  }

  function assertEqual<T>(actual: T, expected: T, label: string) {
    if (actual === expected) {
      console.log(`  ✓ ${label}`);
      pass++;
    } else {
      console.error(`  ✗ FAIL: ${label} -> expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      fail++;
      failures.push(label);
    }
  }

  // ──────────────────────────────────────────────────────────
  // 1. SETUP & DB RESET
  // ──────────────────────────────────────────────────────────
  console.log("\n[Setup] Cleaning DB tables for fresh witness audit...");
  await DbClient.query("TRUNCATE TABLE master_system_journal CASCADE");
  await DbClient.query("TRUNCATE TABLE account_agent_audit_log CASCADE");
  await DbClient.query("TRUNCATE TABLE account_liabilities CASCADE");
  await DbClient.query("TRUNCATE TABLE treasury_accounts CASCADE");

  const { profile } = PolicyLoader.getActiveProfile();
  for (const acc of profile.operating_accounts) {
    await TreasuryAccountsRepo.upsertAccount({
      account_id: acc.account_id,
      name: acc.name,
      role: acc.role,
      wallet_address: `0x${acc.account_id.length.toString().padStart(40, "2")}` as `0x${string}`,
      chain_id: 5042002,
      min_operating_floor_usdc: acc.min_floor_usdc,
      safety_buffer_ratio: acc.safety_multiplier,
      is_active: true,
    });
  }

  // ──────────────────────────────────────────────────────────
  // 2. SEGREGATION OF DUTIES (Rule 4)
  // ──────────────────────────────────────────────────────────
  console.log("\n[Test 1] Segregation of Duties: LedgerWitness has zero signing capability");
  const agent = new LedgerWitnessAgent();
  assertEqual(agent.persona, "LedgerWitnessAgent", "Persona is LedgerWitnessAgent");
  assertEqual(agent.canSignTransactions, false, "canSignTransactions is FALSE (zero private keys)");
  assertEqual(agent.canWriteLedger, true, "canWriteLedger is TRUE (auditor write permissions)");
  assertEqual(agent.erc8004Id, 105, "ERC-8004 Agent ID is 105");

  // ──────────────────────────────────────────────────────────
  // 3. DOUBLE-ENTRY VOUCHER STANDARD
  // ──────────────────────────────────────────────────────────
  console.log("\n[Test 2] Double-Entry Accounting Vouchers");
  const sweepVoucher = agent.getDoubleEntryAccounts("AUTONOMOUS_SWEEP", "acc_engineering");
  assertEqual(
    sweepVoucher.debitAccount,
    "Asset:Investments:USYC:acc_engineering",
    "SWEEP Debit is Asset:Investments:USYC:acc_engineering"
  );
  assertEqual(
    sweepVoucher.creditAccount,
    "Asset:Cash:USDC:acc_engineering",
    "SWEEP Credit is Asset:Cash:USDC:acc_engineering"
  );

  const recallVoucher = agent.getDoubleEntryAccounts("AUTONOMOUS_RECALL", "acc_engineering");
  assertEqual(
    recallVoucher.debitAccount,
    "Asset:Cash:USDC:acc_engineering",
    "RECALL Debit is Asset:Cash:USDC:acc_engineering"
  );
  assertEqual(
    recallVoucher.creditAccount,
    "Asset:Investments:USYC:acc_engineering",
    "RECALL Credit is Asset:Investments:USYC:acc_engineering"
  );

  const disbursalVoucher = agent.getDoubleEntryAccounts(
    "DISBURSAL_PAYMENT",
    "acc_engineering",
    "vendor_aws",
    "INFRASTRUCTURE"
  );
  assertEqual(
    disbursalVoucher.debitAccount,
    "Expense:INFRASTRUCTURE:vendor_aws",
    "DISBURSAL Debit is Expense:INFRASTRUCTURE:vendor_aws"
  );
  assertEqual(
    disbursalVoucher.creditAccount,
    "Asset:Cash:USDC:acc_engineering",
    "DISBURSAL Credit is Asset:Cash:USDC:acc_engineering"
  );

  // ──────────────────────────────────────────────────────────
  // 4. INDEPENDENT RPC RECEIPT RECONCILIATION
  // ──────────────────────────────────────────────────────────
  console.log("\n[Test 3] Independent RPC Receipt Reconciliation & Event Decoding");

  const SENDER = "0x2222222222222222222222222222222222222222" as `0x${string}`;
  const VAULT = "0x3333333333333333333333333333333333333333" as `0x${string}`;
  const TX_HASH = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `0x${string}`;

  // Build a realistic simulated ERC-20 Transfer log for $320 USDC (320_000_000 micro-units)
  const transferAbi = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
  const topics = encodeEventTopics({
    abi: [transferAbi],
    eventName: "Transfer",
    args: {
      from: SENDER,
      to: VAULT,
    },
  });

  const mockReceipt = {
    transactionHash: TX_HASH,
    blockNumber: 123456n,
    blockHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as `0x${string}`,
    status: "success" as const,
    gasUsed: 42000n,
    from: SENDER,
    to: VAULT,
    logs: [
      {
        address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as `0x${string}`, // USDC
        topics,
        data: toHex(BigInt(320_000_000), { size: 32 }), // 320 USDC
      },
    ],
  };

  const mockClient = {
    getTransactionReceipt: async ({ hash }: { hash: `0x${string}` }) => {
      if (hash === TX_HASH) return mockReceipt;
      if (hash === "0xreverted00000000000000000000000000000000000000000000000000000000") {
        return { ...mockReceipt, status: "reverted" as const, transactionHash: hash };
      }
      return null;
    },
  } as unknown as PublicClient;

  const witnessWithMockRpc = new LedgerWitnessAgent(mockClient);

  // S1: Successful reconciliation with exact amount match
  const rec = await witnessWithMockRpc.reconcileTransactionReceipt(TX_HASH, {
    from: SENDER,
    to: VAULT,
    amountUsdc: 320.0,
  });
  assert(rec.status === "success", "Receipt status reconciled as 'success'");
  assertEqual(rec.transferredAmountUsdc, 320.0, "Decoded transferred amount is exactly 320.000000 USDC");
  assertEqual(rec.blockNumber, 123456n, "Block number confirmed at 123456");

  // S2: Reverted transaction throws ReconciledReceiptError
  let revertedCaught = false;
  try {
    await witnessWithMockRpc.reconcileTransactionReceipt(
      "0xreverted00000000000000000000000000000000000000000000000000000000"
    );
  } catch (err) {
    revertedCaught = err instanceof ReconciledReceiptError;
  }
  assert(revertedCaught, "Reverted transaction receipt throws ReconciledReceiptError");

  // ──────────────────────────────────────────────────────────
  // 5. FINANCIAL GUARDRAIL AUDITS (Rules 1, 3, 5)
  // ──────────────────────────────────────────────────────────
  console.log("\n[Test 4] Rule 3: Payee Substitution Protection");
  let payeeSubCaught = false;
  try {
    const ATTACKER_ADDR = "0x9999999999999999999999999999999999999999" as `0x${string}`;
    await witnessWithMockRpc.reconcileTransactionReceipt(TX_HASH, {
      to: ATTACKER_ADDR, // Expected attacker, but receipt sent to VAULT
      amountUsdc: 320.0,
    });
  } catch (err) {
    payeeSubCaught = err instanceof ReconciledReceiptError && (err as Error).message.includes("Payee Substitution Detected");
  }
  assert(payeeSubCaught, "Payee mismatch triggers Payee Substitution violation error");

  console.log("\n[Test 5] Rule 5: Refuse Silent Rounding (Loud Repair)");
  let roundingErrorCaught = false;
  try {
    // Expected 320.000001, but onchain is 320.000000
    await witnessWithMockRpc.reconcileTransactionReceipt(TX_HASH, {
      amountUsdc: 320.000001,
    });
  } catch (err) {
    roundingErrorCaught = err instanceof LoudRoundingError;
  }
  assert(roundingErrorCaught, "Micro-unit difference (0.000001 USDC) throws LoudRoundingError");

  console.log("\n[Test 6] Rule 1: Document-Linked Ledger Only");
  let docRefErrorCaught = false;
  try {
    await witnessWithMockRpc.recordJournalVoucher({
      accountId: "acc_engineering",
      actionType: "AUTONOMOUS_SWEEP",
      amountUsdc: 320,
      documentRef: "", // Violation: empty document reference
    });
  } catch (err) {
    docRefErrorCaught = (err as Error).message.includes("Rule 1 violation");
  }
  assert(docRefErrorCaught, "Empty documentRef throws Rule 1 violation error");

  // ──────────────────────────────────────────────────────────
  // 6. END-TO-END WITNESS TRANSACTION FLOW
  // ──────────────────────────────────────────────────────────
  console.log("\n[Test 7] End-to-End witnessTransaction: Receipt + Audit Log + Master Journal");
  const witnessRes = await witnessWithMockRpc.witnessTransaction({
    accountId: "acc_engineering",
    actionType: "AUTONOMOUS_SWEEP",
    txHash: TX_HASH,
    amountUsdc: 320.0,
    documentRef: "SWEEP_PO_2026_001",
    counterpartyAddress: VAULT,
    isAutonomous: true,
    preState: { liquidUsdc: 500, investedUsyc: 0 },
    postState: { liquidUsdc: 180, investedUsyc: 320 },
    reason: "Autonomous surplus yield sweep to USYC vault",
  });

  assert(witnessRes.reconciled, "Transaction witnessed and reconciled");
  assertEqual(witnessRes.journalEntry.amount_usdc, 320.0, "Journal entry amount matches 320.0 USDC");
  assertEqual(witnessRes.journalEntry.document_ref, "SWEEP_PO_2026_001", "Journal entry has verifiable documentRef");
  assertEqual(witnessRes.auditLog.actor_agent, "LedgerWitnessAgent", "Audit log actor_agent is LedgerWitnessAgent");
  assertEqual(witnessRes.auditLog.action_type, "AUTONOMOUS_SWEEP", "Audit log action_type is AUTONOMOUS_SWEEP");

  // ──────────────────────────────────────────────────────────
  // 7. SEQUENTIAL HASH CHAIN INTEGRITY & TAMPER DETECTION (Rule 4)
  // ──────────────────────────────────────────────────────────
  console.log("\n[Test 8] Cryptographic Master System Journal Hash Chaining & Tamper Detection");
  
  // Append 2 more vouchers to form a chain
  await witnessWithMockRpc.recordJournalVoucher({
    accountId: "acc_engineering",
    actionType: "CUSTOMER_FUNDING",
    amountUsdc: 1000.0,
    documentRef: "INV-CUST-9001",
  });

  await witnessWithMockRpc.recordJournalVoucher({
    accountId: "acc_engineering",
    actionType: "DISBURSAL_PAYMENT",
    amountUsdc: 150.0,
    documentRef: "PO-DATADOG-2026",
    vendorId: "vendor_datadog",
    category: "SAAS",
  });

  // Verify chain integrity
  const integrityInitial = await witnessWithMockRpc.verifyLedgerIntegrity();
  assert(integrityInitial.valid, "Master journal hash chain is cryptographically VALID");
  assertEqual(integrityInitial.totalEntries, 3, "Master journal contains exactly 3 chained entries");

  // Tamper test: Alter entry #2 in the database directly
  console.log("\n[Test 9] Tamper Detection: Malicious edit in sequence #2");
  const secondEntryRes = await DbClient.query(
    "SELECT sequence_id, amount_usdc FROM master_system_journal ORDER BY sequence_id ASC OFFSET 1 LIMIT 1"
  );
  const secondEntry = secondEntryRes.rows[0];
  const origAmount = Number(secondEntry.amount_usdc);

  await DbClient.query(
    "UPDATE master_system_journal SET amount_usdc = 999.000000 WHERE sequence_id = $1",
    [secondEntry.sequence_id]
  );

  const integrityTampered = await witnessWithMockRpc.verifyLedgerIntegrity();
  assert(!integrityTampered.valid, "Tampered journal entry is DETECTED as INVALID");
  assert(
    !!integrityTampered.brokenAtSequence,
    `Integrity check pinpointed broken sequence ID: ${integrityTampered.brokenAtSequence}`
  );

  // Restore entry so DB integrity is preserved
  await DbClient.query(
    "UPDATE master_system_journal SET amount_usdc = $1 WHERE sequence_id = $2",
    [origAmount, secondEntry.sequence_id]
  );
  const integrityRestored = await witnessWithMockRpc.verifyLedgerIntegrity();
  assert(integrityRestored.valid, "Ledger integrity restored to 100% valid state after correction");

  // ──────────────────────────────────────────────────────────
  // 8. CIRCLE WEBHOOK AUDITING
  // ──────────────────────────────────────────────────────────
  console.log("\n[Test 10] Circle Webhook Ingestion & Reconciliation");
  const webhookBody = JSON.stringify({
    notificationId: "notif_12345",
    type: "transactions.inbound",
    data: {
      id: "tx_inbound_99",
      state: "CONFIRMED",
      txHash: TX_HASH,
      amount: "320.00",
    },
    timestamp: new Date().toISOString(),
  });

  const webhookResult = await witnessWithMockRpc.reconcileCircleWebhook({
    rawBody: webhookBody,
  });
  assert(webhookResult.verified, "Circle webhook payload verified and ingested");
  assertEqual(webhookResult.payload.data.state, "CONFIRMED", "Webhook state is CONFIRMED");
  assert(!!webhookResult.reconciledReceipt, "Webhook automatically reconciled onchain transaction receipt");

  // ──────────────────────────────────────────────────────────
  // SUMMARY
  // ──────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(50));
  console.log(`  RESULTS: ${pass} passed, ${fail} failed`);
  if (failures.length > 0) {
    console.error("  FAILURES:");
    failures.forEach((f) => console.error(`    ✗ ${f}`));
  } else {
    console.log("  >>> ALL D6->D7 LEDGER WITNESS AUDIT TESTS PASSED <<<");
  }
  console.log("=".repeat(50));

  process.exit(fail > 0 ? 1 : 0);
}

runD7Tests().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});
