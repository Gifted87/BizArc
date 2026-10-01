import {
  LedgerWitnessAgent,
  ReconciledReceiptError,
  LoudRoundingError,
} from "../src/agents/ledgerWitnessAgent.js";
import { DbClient } from "../src/database/dbClient.js";
import { MasterJournalRepo } from "../src/database/repos/masterJournalRepo.js";
import { AuditLogRepo } from "../src/database/repos/auditLogRepo.js";
import { TreasuryAccountsRepo } from "../src/database/repos/treasuryAccountsRepo.js";
import { VendorMasterRepo } from "../src/database/repos/vendorMasterRepo.js";
import { PolicyLoader } from "../src/config/policyLoader.js";
import { encodeEventTopics, parseAbiItem, toHex } from "viem";

/**
 * INDEPENDENT REAL-WORLD AUDIT SUITE FOR D6 -> D7:
 * LedgerWitnessAgent & Tamper-Evident System Journal
 *
 * Verifies Segregation of Duties (zero keys), Double-Entry Accounting Vouchers,
 * Independent RPC Receipt Witnessing, Rule 3 Payee Substitution Protection,
 * Rule 5 Loud Repair on micro-rounding, Cryptographic Hash Chaining, and
 * Attack Simulation on Database Tampering.
 *
 * Executed against live PostgreSQL 'bizarc' database.
 */
async function runIndependentD7Audit() {
  console.log("================================================================================");
  console.log("    INDEPENDENT REAL-WORLD AUDIT: D6 -> D7 LEDGER WITNESS & MASTER JOURNAL      ");
  console.log("================================================================================");

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

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. SETUP & REAL DATABASE CLEANUP
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n[Setup] Cleaning database tables for independent D7 audit...");
  await DbClient.query("TRUNCATE TABLE master_system_journal CASCADE");
  await DbClient.query("TRUNCATE TABLE account_agent_audit_log CASCADE");
  await DbClient.query("TRUNCATE TABLE permission_requests CASCADE");
  await DbClient.query("TRUNCATE TABLE account_liabilities CASCADE");
  await DbClient.query("TRUNCATE TABLE vendor_master_registry CASCADE");
  await DbClient.query("TRUNCATE TABLE treasury_accounts CASCADE");

  const { profile } = PolicyLoader.getActiveProfile();
  for (const acc of profile.operating_accounts) {
    await TreasuryAccountsRepo.upsertAccount({
      account_id: acc.account_id,
      name: acc.name,
      role: acc.role,
      wallet_address: `0x${acc.account_id.length.toString().padStart(40, "7")}` as `0x${string}`,
      chain_id: 5042002,
      min_operating_floor_usdc: acc.min_floor_usdc,
      safety_buffer_ratio: acc.safety_multiplier,
      is_active: true,
    });
  }

  // Seed verified vendor
  const VENDOR_AWS = "vnd_aws_cloud";
  const VENDOR_AWS_ADDR = "0x7777777777777777777777777777777777777777" as `0x${string}`;
  await VendorMasterRepo.registerVendor({
    vendor_id: VENDOR_AWS,
    name: "Amazon Web Services Inc.",
    verified_payout_address: VENDOR_AWS_ADDR,
    verified_by_admin: "admin_secops",
    last_verified_at: new Date(),
    change_lock: true,
  });

  const witnessAgent = new LedgerWitnessAgent();

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. AUDIT: SEGREGATION OF DUTIES (ZERO-SIGNING MODEL)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n[Audit 1] Segregation of Duties: LedgerWitness has Zero Private Keys");
  assertEqual(witnessAgent.persona, "LedgerWitnessAgent", "Persona confirmed as LedgerWitnessAgent");
  assertEqual(witnessAgent.canSignTransactions, false, "canSignTransactions is STRICTLY FALSE (no private keys)");
  assertEqual(witnessAgent.canWriteLedger, true, "canWriteLedger is TRUE (authoritative ledger writes)");
  assertEqual(witnessAgent.erc8004Id, 105, "ERC-8004 Identity registered as Agent 105");

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. AUDIT: DOUBLE-ENTRY ACCOUNTING VOUCHERS (DEBITS = CREDITS)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n[Audit 2] Double-Entry Accounting Voucher Classification");

  const sweepAccounts = witnessAgent.getDoubleEntryAccounts("AUTONOMOUS_SWEEP", "acc_engineering");
  assertEqual(sweepAccounts.debitAccount, "Asset:Investments:USYC:acc_engineering", "SWEEP Debits USYC Investment asset");
  assertEqual(sweepAccounts.creditAccount, "Asset:Cash:USDC:acc_engineering", "SWEEP Credits liquid USDC asset");

  const recallAccounts = witnessAgent.getDoubleEntryAccounts("AUTONOMOUS_RECALL", "acc_engineering");
  assertEqual(recallAccounts.debitAccount, "Asset:Cash:USDC:acc_engineering", "RECALL Debits liquid USDC asset");
  assertEqual(recallAccounts.creditAccount, "Asset:Investments:USYC:acc_engineering", "RECALL Credits USYC Investment asset");

  const disbursalAccounts = witnessAgent.getDoubleEntryAccounts("DISBURSAL_PAYMENT", "acc_engineering", "vnd_aws_cloud", "INFRASTRUCTURE");
  assertEqual(disbursalAccounts.debitAccount, "Expense:INFRASTRUCTURE:vnd_aws_cloud", "DISBURSAL Debits vendor expense account");
  assertEqual(disbursalAccounts.creditAccount, "Asset:Cash:USDC:acc_engineering", "DISBURSAL Credits liquid cash asset");

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. AUDIT: INDEPENDENT RPC RECEIPT RECONCILIATION
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n[Audit 3] Independent RPC Receipt Verification & Event Decoding");

  const TX_RECONCILE = "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890" as `0x${string}`;
  const mockPublicClient = {
    getTransactionReceipt: async ({ hash }: { hash: `0x${string}` }) => {
      const transferEventAbi = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
      const topics = encodeEventTopics({
        abi: [transferEventAbi],
        eventName: "Transfer",
        args: {
          from: "0x1111111111111111111111111111111111111111",
          to: "0x2222222222222222222222222222222222222222",
        },
      });

      return {
        status: "success",
        blockNumber: 492010n,
        transactionHash: hash,
        from: "0x1111111111111111111111111111111111111111" as `0x${string}`,
        to: "0x2222222222222222222222222222222222222222" as `0x${string}`,
        logs: [
          {
            address: "0x3600000000000000000000000000000000000000",
            topics,
            data: toHex(500000000n, { size: 32 }), // 500.000000 USDC (6 decimals)
          },
        ],
      };
    },
  } as any;

  const witnessWithClient = new LedgerWitnessAgent(mockPublicClient);
  const reconciled = await witnessWithClient.reconcileTransactionReceipt(TX_RECONCILE);

  assertEqual(reconciled.status, "success", "Receipt status reconciled as success");
  assertEqual(reconciled.transferredAmountUsdc, 500.0, "Decoded amount is exactly 500.000000 USDC");
  assertEqual(reconciled.blockNumber, 492010n, "Block number verified independently");

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. AUDIT: RULE 3 PAYEE SUBSTITUTION CHECK IN WITNESS
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n[Audit 4] Rule 3: Payee Substitution Enforcement by LedgerWitness");
  const ATTACKER_ADDR = "0xdead00000000000000000000000000000000dead" as `0x${string}`;

  let caughtPayeeViolation = false;
  try {
    await witnessWithClient.reconcileTransactionReceipt(TX_RECONCILE, {
      to: ATTACKER_ADDR, // Expected attacker, but receipt sent to actual recipient
    });
  } catch (err: any) {
    caughtPayeeViolation = err instanceof ReconciledReceiptError && err.message.includes("Payee Substitution");
  }
  assert(caughtPayeeViolation, "Witness aborted write due to Payee Substitution Detection (Rule 3)");

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. AUDIT: RULE 5 LOUD REPAIR (MICRO-ROUNDING SHORTFALL RESISTANCE)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n[Audit 5] Rule 5: Refusal of Silent Rounding (Loud Repair)");
  let caughtRoundingError = false;
  try {
    await witnessWithClient.reconcileTransactionReceipt(TX_RECONCILE, {
      amountUsdc: 500.000001, // 1 micro-unit discrepancy!
    });
  } catch (err: any) {
    caughtRoundingError = err instanceof LoudRoundingError;
  }
  assert(caughtRoundingError, "Witness rejected micro-unit difference of 0.000001 USDC (Rule 5)");

  // ─────────────────────────────────────────────────────────────────────────────
  // 7. AUDIT: RULE 1 DOCUMENT LINKING ENFORCEMENT
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n[Audit 6] Rule 1: Document-Linked Ledger Only");
  let caughtRule1 = false;
  try {
    await witnessWithClient.recordJournalVoucher({
      accountId: "acc_engineering",
      actionType: "AUTONOMOUS_SWEEP",
      amountUsdc: 500.0,
      documentRef: "", // Empty document reference!
    });
  } catch (err: any) {
    caughtRule1 = err.message.includes("Rule 1 violation");
  }
  assert(caughtRule1, "Witness rejected transaction without verifiable document reference (Rule 1)");

  // ─────────────────────────────────────────────────────────────────────────────
  // 8. AUDIT: END-TO-END WITNESSING, AUDIT LOG & MASTER JOURNAL PERSISTENCE
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n[Audit 7] End-to-End Transaction Witnessing & Chained Recording");
  const witnessRes = await witnessWithClient.witnessTransaction({
    txHash: "0x4444444444444444444444444444444444444444444444444444444444444444",
    accountId: "acc_engineering",
    actionType: "AUTONOMOUS_SWEEP",
    amountUsdc: 500.0,
    documentRef: "doc_sweep_verified_plan_771",
  });

  assertEqual(witnessRes.receipt.status, "success", "Transaction witnessed and reconciled");
  assertEqual(witnessRes.journalEntry.amount_usdc, 500.0, "Master journal amount matches exactly 500.0 USDC");
  assertEqual(witnessRes.journalEntry.document_ref, "doc_sweep_verified_plan_771", "Journal record links to verified document");

  // Verify PostgreSQL audit log record
  const auditLogs = await AuditLogRepo.getAuditLogsByAccount("acc_engineering");
  const loggedSweep = auditLogs.find((l) => l.action_type === "AUTONOMOUS_SWEEP");
  assert(Boolean(loggedSweep), "Audit log entry created in account_agent_audit_log");
  assertEqual(loggedSweep?.actor_agent, "LedgerWitnessAgent", "Audit log records actor as LedgerWitnessAgent");
  assertEqual(loggedSweep?.amount_usdc, 500.0, "Audit log amount matches 500.0 USDC");

  // ─────────────────────────────────────────────────────────────────────────────
  // 9. AUDIT: CRYPTOGRAPHIC MASTER JOURNAL HASH CHAINING & INTEGRITY AUDITING
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n[Audit 8] Cryptographic Master System Journal Hash Chaining");

  // Add two more chained journal entries
  await witnessWithClient.witnessTransaction({
    txHash: "0x5555555555555555555555555555555555555555555555555555555555555555",
    accountId: "acc_engineering",
    actionType: "AUTONOMOUS_SWEEP",
    amountUsdc: 500.0,
    documentRef: "doc_sweep_chain_entry_2",
  });

  await witnessWithClient.witnessTransaction({
    txHash: "0x6666666666666666666666666666666666666666666666666666666666666666",
    accountId: "acc_engineering",
    actionType: "AUTONOMOUS_SWEEP",
    amountUsdc: 500.0,
    documentRef: "doc_sweep_chain_entry_3",
  });

  const chainAudit = await witnessWithClient.verifyLedgerIntegrity();
  assertEqual(chainAudit.valid, true, "Master journal hash chain is cryptographically VALID");
  assertEqual(chainAudit.totalEntries, 3, "Master journal verified all 3 sequential entries");

  // ─────────────────────────────────────────────────────────────────────────────
  // 10. AUDIT: TAMPER DETECTION (MALICIOUS ATTACK ON POSTGRESQL JOURNAL)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n[Audit 9] Database Attack Simulation: Malicious Direct SQL Tampering");

  const journalEntries = await MasterJournalRepo.getAllEntries();
  const targetEntry = journalEntries[1]; // Tamper entry #2

  // Attacker covertly changes amount from 500 to 999 via raw SQL
  await DbClient.query("UPDATE master_system_journal SET amount_usdc = 999.0 WHERE sequence_id = $1", [targetEntry.sequence_id]);

  const tamperedAudit = await witnessWithClient.verifyLedgerIntegrity();
  assertEqual(tamperedAudit.valid, false, "Tampered journal entry is INSTANTLY DETECTED as INVALID");
  assertEqual(tamperedAudit.brokenAtSequence, String(targetEntry.sequence_id), "Integrity check correctly isolated broken sequence ID");

  // Restore the record to keep state clean
  await DbClient.query("UPDATE master_system_journal SET amount_usdc = 500.0 WHERE sequence_id = $1", [targetEntry.sequence_id]);
  const restoredAudit = await witnessWithClient.verifyLedgerIntegrity();
  assertEqual(restoredAudit.valid, true, "Ledger integrity confirmed valid after restoring tampered record");

  // ─────────────────────────────────────────────────────────────────────────────
  // 11. AUDIT: CIRCLE WEBHOOK INGESTION & INDEPENDENT RECONCILIATION
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n[Audit 10] Independent Circle Webhook Reconciliation");
  const webhookBody = JSON.stringify({
    notificationId: "notif_audit_circle_9918",
    type: "transactions.inbound",
    data: {
      id: "tx_inbound_circle_001",
      state: "CONFIRMED",
      txHash: TX_RECONCILE,
      amount: "500.00",
    },
    timestamp: new Date().toISOString(),
  });

  const webhookResult = await witnessWithClient.reconcileCircleWebhook({
    rawBody: webhookBody,
  });

  assertEqual(webhookResult.verified, true, "Circle webhook payload verified and ingested");
  assertEqual(webhookResult.payload.data.state, "CONFIRMED", "Webhook state is CONFIRMED");
  assert(Boolean(webhookResult.reconciledReceipt), "Webhook automatically reconciled independent RPC receipt");

  // ─────────────────────────────────────────────────────────────────────────────
  // SUMMARY
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(80));
  console.log(`  INDEPENDENT D7 AUDIT COMPLETE: ${pass} passed, ${fail} failed`);
  if (failures.length > 0) {
    console.error("  FAILURES:");
    failures.forEach((f) => console.error(`    ✗ ${f}`));
  } else {
    console.log("  >>> ALL D6->D7 LEDGER WITNESS AUDIT SCENARIOS CONFIRMED PASSING <<<");
  }
  console.log("=".repeat(80));

  process.exit(fail > 0 ? 1 : 0);
}

runIndependentD7Audit().catch((err) => {
  console.error("[FATAL D7 AUDIT ERROR]", err);
  process.exit(1);
});
