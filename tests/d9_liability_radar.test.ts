import { LiabilityRadarService as LiabilityRadarAgent } from "../src/services/liabilityRadarService.js";
import { DbClient } from "../src/database/dbClient.js";
import { TreasuryAccountsRepo } from "../src/database/repos/treasuryAccountsRepo.js";
import { VendorMasterRepo } from "../src/database/repos/vendorMasterRepo.js";
import { LiabilityRepo } from "../src/database/repos/liabilityRepo.js";
import { PermissionRequestRepo } from "../src/database/repos/permissionRequestRepo.js";
import { AuditLogRepo } from "../src/database/repos/auditLogRepo.js";
import { PolicyLoader } from "../src/config/policyLoader.js";

async function runD9Tests() {
  console.log("==================================================");
  console.log("  D6 -> D9: LiabilityRadarAgent Real-World Audit  ");
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
  console.log("\n[Setup] Cleaning DB tables for fresh liability radar audit...");
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
      wallet_address: `0x${acc.account_id.length.toString().padStart(40, "4")}` as `0x${string}`,
      chain_id: 5042002,
      min_operating_floor_usdc: acc.min_floor_usdc,
      safety_buffer_ratio: acc.safety_multiplier,
      is_active: true,
    });
  }

  // Seed verified enterprise vendors into Vendor Master
  const VENDOR_AWS = "vnd_aws_cloud";
  const VENDOR_AWS_ADDR = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `0x${string}`;
  await VendorMasterRepo.registerVendor({
    vendor_id: VENDOR_AWS,
    name: "Amazon Web Services Inc.",
    verified_payout_address: VENDOR_AWS_ADDR,
    verified_by_admin: "admin_secops",
    last_verified_at: new Date(),
    change_lock: true,
  });

  const VENDOR_DATADOG = "vnd_datadog_apm";
  const VENDOR_DATADOG_ADDR = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as `0x${string}`;
  await VendorMasterRepo.registerVendor({
    vendor_id: VENDOR_DATADOG,
    name: "Datadog Security & Observability",
    verified_payout_address: VENDOR_DATADOG_ADDR,
    verified_by_admin: "admin_secops",
    last_verified_at: new Date(),
    change_lock: true,
  });

  const radarAgent = new LiabilityRadarAgent();

  // ──────────────────────────────────────────────────────────
  // 2. AGENT PERSONA & SEGREGATION OF DUTIES
  // ──────────────────────────────────────────────────────────
  console.log("\n[Test 1] LiabilityRadarAgent Persona & Segregation of Duties");
  assertEqual(radarAgent.persona, "LiabilityRadarAgent", "Persona is LiabilityRadarAgent");
  assertEqual(radarAgent.canSignTransactions, false, "canSignTransactions is FALSE");
  assertEqual(radarAgent.canWriteLedger, false, "canWriteLedger is FALSE");
  assertEqual(radarAgent.erc8004Id, 102, "ERC-8004 ID is 102");

  // ──────────────────────────────────────────────────────────
  // 3. RULE 5: REFUSE SILENT ROUNDING
  // ──────────────────────────────────────────────────────────
  console.log("\n[Test 2] Rule 5: Refuse Silent Rounding on Inbound Invoices");
  let precisionErrorCaught = false;
  try {
    await radarAgent.ingestLiabilityDocument({
      accountId: "acc_engineering",
      vendorId: VENDOR_AWS,
      title: "AWS Micro-charge Slip",
      category: "INFRASTRUCTURE",
      amountUsdc: 100.1234567, // 7 decimals!
      dueDate: new Date(),
      claimedPayoutAddress: VENDOR_AWS_ADDR,
    });
  } catch (err: any) {
    precisionErrorCaught = err.message.includes("Rule 5 Violation");
  }
  assert(precisionErrorCaught, "7-decimal fractional precision rejected loudly");

  // ──────────────────────────────────────────────────────────
  // 4. AGENTIC INGESTION: VERIFIED VENDOR & DOCUMENT LINKING
  // ──────────────────────────────────────────────────────────
  console.log("\n[Test 3] Agentic Ingestion of Valid Enterprise Invoice");
  const rawInvoiceText = "INVOICE #AWS-2026-OCT | Total: $450.00 USDC | Terms: Net-30";
  const validIngestion = await radarAgent.ingestLiabilityDocument({
    accountId: "acc_engineering",
    vendorId: VENDOR_AWS,
    title: "AWS Compute Cluster",
    category: "INFRASTRUCTURE",
    amountUsdc: 450.0,
    dueDate: new Date(Date.now() + 10 * 86400 * 1000), // Due in 10 days
    claimedPayoutAddress: VENDOR_AWS_ADDR,
    rawDocumentContent: rawInvoiceText,
  });

  assertEqual(validIngestion.liability.status, "SCHEDULED", "Valid invoice assigned status SCHEDULED");
  assertEqual(validIngestion.securityAlert, undefined, "No security alerts flagged on verified vendor");
  assert(Boolean(validIngestion.liability.source_invoice_hash), "Cryptographic source_invoice_hash generated");

  // ──────────────────────────────────────────────────────────
  // 5. RULE 3: PAYEE SUBSTITUTION PROTECTION
  // ──────────────────────────────────────────────────────────
  console.log("\n[Test 4] Rule 3: Payee Substitution Protection on Imposter Address");
  const IMPOSTER_ADDR = "0x9999999999999999999999999999999999999999" as `0x${string}`;
  const imposterIngestion = await radarAgent.ingestLiabilityDocument({
    accountId: "acc_engineering",
    vendorId: VENDOR_AWS,
    title: "Compromised AWS Bill",
    category: "INFRASTRUCTURE",
    amountUsdc: 450.0,
    dueDate: new Date(Date.now() + 5 * 86400 * 1000),
    claimedPayoutAddress: IMPOSTER_ADDR, // Attacker's address!
  });

  assertEqual(imposterIngestion.liability.status, "FROZEN", "Payee substitution frozen immediately");
  assert(
    Boolean(imposterIngestion.securityAlert?.includes("PAYEE_SUBSTITUTION_ALERT")),
    "PAYEE_SUBSTITUTION_ALERT raised with warning"
  );

  // ──────────────────────────────────────────────────────────
  // 6. ANOMALY DETECTION: STEALTH PRICE HIKES & ZOMBIE SAAS
  // ──────────────────────────────────────────────────────────
  console.log("\n[Test 5] Anomaly Detection: Stealth Price Hike Audit (> 15% increase)");

  // Baseline Datadog invoice at $200
  await radarAgent.ingestLiabilityDocument({
    accountId: "acc_engineering",
    vendorId: VENDOR_DATADOG,
    title: "Datadog Baseline Renewal",
    category: "SUBSCRIPTION",
    amountUsdc: 200.0,
    dueDate: new Date(Date.now() + 30 * 86400 * 1000),
    claimedPayoutAddress: VENDOR_DATADOG_ADDR,
  });

  // Next Datadog invoice at $350 (75% stealth price hike!)
  const hikeIngestion = await radarAgent.ingestLiabilityDocument({
    accountId: "acc_engineering",
    vendorId: VENDOR_DATADOG,
    title: "Datadog Renewal With Price Hike",
    category: "SUBSCRIPTION",
    amountUsdc: 350.0,
    dueDate: new Date(Date.now() + 60 * 86400 * 1000),
    claimedPayoutAddress: VENDOR_DATADOG_ADDR,
  });

  assert(hikeIngestion.anomalyDetected === true, "Stealth price hike detected by agent");
  assertEqual(hikeIngestion.liability.status, "AWAITING_APPROVAL", "Unapproved price hike held in AWAITING_APPROVAL");
  assert(
    Boolean(hikeIngestion.anomalyReason?.includes("STEALTH_PRICE_HIKE_DETECTED")),
    "Anomaly reason explicitly states STEALTH_PRICE_HIKE_DETECTED"
  );

  // ──────────────────────────────────────────────────────────
  // 7. 48-HOUR PRE-FLIGHT RADAR & SPRS EMISSION
  // ──────────────────────────────────────────────────────────
  console.log("\n[Test 6] 48-Hour Pre-Flight Radar Scan & SPRS Generation");

  // Create liability due in 36 hours (within 48h pre-flight window)
  const due36h = new Date(Date.now() + 36 * 3600 * 1000);
  const nearLiability = await radarAgent.ingestLiabilityDocument({
    accountId: "acc_engineering",
    vendorId: VENDOR_DATADOG,
    title: "Urgent Datadog Maintenance Renewal",
    category: "SUBSCRIPTION",
    amountUsdc: 200.0,
    dueDate: due36h,
    claimedPayoutAddress: VENDOR_DATADOG_ADDR,
  });

  const sprsList = await radarAgent.scanPreFlightLiabilities(48, {
    acc_engineering: { liquidUsdc: 1200.0, investedUsyc: 400.0 },
  });

  assert(sprsList.length >= 1, "48h radar detected upcoming liability and generated SPRS");
  const matchingSprs = sprsList.find((s) => s.requestId === `SPRS-LIAB-${nearLiability.liability.liability_id}`);
  assert(Boolean(matchingSprs), "SPRS matches target upcoming liability ID");
  assertEqual(matchingSprs?.status, "PENDING", "SPRS status is PENDING");
  assertEqual(matchingSprs?.options.length, 2, "SPRS offers binary choices: APPROVE and CANCEL_WITH_INSTRUCTIONS");
  assertEqual(matchingSprs?.options[0].action, "APPROVE", "Option 1 is APPROVE");
  assertEqual(matchingSprs?.options[1].action, "CANCEL_WITH_INSTRUCTIONS", "Option 2 is CANCEL_WITH_INSTRUCTIONS");

  // ──────────────────────────────────────────────────────────
  // 8. INTERACTIVE HUMAN GATE RESOLUTION (APPROVE)
  // ──────────────────────────────────────────────────────────
  console.log("\n[Test 7] Human Gate Decision: APPROVE");
  const approveRes = await radarAgent.resolveAdminDecision({
    requestId: matchingSprs!.requestId,
    decision: "APPROVE",
    adminInstructions: "Confirmed legitimate APM monitoring. Proceed with settlement.",
  });

  assertEqual(approveRes.status, "APPROVED", "Decision recorded as APPROVED");
  const updatedLiabApprove = await LiabilityRepo.getLiabilityById(approveRes.liabilityId);
  assertEqual(updatedLiabApprove?.status, "SCHEDULED", "Liability status transitioned to SCHEDULED");

  // ──────────────────────────────────────────────────────────
  // 9. INTERACTIVE HUMAN GATE RESOLUTION (CANCEL_WITH_INSTRUCTIONS)
  // ──────────────────────────────────────────────────────────
  console.log("\n[Test 8] Human Gate Decision: CANCEL_WITH_INSTRUCTIONS");

  // Create another liability due in 24 hours
  const due24h = new Date(Date.now() + 24 * 3600 * 1000);
  const cancelCandidate = await radarAgent.ingestLiabilityDocument({
    accountId: "acc_engineering",
    vendorId: VENDOR_DATADOG,
    title: "Obsolete Datadog Synthetics Add-on",
    category: "SUBSCRIPTION",
    amountUsdc: 180.0,
    dueDate: due24h,
    claimedPayoutAddress: VENDOR_DATADOG_ADDR,
  });

  const cancelSprsList = await radarAgent.scanPreFlightLiabilities(48, {
    acc_engineering: { liquidUsdc: 1200.0, investedUsyc: 400.0 },
  });
  const cancelSprs = cancelSprsList.find((s) => s.requestId === `SPRS-LIAB-${cancelCandidate.liability.liability_id}`);
  assert(Boolean(cancelSprs), "SPRS generated for obsolete subscription");

  const cancelRes = await radarAgent.resolveAdminDecision({
    requestId: cancelSprs!.requestId,
    decision: "CANCEL_WITH_INSTRUCTIONS",
    adminInstructions: "Migrated to internal Prometheus; cancel Datadog subscription immediately.",
  });

  assertEqual(cancelRes.status, "CANCELLED", "Decision recorded as CANCELLED");
  const updatedLiabCancel = await LiabilityRepo.getLiabilityById(cancelRes.liabilityId);
  assertEqual(updatedLiabCancel?.status, "CANCELLED", "Liability status frozen as CANCELLED");
  assert(
    Boolean(cancelRes.cancellationMemo?.includes("Migrated to internal Prometheus")),
    "Vendor cancellation action memo drafted with admin instructions"
  );

  // ──────────────────────────────────────────────────────────
  // SUMMARY
  // ──────────────────────────────────────────────────────────
  console.log("\n" + "=".repeat(50));
  console.log(`  RESULTS: ${pass} passed, ${fail} failed`);
  if (failures.length > 0) {
    console.error("  FAILURES:");
    failures.forEach((f) => console.error(`    ✗ ${f}`));
  } else {
    console.log("  >>> ALL D6->D9 LIABILITY RADAR TESTS PASSED <<<");
  }
  console.log("=".repeat(50));

  process.exit(fail > 0 ? 1 : 0);
}

runD9Tests().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});
