/**
 * D23: Production Readiness Path Test Suite
 * ==========================================
 * Comprehensive verification of the 8 Core Pillars of Enterprise Production Readiness
 * on Arc Layer-1 blockchain as specified in project_dag.md and AUTONOMOUS_TREASURY_PLAN.md:
 *
 * 1. Pillar 1: Replace mock USYC with allowlisted production Hashnote institutional contract
 * 2. Pillar 2: Enterprise policy profile activation ($500 OPEX / $10k Payroll floors, 30-day evaluation windows)
 * 3. Pillar 3: Parameterized production redemption latency (Tier A 900s, Tier B 28.8ks, Tier C 86.4ks)
 * 4. Pillar 4: Enterprise spending limits ($25k daily hard cap, $5k single-tx human gate threshold)
 * 5. Pillar 5: Production wallet configuration (EVM checksum validation, 20 Gwei gas floor, 18-decimal scaling)
 * 6. Pillar 6: Production vendor registry (Immutable change_lock, admin verification, anti-substitution)
 * 7. Pillar 7: Monitoring & Solvency (Tripartite BE = BL + BY invariant, SHA-256 hash chain verification)
 * 8. Pillar 8: Operational controls & Circuit Breakers (Instant disbursal halt, admin clearance disarm)
 *
 * ZERO STUBS. ZERO MOCKS. Real PostgreSQL, real cryptographic hash chaining, and real ToolRegistry dispatch.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "crypto";
import { getAddress, isAddress } from "viem";
import { DbClient } from "../src/database/dbClient.js";
import { PolicyLoader } from "../src/config/policyLoader.js";
import { ARC_CONSTANTS } from "../src/foundation/arc/constants.js";
import { TreasuryAccountsRepo } from "../src/database/repos/treasuryAccountsRepo.js";
import { VendorMasterRepo } from "../src/database/repos/vendorMasterRepo.js";
import { MasterJournalRepo } from "../src/database/repos/masterJournalRepo.js";
import { AuditLogRepo } from "../src/database/repos/auditLogRepo.js";
import { ProductionReadinessService } from "../src/services/productionReadinessService.js";
import { ToolRegistry } from "../src/tools/toolRegistry.js";
import { DynamicRecordsService } from "../src/records/dynamicRecordsService.js";

describe("D23: Enterprise Production Readiness Path (Arc L1)", () => {
  const ts = Date.now();
  const testCompanyId = `comp_prod_${ts}`;
  const prodOpexId = `acc_prod_opex_${ts}`;
  const prodPayrollId = `acc_prod_payroll_${ts}`;
  const prodVendorId = `vend_prod_${ts}`;
  const prodOpexWallet = getAddress(`0x${crypto.randomBytes(20).toString("hex")}`);
  const prodPayrollWallet = getAddress(`0x${crypto.randomBytes(20).toString("hex")}`);
  const prodPayoutAddress = getAddress(`0x${crypto.randomBytes(20).toString("hex")}`);
  const institutionalUsycVault = "0x4444444444444444444444444444444444444444" as `0x${string}`;

  let service: ProductionReadinessService;
  let toolRegistry: ToolRegistry;

  before(async () => {
    service = new ProductionReadinessService();
    toolRegistry = new ToolRegistry();

    // 1. Seed Production Operating & Payroll Accounts
    await TreasuryAccountsRepo.upsertAccount({
      account_id: prodOpexId,
      company_id: testCompanyId,
      name: "Corporate Primary OPEX (Prod)",
      role: "OPERATING_EXPENSES",
      wallet_address: prodOpexWallet,
      chain_id: 5042,
      min_operating_floor_usdc: 500.0,
      safety_buffer_ratio: 0.2,
      is_active: true,
    });

    await TreasuryAccountsRepo.upsertAccount({
      account_id: prodPayrollId,
      company_id: testCompanyId,
      name: "Corporate Payroll Reserve (Prod)",
      role: "PAYROLL",
      wallet_address: prodPayrollWallet,
      chain_id: 5042,
      min_operating_floor_usdc: 10000.0,
      safety_buffer_ratio: 0.1,
      is_active: true,
      exclude_from_waterfall: true,
    });

    // 2. Seed Vendor Master Registry with immutable change_lock
    await VendorMasterRepo.registerVendor({
      vendor_id: prodVendorId,
      name: "AWS Cloud Infrastructure Corp",
      verified_payout_address: prodPayoutAddress,
      verified_by_admin: "admin@enterprise.io",
      last_verified_at: new Date(),
      change_lock: true,
    });
  });

  after(async () => {
    // Cleanup seeded records
    try {
      await DbClient.query("DELETE FROM treasury_accounts WHERE account_id IN ($1, $2);", [
        prodOpexId,
        prodPayrollId,
      ]);
      await DbClient.query("DELETE FROM vendor_master_registry WHERE vendor_id = $1;", [
        prodVendorId,
      ]);
    } catch {
      // Ignored in test cleanup
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Pillar 1: Replace mock USYC with allowlisted production integration
  // ─────────────────────────────────────────────────────────────────────────────
  it("Pillar 1: Should replace mock USYC vault with allowlisted production contract", async () => {
    const migration = await service.replaceYieldVaultIntegration(institutionalUsycVault, true);

    assert.equal(migration.success, true);
    assert.equal(migration.newVault, getAddress(institutionalUsycVault));
    assert.ok(migration.migrationHash.length === 64, "Expected 64-char SHA-256 migration voucher");

    // Verify Master System Journal voucher
    const latestEntry = await MasterJournalRepo.getLatestEntry();
    assert.ok(latestEntry);
    assert.equal(latestEntry.action_type, "YIELD_VAULT_CONTRACT_MIGRATED");
    assert.equal(latestEntry.account_id, "CENTRAL_YIELD_VAULT");

    // Verify Audit via Service
    const audit = await service.auditProductionReadiness();
    assert.equal(audit.pillars.yieldVault.isReady, true);
    assert.equal(audit.pillars.yieldVault.score, 100);
    assert.ok(audit.pillars.yieldVault.details.includes(getAddress(institutionalUsycVault)));
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Pillar 2: Production Policy Profile Configuration
  // ─────────────────────────────────────────────────────────────────────────────
  it("Pillar 2: Should promote active policy to PRODUCTION with strict account floors", async () => {
    const activation = await service.activateProductionProfile({
      adminEmail: "cfo@enterprise.io",
      vaultAddress: institutionalUsycVault,
      accountId: prodOpexId,
      reason: "Formal Go-Live Signoff for Arc L1 Autonomous Treasury",
    });

    assert.equal(activation.success, true);
    assert.equal(activation.activatedProfile, "PRODUCTION");
    assert.ok(activation.journalHash.length === 64);

    // Verify Active Profile parameters
    const active = PolicyLoader.getActiveProfile();
    assert.equal(active.profileName, "PRODUCTION");
    const opexDev = active.profile.operating_accounts.find((a) => a.role === "OPEX_DEV");
    const payroll = active.profile.operating_accounts.find((a) => a.role === "PAYROLL");
    assert.ok(opexDev, "Expected OPEX_DEV account in PRODUCTION profile");
    assert.ok(payroll, "Expected PAYROLL account in PRODUCTION profile");
    assert.equal(opexDev.min_floor_usdc, 500.0);
    assert.equal(payroll.min_floor_usdc, 10000.0);
    assert.equal(payroll.exclude_from_waterfall_draws, true);
    assert.equal(opexDev.evaluation_window_days, 30);

    // Verify audit log entry
    const auditLogs = await AuditLogRepo.getAuditLogsByAccount(prodOpexId, 5);
    const activationLog = auditLogs.find((l) => l.action_type === "PRODUCTION_PROFILE_ACTIVATED");
    assert.ok(activationLog);
    assert.equal(activationLog.actor_agent, "PolicyComplianceAgent");
    assert.equal(activationLog.is_autonomous, false);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Pillar 3: Parameterized Production Redemption Latency
  // ─────────────────────────────────────────────────────────────────────────────
  it("Pillar 3: Should enforce production redemption latency tiers (Tier A, Tier B, Tier C)", async () => {
    const audit = await service.auditProductionReadiness();
    const latencyPillar = audit.pillars.redemptionLatency;

    assert.equal(latencyPillar.isReady, true);
    assert.equal(latencyPillar.score, 100);
    assert.equal(latencyPillar.metadata?.tier, "TIER_C_BATCH_T1");
    assert.equal(latencyPillar.metadata?.latencySeconds, 86400);

    // Verify metadata contains all three defined tiers
    assert.equal(latencyPillar.metadata?.allTiers.TIER_A_INSTANT, 900);
    assert.equal(latencyPillar.metadata?.allTiers.TIER_B_BATCH_T0, 28800);
    assert.equal(latencyPillar.metadata?.allTiers.TIER_C_BATCH_T1, 86400);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Pillar 4: Production Spending Limits & Human Gate
  // ─────────────────────────────────────────────────────────────────────────────
  it("Pillar 4: Should enforce production spending limits ($25k daily cap, $5k human gate threshold)", async () => {
    const audit = await service.auditProductionReadiness();
    const limitsPillar = audit.pillars.spendingLimits;

    assert.equal(limitsPillar.isReady, true);
    assert.equal(limitsPillar.score, 100);
    assert.equal(limitsPillar.metadata?.dailyHardCapUsdc, 25000.0);
    assert.equal(limitsPillar.metadata?.singleTxHumanGateThresholdUsdc, 5000.0);

    // Ensure hackathon thresholds ($10) are no longer active
    assert.notEqual(limitsPillar.metadata?.singleTxHumanGateThresholdUsdc, 10.0);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Pillar 5: Production Wallet Configuration & Arc L1 Protocol Standards
  // ─────────────────────────────────────────────────────────────────────────────
  it("Pillar 5: Should validate EVM checksums, Arc Chain ID 5042, and 20 Gwei gas floor", async () => {
    const audit = await service.auditProductionReadiness();
    const walletPillar = audit.pillars.walletConfiguration;

    assert.equal(walletPillar.isReady, true);
    assert.ok(walletPillar.score >= 90);
    assert.equal(walletPillar.metadata?.chainId, ARC_CONSTANTS.MAINNET.chainId);
    assert.equal(walletPillar.metadata?.testnetChainId, ARC_CONSTANTS.TESTNET.chainId);

    // Verify protocol gas floor & decimal factor
    assert.equal(ARC_CONSTANTS.MIN_GAS_FLOOR_GWEI, 20n);
    assert.equal(ARC_CONSTANTS.DECIMAL_CONVERSION_FACTOR, 10n ** 12n);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Pillar 6: Production Vendor Registry Immutability
  // ─────────────────────────────────────────────────────────────────────────────
  it("Pillar 6: Should enforce immutable change_lock and verified payout address in Vendor Master", async () => {
    const audit = await service.auditProductionReadiness();
    const vendorPillar = audit.pillars.vendorRegistry;

    assert.equal(vendorPillar.isReady, true);
    assert.ok(vendorPillar.score >= 80);

    // Verify Anti-Payee Substitution verification
    const vendor = await VendorMasterRepo.getVendorById(prodVendorId);
    assert.ok(vendor);
    assert.equal(vendor.change_lock, true);
    assert.equal(vendor.verified_payout_address.toLowerCase(), prodPayoutAddress.toLowerCase());

    // Verify tool registry check_vendor_master
    const toolCheck = await toolRegistry.executeTool("check_vendor_master", {
      vendorId: prodVendorId,
      payoutAddress: prodPayoutAddress,
    });
    assert.equal(toolCheck.success, true);
    assert.equal(toolCheck.data.isMatch, true);

    // Verify unauthorized substitution is detected
    const spoofCheck = await toolRegistry.executeTool("check_vendor_master", {
      vendorId: prodVendorId,
      payoutAddress: "0x000000000000000000000000000000000000dEaD",
    });
    assert.equal(spoofCheck.success, false);
    assert.ok(spoofCheck.error?.includes("Possible payee substitution"));
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Pillar 7: Monitoring & Solvency Invariant (BE = BL + BY & SHA-256 Hash Chain)
  // ─────────────────────────────────────────────────────────────────────────────
  it("Pillar 7: Should verify cryptographic hash chain integrity and Tripartite Solvency Invariant", async () => {
    // 1. Verify Hash Chain Integrity
    const chainVerification = await MasterJournalRepo.verifyChainIntegrity();
    assert.equal(chainVerification.valid, true, `Hash chain broken: ${chainVerification.details}`);
    assert.ok(chainVerification.totalEntries > 0);

    // 2. Verify Tripartite Invariant on seeded accounts
    const dynamicRecords = new DynamicRecordsService();
    const opexTripartite = await dynamicRecords.getTripartiteBalance(prodOpexId);
    assert.equal(opexTripartite.invariantSatisfied, true);

    const audit = await service.auditProductionReadiness();
    const monitoringPillar = audit.pillars.monitoringAndSolvency;
    assert.equal(monitoringPillar.isReady, true);
    assert.equal(monitoringPillar.score, 100);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Pillar 8: Operational Controls & Emergency Circuit Breaker
  // ─────────────────────────────────────────────────────────────────────────────
  it("Pillar 8: Should trip emergency circuit breaker and require clearance code to disarm", async () => {
    // 1. Trip Emergency Circuit Breaker
    const tripResult = await service.triggerEmergencyCircuitBreaker(
      "Unusual cross-chain slippage detected in external DEX",
      "cfo@enterprise.io"
    );
    assert.equal(tripResult.circuitBreakerActive, true);
    assert.equal(tripResult.emergencyReason, "Unusual cross-chain slippage detected in external DEX");

    // Audit should report Pillar 8 as not ready / score penalized
    const auditTripped = await service.auditProductionReadiness();
    assert.equal(auditTripped.pillars.operationalControls.isReady, false);
    assert.equal(auditTripped.pillars.operationalControls.score, 0);

    // 2. Attempt Reset without valid clearance code -> Should Throw
    await assert.rejects(
      async () => {
        await service.resetCircuitBreaker("cfo@enterprise.io", "short_code");
      },
      /Valid administrative clearance code required/
    );

    // 3. Reset with valid 16+ character clearance code
    const resetResult = await service.resetCircuitBreaker(
      "cfo@enterprise.io",
      "CLEARANCE-OVERRIDE-SEC-AUTH-2026-X88"
    );
    assert.equal(resetResult.circuitBreakerActive, false);
    assert.equal(resetResult.status, "NORMAL_OPERATIONS_RESTORED");

    // Audit should restore Pillar 8 score
    const auditRestored = await service.auditProductionReadiness();
    assert.equal(auditRestored.pillars.operationalControls.isReady, true);
    assert.equal(auditRestored.pillars.operationalControls.score, 100);
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Pillar 9: ToolRegistry D23 Function Invocations
  // ─────────────────────────────────────────────────────────────────────────────
  it("ToolRegistry: Should execute audit_production_readiness, activate_production_profile, and emergency circuit breaker", async () => {
    // 1. Audit production readiness via ToolRegistry
    const auditToolResult = await toolRegistry.executeTool("audit_production_readiness", {
      companyId: testCompanyId,
    });
    assert.equal(auditToolResult.success, true);
    assert.ok(auditToolResult.data.overallScore >= 80);
    assert.equal(auditToolResult.data.activeProfile, "PRODUCTION");

    // 2. Circuit breaker trip via ToolRegistry
    const tripToolResult = await toolRegistry.executeTool("trigger_emergency_circuit_breaker", {
      action: "TRIP",
      reason: "Automated regression testing freeze",
      adminEmail: "security@bizarc.io",
    });
    assert.equal(tripToolResult.success, true);
    assert.equal(tripToolResult.data.circuitBreakerActive, true);

    // 3. Circuit breaker reset via ToolRegistry
    const resetToolResult = await toolRegistry.executeTool("trigger_emergency_circuit_breaker", {
      action: "RESET",
      reason: "Testing complete, resume operations",
      adminEmail: "cfo@bizarc.io",
      clearanceCode: "CLEARANCE-D23-REGRESSION-PASSED-2026",
    });
    assert.equal(resetToolResult.success, true);
    assert.equal(resetToolResult.data.circuitBreakerActive, false);
  });
});
