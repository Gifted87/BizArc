/**
 * D4, D5, D6 SEMANTIC & INTEGRATION TEST SUITE
 * ============================================
 * Covers:
 *   D6: PostgreSQL Relational Ledger Schema & Repositories
 *       - 6 core tables: treasury_accounts, account_liabilities, vendor_master_registry,
 *         permission_requests, account_agent_audit_log, master_system_journal
 *       - Rule 1: Document-Linked Ledgers Only (rejection of entries without doc ref)
 *       - Rule 4: SHA-256 Hash-Chaining & Tamper Detection
 *       - Rule 5: Exact Arithmetic (Refusal of silent rounding)
 *   D4: Account Registration & AccountShares Orchestration
 *       - Synchronize accounts from active PRODUCTION_TESTNET profile
 *       - DB & Onchain registration verification
 *       - Payroll isolation & strict account parameters
 *   D5: Vendor Allowlist, Caps, EIP-712 & Idempotency Orchestration
 *       - Rule 3: Vendor Master Change Control & Payee Substitution Detection
 *       - Rule 2: Three-Way Match (PO, Goods Delivery, Invoice)
 *       - Deterministic Idempotency Key generation
 *       - Policy Spending Caps (single-tx gate vs daily cap)
 *       - EIP-712 Signature Generation & Recoverability
 */

import { DbClient } from "../src/database/dbClient.js";
import { runMigrations } from "../src/database/migrate.js";
import { TreasuryAccountsRepo } from "../src/database/repos/treasuryAccountsRepo.js";
import { LiabilityRepo } from "../src/database/repos/liabilityRepo.js";
import { VendorMasterRepo } from "../src/database/repos/vendorMasterRepo.js";
import { PermissionRequestRepo } from "../src/database/repos/permissionRequestRepo.js";
import { AuditLogRepo } from "../src/database/repos/auditLogRepo.js";
import { MasterJournalRepo, GENESIS_PREVIOUS_HASH } from "../src/database/repos/masterJournalRepo.js";
import { AccountRegistrationService } from "../src/services/accountRegistrationService.js";
import { VendorMasterService, DEFAULT_PRODUCTION_VENDORS } from "../src/services/vendorMasterService.js";
import { DisbursalVaultService } from "../src/contracts/disbursalVaultService.js";
import { CentralTreasuryYieldVaultService } from "../src/contracts/centralTreasuryYieldVaultService.js";
import { PolicyLoader } from "../src/config/policyLoader.js";
import { privateKeyToAccount } from "viem/accounts";
import { recoverTypedDataAddress } from "viem";

let pass = 0;
let fail = 0;
const failures: string[] = [];

function assert(condition: boolean, label: string): void {
  if (condition) {
    console.log(`  ✓ ${label}`);
    pass++;
  } else {
    console.error(`  ✗ FAIL: ${label}`);
    failures.push(label);
    fail++;
  }
}

async function runTests() {
  console.log("============================================================");
  console.log("=== RUNNING D4, D5, D6 INTEGRATION & SEMANTIC TEST SUITE ===");
  console.log("============================================================\n");

  // ──────────────────────────────────────────────────────────
  // 1. D6: DATABASE INFRASTRUCTURE & MIGRATIONS
  // ──────────────────────────────────────────────────────────
  console.log("--- 1. D6: PostgreSQL Foundation & Migration Engine ---");
  const connected = await DbClient.checkConnection();
  assert(connected, "PostgreSQL connection to 'bizarc' database is active and responsive");

  await runMigrations();
  await DbClient.query("TRUNCATE TABLE master_system_journal CASCADE");
  await DbClient.query("TRUNCATE TABLE account_agent_audit_log CASCADE");
  await DbClient.query("TRUNCATE TABLE account_liabilities CASCADE");
  await DbClient.query("TRUNCATE TABLE permission_requests CASCADE");
  await DbClient.query("TRUNCATE TABLE vendor_master_registry CASCADE");
  await DbClient.query("TRUNCATE TABLE treasury_accounts CASCADE");
  assert(true, "Migration runner executed schema.sql without error");

  // ──────────────────────────────────────────────────────────
  // 2. D6: REPOSITORIES CRUD & RELATIONAL INTEGRITY
  // ──────────────────────────────────────────────────────────
  console.log("\n--- 2. D6: Core Repositories & Relational Constraints ---");

  // 2.1 Treasury Accounts
  const testAccount = await TreasuryAccountsRepo.upsertAccount({
    account_id: "acc_test_ops",
    name: "Test Operations Account",
    role: "OPEX_DEV",
    wallet_address: "0x1234567890123456789012345678901234567890",
    chain_id: 5042002,
    min_operating_floor_usdc: 75.0,
    safety_buffer_ratio: 1.25,
    is_active: true,
  });
  assert(testAccount.account_id === "acc_test_ops", "TreasuryAccountsRepo: upsertAccount persists and returns record");
  assert(testAccount.min_operating_floor_usdc === 75.0, "TreasuryAccountsRepo: operating floor numeric parsing correct");

  const fetchedAcc = await TreasuryAccountsRepo.getAccountById("acc_test_ops");
  assert(fetchedAcc !== null && fetchedAcc.wallet_address.toLowerCase() === "0x1234567890123456789012345678901234567890", "TreasuryAccountsRepo: getAccountById returns matching account");

  // 2.2 Account Liabilities
  const now = new Date();
  const dueDate5Days = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
  const createdLiab = await LiabilityRepo.createLiability({
    account_id: "acc_test_ops",
    vendor_id: "vnd_aws_cloud",
    title: "AWS Serverless Hosting Bill",
    category: "INFRASTRUCTURE",
    amount_usdc: 150.0,
    due_date: dueDate5Days,
    payout_address: "0xaaaa111111111111111111111111111111111101",
    status: "SCHEDULED",
  });
  assert(Boolean(createdLiab.liability_id), "LiabilityRepo: createLiability generates UUID primary key");
  assert(createdLiab.amount_usdc === 150.0, "LiabilityRepo: amount_usdc stored with micro-USDC precision");

  const upcoming = await LiabilityRepo.getUpcomingLiabilities(7, "acc_test_ops");
  assert(upcoming.length >= 1, "LiabilityRepo: getUpcomingLiabilities retrieves liabilities due within 7 days");

  await LiabilityRepo.updateLiabilityStatus(createdLiab.liability_id!, "DISBURSED");
  const updatedLiab = await LiabilityRepo.getLiabilityById(createdLiab.liability_id!);
  assert(updatedLiab?.status === "DISBURSED", "LiabilityRepo: status updated to DISBURSED");

  // 2.3 Permission Requests (SPRS)
  const reqId = `sprs_${Date.now()}`;
  const createdReq = await PermissionRequestRepo.createRequest({
    request_id: reqId,
    action_type: "VENDOR_PAYMENT",
    reason: "AWS server invoice exceeding threshold",
    amount_usdc: 600.0,
    status: "PENDING",
    payload: { vendor: "vnd_aws_cloud", po: "PO-9901" },
  });
  assert(createdReq.request_id === reqId, "PermissionRequestRepo: creates SPRS request in PENDING state");

  await PermissionRequestRepo.updateStatus({
    requestId: reqId,
    status: "APPROVED",
    adminInstruction: "Authorized by SecOps Admin",
  });
  const fetchedReq = await PermissionRequestRepo.getRequestById(reqId);
  assert(fetchedReq?.status === "APPROVED" && fetchedReq.admin_instruction?.includes("SecOps"), "PermissionRequestRepo: status transition to APPROVED with instruction");

  // 2.4 Audit Log
  const auditEntry = await AuditLogRepo.appendAuditLog({
    account_id: "acc_test_ops",
    action_type: "AUTONOMOUS_SWEEP_EVAL",
    amount_usdc: 25.0,
    is_autonomous: true,
    reason: "SafeToInvest exceeded hysteresis band",
    pre_state_snapshot: { liquid: 120.0, targetReserve: 95.0 },
    post_state_snapshot: { liquid: 95.0, invested: 25.0 },
    actor_agent: "TreasurySentinelAgent",
  });
  assert(Boolean(auditEntry.log_id), "AuditLogRepo: appends immutable log entry with serial id");

  const logs = await AuditLogRepo.getAuditLogsByAccount("acc_test_ops");
  assert(logs.length >= 1 && logs[0].actor_agent === "TreasurySentinelAgent", "AuditLogRepo: queries audit trail for account");

  // ──────────────────────────────────────────────────────────
  // 3. D6: MASTER SYSTEM JOURNAL — HASH CHAINING & INTEGRITY (RULE 1 & 4)
  // ──────────────────────────────────────────────────────────
  console.log("\n--- 3. D6: Master System Journal Cryptographic Hash Chaining ---");

  // Rule 1: Document reference is mandatory
  let rule1ErrorCaught = false;
  try {
    await MasterJournalRepo.appendEntry({
      account_id: "acc_test_ops",
      action_type: "PHANTOM_PAYMENT",
      debit_account: "Expense:Server",
      credit_account: "Asset:USDC",
      amount_usdc: 100.0,
      document_ref: "", // Empty! Violation of Rule 1
    });
  } catch (err: any) {
    rule1ErrorCaught = err.message.includes("Rule 1 violation");
  }
  assert(rule1ErrorCaught, "Rule 1 Enforced: Journal rejects payment entry lacking verifiable document_ref");

  // Rule 5: Positive non-zero amount
  let rule5ErrorCaught = false;
  try {
    await MasterJournalRepo.appendEntry({
      account_id: "acc_test_ops",
      action_type: "ROUNDING_SLIP",
      debit_account: "Expense:Misc",
      credit_account: "Asset:USDC",
      amount_usdc: 0.0,
      document_ref: "DOC-000",
    });
  } catch (err: any) {
    rule5ErrorCaught = err.message.includes("amount_usdc must be positive");
  }
  assert(rule5ErrorCaught, "Rule 5 Enforced: Journal refuses non-positive amounts (no silent repair)");

  // Append 3 chained entries
  const entry1 = await MasterJournalRepo.appendEntry({
    account_id: "acc_test_ops",
    action_type: "SWEEP_USYC",
    debit_account: "Asset:USYC_Vault",
    credit_account: "Asset:Operating_USDC",
    amount_usdc: 25.0,
    document_ref: "TX-SWEEP-001",
  });
  assert(entry1.previous_hash.length === 64, "MasterJournalRepo: entry1 links to previous SHA-256 hash");

  const entry2 = await MasterJournalRepo.appendEntry({
    account_id: "acc_test_ops",
    action_type: "YIELD_ACCRUAL",
    debit_account: "Asset:USYC_Vault",
    credit_account: "Revenue:Yield",
    amount_usdc: 0.125430,
    document_ref: "NAV-ORACLE-001",
  });
  assert(entry2.previous_hash === entry1.current_hash, "MasterJournalRepo: entry2 previous_hash strictly matches entry1 current_hash");

  const entry3 = await MasterJournalRepo.appendEntry({
    account_id: "acc_test_ops",
    action_type: "VENDOR_PAYMENT",
    debit_account: "Expense:Cloud_Infrastructure",
    credit_account: "Asset:Operating_USDC",
    amount_usdc: 150.0,
    document_ref: "INV-AWS-2026-10",
  });
  assert(entry3.previous_hash === entry2.current_hash, "MasterJournalRepo: entry3 previous_hash strictly matches entry2 current_hash");

  // Cryptographic integrity verification
  const initialIntegrity = await MasterJournalRepo.verifyChainIntegrity();
  assert(initialIntegrity.valid, `Cryptographic chain verification passed across all ${initialIntegrity.totalEntries} entries`);

  // Tamper detection test: Simulate attacker directly modifying the database row
  console.log("  Testing tamper detection by modifying a journal record directly in PostgreSQL...");
  await DbClient.query(
    `UPDATE master_system_journal SET amount_usdc = 999.0 WHERE sequence_id = $1;`,
    [entry2.sequence_id]
  );

  const tamperedIntegrity = await MasterJournalRepo.verifyChainIntegrity();
  assert(
    !tamperedIntegrity.valid && tamperedIntegrity.brokenAtSequence === entry2.sequence_id,
    `Tamper detected! Broken chain successfully caught at sequence ${tamperedIntegrity.brokenAtSequence}`
  );

  // Restore entry to restore ledger integrity
  await DbClient.query(
    `UPDATE master_system_journal SET amount_usdc = 0.125430 WHERE sequence_id = $1;`,
    [entry2.sequence_id]
  );
  const restoredIntegrity = await MasterJournalRepo.verifyChainIntegrity();
  assert(restoredIntegrity.valid, "Ledger integrity restored to 100% valid state after correction");

  // ──────────────────────────────────────────────────────────
  // 4. D4: ACCOUNT REGISTRATION & ACCOUNTSHARES ORCHESTRATION
  // ──────────────────────────────────────────────────────────
  console.log("\n--- 4. D4: Account Registration & AccountShares Orchestration ---");

  const regService = new AccountRegistrationService();
  const syncedAccounts = await regService.syncPolicyAccountsToDatabase();
  assert(syncedAccounts.length === 4, "AccountRegistrationService: synchronizes exactly 4 operating accounts from PRODUCTION_TESTNET profile");

  const engineeringAcc = await TreasuryAccountsRepo.getAccountById("acc_engineering");
  assert(engineeringAcc?.role === "OPEX_DEV", "acc_engineering role is OPEX_DEV");
  assert(engineeringAcc?.min_operating_floor_usdc === 50.0, "acc_engineering min operating floor is $50 USDC");

  const payrollAcc = await TreasuryAccountsRepo.getAccountById("acc_payroll");
  assert(payrollAcc?.role === "PAYROLL", "acc_payroll role is PAYROLL");
  assert(payrollAcc?.min_operating_floor_usdc === 100.0, "acc_payroll min operating floor is $100 USDC");
  assert(payrollAcc?.safety_buffer_ratio === 1.25, "acc_payroll safety buffer ratio is 1.25x");

  // Verify bytes32 formatting for CentralTreasuryYieldVault
  const formattedId = CentralTreasuryYieldVaultService.formatAccountId("acc_engineering");
  assert(formattedId.length === 66 && formattedId.startsWith("0x"), "formatAccountId returns valid 32-byte hex for Solidity bytes32");

  // ──────────────────────────────────────────────────────────
  // 5. D5: VENDOR MASTER, ALLOWLIST, THREE-WAY MATCH & PAYEE SUBSTITUTION
  // ──────────────────────────────────────────────────────────
  console.log("\n--- 5. D5: Vendor Allowlist, Caps, EIP-712 & Three-Way Match ---");

  const vendorService = new VendorMasterService();
  const seededVendors = await vendorService.seedInitialVendors();
  assert(seededVendors.length === 4, "VendorMasterService: seeds 4 verified enterprise vendors");

  const awsVendor = await VendorMasterRepo.getVendorById("vnd_aws_cloud");
  assert(awsVendor !== null && awsVendor.change_lock === true, "AWS vendor registered with active change_lock");

  // Scenario 5.1: Rule 3 Payee Substitution Detection (Attacker replaces wallet on invoice)
  const payeeSubMatch = await vendorService.verifyThreeWayMatch({
    vendorId: "vnd_aws_cloud",
    invoiceId: "INV-2026-001",
    poHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
    invoiceHash: "0x2222222222222222222222222222222222222222222222222222222222222222",
    poAmountUsdc: 450_000000n, // $450 USDC
    invoiceAmountUsdc: 450_000000n,
    payoutAddress: "0xbad0000000000000000000000000000000000bad", // Attacker's imposter address
    deliveryVerified: true,
  });
  assert(!payeeSubMatch.passed, "Payee Substitution Rejected: Payment to imposter address blocked");
  assert(
    payeeSubMatch.rejectionReason?.includes("PAYEE_SUBSTITUTION_DETECTED") ?? false,
    "Rejection reason explicitly flags PAYEE_SUBSTITUTION_DETECTED"
  );

  // Scenario 5.2: Rule 3 Change Lock Protection
  const changeAttempt = await VendorMasterRepo.updatePayoutAddress({
    vendorId: "vnd_aws_cloud",
    newAddress: "0xbad0000000000000000000000000000000000bad",
    adminId: "rogue_actor",
  });
  assert(!changeAttempt.success, "Rule 3 Enforced: Vendor payout address modification rejected when change_lock=true");
  assert(changeAttempt.error?.includes("PAYEE_SUBSTITUTION_LOCKED") ?? false, "Error message confirms PAYEE_SUBSTITUTION_LOCKED");

  // Scenario 5.3: Rule 2 Three-Way Match Amount Discrepancy (Rule 5 No Silent Rounding)
  const amountMismatch = await vendorService.verifyThreeWayMatch({
    vendorId: "vnd_aws_cloud",
    invoiceId: "INV-2026-002",
    poHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
    invoiceHash: "0x2222222222222222222222222222222222222222222222222222222222222222",
    poAmountUsdc: 450_000000n,
    invoiceAmountUsdc: 450_000001n, // 1 micro-USDC difference
    payoutAddress: awsVendor!.verified_payout_address,
    deliveryVerified: true,
  });
  assert(!amountMismatch.passed, "Rule 2 & 5 Enforced: Amount mismatch of even 1 micro-USDC is rejected (no silent rounding)");
  assert(amountMismatch.rejectionReason?.includes("AMOUNT_MISMATCH") ?? false, "Rejection reason explicitly flags AMOUNT_MISMATCH");

  // Scenario 5.4: Rule 2 Goods Receipt / Milestone Delivery Unverified
  const undeliveredMatch = await vendorService.verifyThreeWayMatch({
    vendorId: "vnd_aws_cloud",
    invoiceId: "INV-2026-003",
    poHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
    invoiceHash: "0x2222222222222222222222222222222222222222222222222222222222222222",
    poAmountUsdc: 450_000000n,
    invoiceAmountUsdc: 450_000000n,
    payoutAddress: awsVendor!.verified_payout_address,
    deliveryVerified: false, // Delivery proof missing!
  });
  assert(!undeliveredMatch.passed, "Rule 2 Enforced: Payment without verified goods delivery/milestone completion rejected");
  assert(undeliveredMatch.rejectionReason?.includes("GOODS_DELIVERY_UNVERIFIED") ?? false, "Rejection reason flags GOODS_DELIVERY_UNVERIFIED");

  // Scenario 5.5: Successful Three-Way Match & Idempotency Key Generation
  const validMatch = await vendorService.verifyThreeWayMatch({
    vendorId: "vnd_aws_cloud",
    invoiceId: "INV-2026-004",
    poHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
    invoiceHash: "0x2222222222222222222222222222222222222222222222222222222222222222",
    poAmountUsdc: 450_000000n, // $450 (< $500 single-tx gate in PRODUCTION_TESTNET)
    invoiceAmountUsdc: 450_000000n,
    payoutAddress: awsVendor!.verified_payout_address,
    deliveryVerified: true,
  });
  assert(validMatch.passed, "Valid Three-Way Match: PO, delivery, invoice, and vendor address all verified");
  assert(Boolean(validMatch.idempotencyKey), "Deterministic idempotency key generated");
  assert(!validMatch.requiresHumanGate, "Payment under single-tx gate ($450 < $500) does not require human gate");

  // Scenario 5.6: Payment Over Single-Tx Gate ($600 >= $500) Requires Human Gate
  const highValueMatch = await vendorService.verifyThreeWayMatch({
    vendorId: "vnd_aws_cloud",
    invoiceId: "INV-2026-005",
    poHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
    invoiceHash: "0x2222222222222222222222222222222222222222222222222222222222222222",
    poAmountUsdc: 600_000000n, // $600 (>= $500 gate)
    invoiceAmountUsdc: 600_000000n,
    payoutAddress: awsVendor!.verified_payout_address,
    deliveryVerified: true,
  });
  assert(highValueMatch.passed, "High value match verified");
  assert(highValueMatch.requiresHumanGate, "Payment of $600 >= $500 gate triggers human SPRS requirement");

  // Scenario 5.7: Daily Hard Cap Exceeded ($6,000 > $5,000) Blocked
  const overCapMatch = await vendorService.verifyThreeWayMatch({
    vendorId: "vnd_aws_cloud",
    invoiceId: "INV-2026-006",
    poHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
    invoiceHash: "0x2222222222222222222222222222222222222222222222222222222222222222",
    poAmountUsdc: 6000_000000n, // $6,000
    invoiceAmountUsdc: 6000_000000n,
    payoutAddress: awsVendor!.verified_payout_address,
    deliveryVerified: true,
  });
  assert(!overCapMatch.passed, "Payment exceeding daily hard cap ($6,000 > $5,000) strictly blocked");
  assert(overCapMatch.rejectionReason?.includes("DAILY_HARD_CAP_EXCEEDED") ?? false, "Rejection flags DAILY_HARD_CAP_EXCEEDED");

  // Scenario 5.8: EIP-712 Admin Signature Verification
  const adminPrivateKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as `0x${string}`;
  const adminAccount = privateKeyToAccount(adminPrivateKey);
  const disbursalVaultAddress = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as `0x${string}`;
  const disbursalService = new DisbursalVaultService(disbursalVaultAddress, 5042002);

  const approvalMessage = {
    permissionRequestId: DisbursalVaultService.formatRequestId(reqId),
    vendor: awsVendor!.verified_payout_address,
    amount: 600_000000n,
    idempotencyKey: highValueMatch.idempotencyKey!,
    nonce: 1n,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
  };

  const typedData = disbursalService.getEIP712TypedData(approvalMessage);
  const signature = await adminAccount.signTypedData({
    domain: typedData.domain,
    types: typedData.types,
    primaryType: typedData.primaryType,
    message: typedData.message,
  });

  const recoveredSigner = await recoverTypedDataAddress({
    domain: typedData.domain,
    types: typedData.types,
    primaryType: typedData.primaryType,
    message: typedData.message,
    signature,
  });

  assert(
    recoveredSigner.toLowerCase() === adminAccount.address.toLowerCase(),
    `EIP-712 Signature verified: Recovered address ${recoveredSigner} matches admin approver ${adminAccount.address}`
  );

  console.log("\n============================================================");
  console.log(`=== TEST SUMMARY: ${pass} PASSED, ${fail} FAILED ===`);
  console.log("============================================================\n");

  await DbClient.closePool();

  if (fail > 0) {
    console.error("Failures:", failures);
    process.exit(1);
  }
}

runTests().catch(async (err) => {
  console.error("Test execution threw uncaught error:", err);
  await DbClient.closePool();
  process.exit(1);
});
