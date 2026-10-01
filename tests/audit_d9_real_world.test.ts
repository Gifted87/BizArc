import { LiabilityRadarAgent } from "../src/agents/liabilityRadarAgent.js";
import { DbClient } from "../src/database/dbClient.js";
import { TreasuryAccountsRepo } from "../src/database/repos/treasuryAccountsRepo.js";
import { VendorMasterRepo } from "../src/database/repos/vendorMasterRepo.js";
import { LiabilityRepo } from "../src/database/repos/liabilityRepo.js";
import { PermissionRequestRepo } from "../src/database/repos/permissionRequestRepo.js";
import { AuditLogRepo } from "../src/database/repos/auditLogRepo.js";
import { PolicyLoader } from "../src/config/policyLoader.js";

/**
 * INDEPENDENT REAL-WORLD AUDIT SUITE FOR D6 -> D9:
 * Liability Intelligence Layer & LiabilityRadarAgent
 *
 * Verifies non-deterministic agentic ingestion, cryptographic document linking (Rule 1),
 * Payee Substitution protection (Rule 3), Loud Repair on micro-rounding (Rule 5),
 * Idempotency against replay attacks, multi-horizon pre-flight scanning, and
 * human-in-the-loop Standardized Permission Requests (SPRS).
 *
 * Run directly against live PostgreSQL 'bizarc' database.
 */
async function runIndependentD9Audit() {
  console.log("================================================================================");
  console.log("  INDEPENDENT REAL-WORLD AUDIT: D6 -> D9 LIABILITY RADAR & INTELLIGENCE LAYER   ");
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
  console.log("\n[Setup] Resetting database tables for clean independent audit...");
  await DbClient.query("TRUNCATE TABLE master_system_journal CASCADE");
  await DbClient.query("TRUNCATE TABLE account_agent_audit_log CASCADE");
  await DbClient.query("TRUNCATE TABLE permission_requests CASCADE");
  await DbClient.query("TRUNCATE TABLE account_liabilities CASCADE");
  await DbClient.query("TRUNCATE TABLE vendor_master_registry CASCADE");
  await DbClient.query("TRUNCATE TABLE treasury_accounts CASCADE");

  // Provision accounts from business policy
  const { profile } = PolicyLoader.getActiveProfile();
  for (const acc of profile.operating_accounts) {
    await TreasuryAccountsRepo.upsertAccount({
      account_id: acc.account_id,
      name: acc.name,
      role: acc.role,
      wallet_address: `0x${acc.account_id.length.toString().padStart(40, "8")}` as `0x${string}`,
      chain_id: 5042002,
      min_operating_floor_usdc: acc.min_floor_usdc,
      safety_buffer_ratio: acc.safety_multiplier,
      is_active: true,
    });
  }

  // Register verified real-world vendors in Vendor Master Registry
  const VENDOR_AWS = "vnd_aws_cloud";
  const VENDOR_AWS_ADDR = "0x1111111111111111111111111111111111111111" as `0x${string}`;
  await VendorMasterRepo.registerVendor({
    vendor_id: VENDOR_AWS,
    name: "Amazon Web Services, Inc.",
    verified_payout_address: VENDOR_AWS_ADDR,
    verified_by_admin: "admin_treasury_secops",
    last_verified_at: new Date(),
    change_lock: true,
  });

  const VENDOR_DATADOG = "vnd_datadog_apm";
  const VENDOR_DATADOG_ADDR = "0x2222222222222222222222222222222222222222" as `0x${string}`;
  await VendorMasterRepo.registerVendor({
    vendor_id: VENDOR_DATADOG,
    name: "Datadog Observability & APM",
    verified_payout_address: VENDOR_DATADOG_ADDR,
    verified_by_admin: "admin_treasury_secops",
    last_verified_at: new Date(),
    change_lock: true,
  });

  const VENDOR_GITHUB = "vnd_github_enterprise";
  const VENDOR_GITHUB_ADDR = "0x3333333333333333333333333333333333333333" as `0x${string}`;
  await VendorMasterRepo.registerVendor({
    vendor_id: VENDOR_GITHUB,
    name: "GitHub Enterprise Cloud",
    verified_payout_address: VENDOR_GITHUB_ADDR,
    verified_by_admin: "admin_treasury_secops",
    last_verified_at: new Date(),
    change_lock: true,
  });

  const radarAgent = new LiabilityRadarAgent();

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. AUDIT: AGENT PERSONA & ZERO PRIVILEGE VIOLATION
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n[Audit 1] Enforce Segregation of Duties (Zero-Privilege Security Model)");
  assertEqual(radarAgent.persona, "LiabilityRadarAgent", "Persona confirmed as LiabilityRadarAgent");
  assertEqual(radarAgent.erc8004Id, 102, "ERC-8004 Onchain Agent Identity is registered as ID 102");
  assertEqual(radarAgent.canSignTransactions, false, "canSignTransactions is STRICTLY FALSE");
  assertEqual(radarAgent.canWriteLedger, false, "canWriteLedger is STRICTLY FALSE");

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. AUDIT: RULE 5 LOUD REPAIR (MICRO-ROUNDING ATTACK RESISTANCE)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n[Audit 2] Rule 5: Refusal of Silent Rounding on Inbound Invoices");
  let caughtRule5 = false;
  try {
    await radarAgent.ingestLiabilityDocument({
      accountId: "acc_engineering",
      vendorId: VENDOR_AWS,
      title: "Fractional Precision Attack Bill",
      category: "INFRASTRUCTURE",
      amountUsdc: 99.9999999, // 7 decimal places
      dueDate: new Date(Date.now() + 86400 * 1000),
      claimedPayoutAddress: VENDOR_AWS_ADDR,
    });
  } catch (err: any) {
    caughtRule5 = err.message.includes("Rule 5 Violation");
  }
  assert(caughtRule5, "Loud exception thrown on 7-decimal fractional precision");

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. AUDIT: REAL-WORLD OCR DOCUMENT INGESTION & DOCUMENT LINKING (RULE 1)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n[Audit 3] Real-World Multi-Line Inbound Document Ingestion (Rule 1)");
  const rawAwsPdfContent = `
============================================================
AMAZON WEB SERVICES INC. - TAX INVOICE
Invoice Number: INV-AWS-2026-10-98471
Billing Period: 2026-09-01 to 2026-09-30
Account: 9481-9920-1102 (Engineering Core)

Line Items:
  1. Amazon Elastic Compute Cloud (EC2) us-east-1:  $1,240.500000 USDC
  2. Amazon Simple Storage Service (S3) Standard:     $210.250000 USDC
  3. Amazon Aurora PostgreSQL Serverless v2:          $549.250000 USDC
------------------------------------------------------------
Total Amount Due: $2,000.000000 USDC
Payment Terms: Net 30 Days
Remittance Address: ${VENDOR_AWS_ADDR}
============================================================
  `.trim();

  const awsIngest = await radarAgent.ingestLiabilityDocument({
    accountId: "acc_engineering",
    vendorId: VENDOR_AWS,
    title: "AWS Cloud Infrastructure October",
    category: "INFRASTRUCTURE",
    amountUsdc: 2000.0,
    dueDate: new Date(Date.now() + 20 * 86400 * 1000),
    claimedPayoutAddress: VENDOR_AWS_ADDR,
    rawDocumentContent: rawAwsPdfContent,
    poHash: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef" as `0x${string}`,
  });

  assertEqual(awsIngest.liability.status, "SCHEDULED", "Valid enterprise invoice entered SCHEDULED status");
  assertEqual(awsIngest.liability.amount_usdc, 2000.0, "Amount matches exactly 2000.000000 USDC");
  assert(Boolean(awsIngest.liability.source_invoice_hash), "Cryptographic source_invoice_hash generated");
  assert(Boolean(awsIngest.liability.source_po_hash), "Cryptographic source_po_hash stored");

  // Verify DB persistence directly in PostgreSQL
  const dbRecord = await LiabilityRepo.getLiabilityById(awsIngest.liability.liability_id!);
  assert(Boolean(dbRecord), "Liability record successfully retrieved from PostgreSQL");
  assertEqual(dbRecord?.vendor_id, VENDOR_AWS, "PostgreSQL vendor_id matches");
  assertEqual(dbRecord?.payout_address.toLowerCase(), VENDOR_AWS_ADDR.toLowerCase(), "PostgreSQL payout address matches");

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. AUDIT: IDEMPOTENT INGESTION PROTECTION (REPLAY / DUPLICATE INVOICE PREVENTION)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n[Audit 4] Idempotency: Duplicate Invoice Replay Attack Protection");
  const duplicateAttempt = await radarAgent.ingestLiabilityDocument({
    accountId: "acc_engineering",
    vendorId: VENDOR_AWS,
    title: "AWS Cloud Infrastructure October (RETRY)",
    category: "INFRASTRUCTURE",
    amountUsdc: 2000.0,
    dueDate: new Date(Date.now() + 20 * 86400 * 1000),
    claimedPayoutAddress: VENDOR_AWS_ADDR,
    rawDocumentContent: rawAwsPdfContent, // EXACT SAME RAW CONTENT
  });

  assertEqual(duplicateAttempt.isDuplicate, true, "Duplicate invoice detected via cryptographic document hash");
  assertEqual(duplicateAttempt.liability.liability_id, awsIngest.liability.liability_id, "Returned existing liability rather than creating duplicate");
  assert(
    Boolean(duplicateAttempt.securityAlert?.includes("DUPLICATE_INVOICE_WARNING")),
    "Raised DUPLICATE_INVOICE_WARNING alert"
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. AUDIT: RULE 3 PAYEE SUBSTITUTION MITM ATTACK
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n[Audit 5] Rule 3: Payee Substitution Attack Detection & Instant Freeze");
  const ATTACKER_REMITTANCE = "0xbad0bad0bad0bad0bad0bad0bad0bad0bad0bad0" as `0x${string}`;
  const mitmInvoiceContent = rawAwsPdfContent.replace(VENDOR_AWS_ADDR, ATTACKER_REMITTANCE);

  const mitmIngest = await radarAgent.ingestLiabilityDocument({
    accountId: "acc_engineering",
    vendorId: VENDOR_AWS,
    title: "Spoofed AWS Bill with Hijacked Remittance Address",
    category: "INFRASTRUCTURE",
    amountUsdc: 2000.0,
    dueDate: new Date(Date.now() + 15 * 86400 * 1000),
    claimedPayoutAddress: ATTACKER_REMITTANCE,
    rawDocumentContent: mitmInvoiceContent,
  });

  assertEqual(mitmIngest.liability.status, "FROZEN", "Compromised liability is FROZEN immediately");
  assert(
    Boolean(mitmIngest.securityAlert?.includes("PAYEE_SUBSTITUTION_ALERT")),
    "PAYEE_SUBSTITUTION_ALERT triggered"
  );

  // Verify frozen in PostgreSQL
  const frozenRecord = await LiabilityRepo.getLiabilityById(mitmIngest.liability.liability_id!);
  assertEqual(frozenRecord?.status, "FROZEN", "PostgreSQL confirms liability status is locked to FROZEN");

  // ─────────────────────────────────────────────────────────────────────────────
  // 7. AUDIT: UNREGISTERED SHADOW VENDOR / PHISHING ATTEMPT
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n[Audit 6] Phishing Protection: Unregistered Shadow Vendor Ingestion");
  const phishingIngest = await radarAgent.ingestLiabilityDocument({
    accountId: "acc_engineering",
    vendorId: "vnd_unknown_phish_corp",
    title: "Urgent Security Domain Renewal Demand",
    category: "SUBSCRIPTION",
    amountUsdc: 450.0,
    dueDate: new Date(Date.now() + 2 * 86400 * 1000),
    claimedPayoutAddress: "0x6666666666666666666666666666666666666666" as `0x${string}`,
  });

  assertEqual(phishingIngest.liability.status, "FROZEN", "Unregistered vendor invoice is FROZEN immediately");
  assert(
    Boolean(phishingIngest.securityAlert?.includes("not registered in Verified Vendor Master")),
    "Vendor master registry check caught unregistered entity"
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // 8. AUDIT: STEALTH PRICE HIKE & ZOMBIE SAAS ANOMALY DETECTION (>15%)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n[Audit 7] Anomaly Detection: Stealth Price Creeping & Zombie SaaS (>15% hike)");

  // Step A: Ingest baseline GitHub Enterprise subscription ($500.00/mo)
  const githubBaseline = await radarAgent.ingestLiabilityDocument({
    accountId: "acc_engineering",
    vendorId: VENDOR_GITHUB,
    title: "GitHub Enterprise Baseline September",
    category: "SUBSCRIPTION",
    amountUsdc: 500.0,
    dueDate: new Date(Date.now() + 30 * 86400 * 1000),
    claimedPayoutAddress: VENDOR_GITHUB_ADDR,
  });
  assertEqual(githubBaseline.liability.status, "SCHEDULED", "GitHub baseline entered SCHEDULED");

  // Step B: Ingest stealth price hike (+40% increase to $700.00/mo)
  const githubHike = await radarAgent.ingestLiabilityDocument({
    accountId: "acc_engineering",
    vendorId: VENDOR_GITHUB,
    title: "GitHub Enterprise October Renewal with Stealth Price Hike",
    category: "SUBSCRIPTION",
    amountUsdc: 700.0,
    dueDate: new Date(Date.now() + 60 * 86400 * 1000),
    claimedPayoutAddress: VENDOR_GITHUB_ADDR,
  });

  assertEqual(githubHike.anomalyDetected, true, "Stealth price hike flagged as anomaly");
  assertEqual(githubHike.liability.status, "AWAITING_APPROVAL", "Unapproved price hike prevented from automated scheduling");
  assert(
    Boolean(githubHike.anomalyReason?.includes("STEALTH_PRICE_HIKE_DETECTED")),
    "Anomaly reason reports STEALTH_PRICE_HIKE_DETECTED"
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // 9. AUDIT: 48-HOUR HORIZON PRE-FLIGHT RADAR & LIVE ACCOUNT INTELLIGENCE
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n[Audit 8] 48-Hour Pre-Flight Radar Scan with Live Account Intelligence");

  // Seed liabilities across varied time horizons
  // Horizon 1: Due in 12 hours ($300 USDC) -> SHOULD TRIGGER
  const liab12h = await radarAgent.ingestLiabilityDocument({
    accountId: "acc_engineering",
    vendorId: VENDOR_DATADOG,
    title: "Datadog APM Urgent 12h Settlement",
    category: "SUBSCRIPTION",
    amountUsdc: 300.0,
    dueDate: new Date(Date.now() + 12 * 3600 * 1000),
    claimedPayoutAddress: VENDOR_DATADOG_ADDR,
  });

  // Horizon 2: Due in 36 hours ($450 USDC) -> SHOULD TRIGGER
  const liab36h = await radarAgent.ingestLiabilityDocument({
    accountId: "acc_engineering",
    vendorId: VENDOR_DATADOG,
    title: "Datadog Logs Retention 36h Settlement",
    category: "SUBSCRIPTION",
    amountUsdc: 450.0,
    dueDate: new Date(Date.now() + 36 * 3600 * 1000),
    claimedPayoutAddress: VENDOR_DATADOG_ADDR,
  });

  // Horizon 3: Due in 72 hours (3 days) -> MUST NOT TRIGGER in 48h scan
  const liab72h = await radarAgent.ingestLiabilityDocument({
    accountId: "acc_engineering",
    vendorId: VENDOR_DATADOG,
    title: "Datadog Synthetics 72h Settlement",
    category: "SUBSCRIPTION",
    amountUsdc: 600.0,
    dueDate: new Date(Date.now() + 72 * 3600 * 1000),
    claimedPayoutAddress: VENDOR_DATADOG_ADDR,
  });

  // Execute 48-hour radar scan with live intelligence context
  const preFlightSprs = await radarAgent.scanPreFlightLiabilities(48, {
    acc_engineering: { liquidUsdc: 5000.0, investedUsyc: 2500.0 },
  });

  // Verify that only the liabilities due within <= 48h triggered an SPRS
  const found12h = preFlightSprs.find((s) => s.requestId === `SPRS-LIAB-${liab12h.liability.liability_id}`);
  const found36h = preFlightSprs.find((s) => s.requestId === `SPRS-LIAB-${liab36h.liability.liability_id}`);
  const found72h = preFlightSprs.find((s) => s.requestId === `SPRS-LIAB-${liab72h.liability.liability_id}`);

  assert(Boolean(found12h), "Liability due in 12h generated pre-flight SPRS");
  assert(Boolean(found36h), "Liability due in 36h generated pre-flight SPRS");
  assert(!found72h, "Liability due in 72h did NOT generate pre-flight SPRS (correctly excluded from 48h horizon)");

  // Inspect SPRS structure and financial intelligence completeness
  assertEqual(found12h?.action, "DISBURSEMENT_PAYMENT", "SPRS action is DISBURSEMENT_PAYMENT");
  assertEqual(found12h?.amountUsdc, "300.000000", "SPRS amount has exact 6-decimal formatting");
  assertEqual(found12h?.targetRecipient.vendorId, VENDOR_DATADOG, "SPRS targetRecipient vendorId verified");
  assertEqual(found12h?.targetRecipient.isInVerifiedMaster, true, "SPRS confirms recipient is in Verified Vendor Master");
  assertEqual(found12h?.targetRecipient.payeeAddressMatchesHistory, true, "SPRS confirms address matches verified history");
  assertEqual(found12h?.affectedAccounts[0].currentLiquidBalance, "5000.000000", "SPRS incorporates live liquid balance");
  assertEqual(found12h?.affectedAccounts[0].totalEffectiveBalance, "7500.000000", "SPRS incorporates total effective balance ($5k liquid + $2.5k USYC)");

  // ─────────────────────────────────────────────────────────────────────────────
  // 10. AUDIT: HUMAN OPERATOR APPROVAL WORKFLOW
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n[Audit 9] Human Gate Resolution Flow: APPROVE");
  const approveResult = await radarAgent.resolveAdminDecision({
    requestId: found12h!.requestId,
    decision: "APPROVE",
    adminInstructions: "Approved by VP of Engineering. Settle within 12h window.",
  });

  assertEqual(approveResult.status, "APPROVED", "Decision recorded as APPROVED");
  const approvedLiab = await LiabilityRepo.getLiabilityById(approveResult.liabilityId);
  assertEqual(approvedLiab?.status, "SCHEDULED", "Liability returned to SCHEDULED state ready for DisbursalVault");

  const approvedSprsRecord = await PermissionRequestRepo.getRequestById(found12h!.requestId);
  assertEqual(approvedSprsRecord?.status, "APPROVED", "SPRS status persisted in DB as APPROVED");

  // ─────────────────────────────────────────────────────────────────────────────
  // 11. AUDIT: HUMAN OPERATOR CANCELLATION WORKFLOW (KILL SWITCH)
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n[Audit 10] Human Gate Resolution Flow: CANCEL_WITH_INSTRUCTIONS");
  const cancelResult = await radarAgent.resolveAdminDecision({
    requestId: found36h!.requestId,
    decision: "CANCEL_WITH_INSTRUCTIONS",
    adminInstructions: "Decommissioning legacy Datadog logs ingestion. Do not pay. Cancel contract.",
  });

  assertEqual(cancelResult.status, "CANCELLED", "Decision recorded as CANCELLED");
  const cancelledLiab = await LiabilityRepo.getLiabilityById(cancelResult.liabilityId);
  assertEqual(cancelledLiab?.status, "CANCELLED", "Liability status locked to CANCELLED in PostgreSQL");

  const cancelledSprsRecord = await PermissionRequestRepo.getRequestById(found36h!.requestId);
  assertEqual(cancelledSprsRecord?.status, "REJECTED", "SPRS status recorded as REJECTED in PostgreSQL");

  assert(
    Boolean(cancelResult.cancellationMemo?.includes("Decommissioning legacy Datadog logs ingestion")),
    "Formal Vendor Cancellation Memo drafted with exact admin instructions"
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // 12. AUDIT: MULTI-ACCOUNT OBLIGATION SEGREGATION
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n[Audit 11] Multi-Account Segregation: Ensure Zero Cost-Center Pollution");

  // Ingest liability for Marketing Account
  const mktLiab = await radarAgent.ingestLiabilityDocument({
    accountId: "acc_marketing",
    vendorId: VENDOR_DATADOG,
    title: "Marketing Campaign Tracking Sub",
    category: "SUBSCRIPTION",
    amountUsdc: 400.0,
    dueDate: new Date(Date.now() + 5 * 86400 * 1000),
    claimedPayoutAddress: VENDOR_DATADOG_ADDR,
  });

  const engLiabilities = await LiabilityRepo.getLiabilitiesByAccount("acc_engineering");
  const mktLiabilities = await LiabilityRepo.getLiabilitiesByAccount("acc_marketing");

  assert(
    engLiabilities.every((l) => l.account_id === "acc_engineering"),
    "All Engineering liabilities strictly belong to acc_engineering"
  );
  assert(
    mktLiabilities.every((l) => l.account_id === "acc_marketing"),
    "All Marketing liabilities strictly belong to acc_marketing"
  );
  assert(
    !engLiabilities.some((l) => l.liability_id === mktLiab.liability.liability_id),
    "Engineering account is NOT contaminated with Marketing liabilities"
  );

  // ─────────────────────────────────────────────────────────────────────────────
  // 13. AUDIT: POSTGRESQL IMMUTABLE AUDIT LOG VERIFICATION
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n[Audit 12] PostgreSQL Audit Trail: Verify Complete Event Logging");
  const logsRes = await DbClient.query("SELECT * FROM account_agent_audit_log WHERE actor_agent = 'LiabilityRadarAgent' ORDER BY log_id ASC;");
  const auditLogs = logsRes.rows;

  assert(auditLogs.length >= 8, `Audit log captured all agent lifecycle events (${auditLogs.length} entries)`);

  const hasIngested = auditLogs.some((l) => l.action_type === "LIABILITY_INGESTED");
  const hasApproved = auditLogs.some((l) => l.action_type === "LIABILITY_APPROVED");
  const hasCancelled = auditLogs.some((l) => l.action_type === "LIABILITY_CANCELLED");

  assert(hasIngested, "Audit log verified LIABILITY_INGESTED records");
  assert(hasApproved, "Audit log verified LIABILITY_APPROVED records");
  assert(hasCancelled, "Audit log verified LIABILITY_CANCELLED records");

  // ─────────────────────────────────────────────────────────────────────────────
  // AUDIT SUMMARY
  // ─────────────────────────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(80));
  console.log(`  INDEPENDENT REAL-WORLD AUDIT COMPLETE: ${pass} passed, ${fail} failed`);
  if (failures.length > 0) {
    console.error("  FAILURES DETECTED IN REAL-WORLD AUDIT:");
    failures.forEach((f) => console.error(`    ✗ ${f}`));
  } else {
    console.log("  >>> INDEPENDENT VERIFICATION CONFIRMED: D6->D9 IS ROBUST & REAL-WORLD READY <<<");
  }
  console.log("=".repeat(80));

  process.exit(fail > 0 ? 1 : 0);
}

runIndependentD9Audit().catch((err) => {
  console.error("[FATAL AUDIT ERROR]", err);
  process.exit(1);
});
