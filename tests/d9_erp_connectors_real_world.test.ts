import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { ErpNextConnector } from "../src/connectors/erpNextConnector.js";
import { OdooConnector } from "../src/connectors/odooConnector.js";
import { ErpSyncRepo } from "../src/database/repos/erpSyncRepo.js";
import { EnterpriseOnboardingService } from "../src/services/enterpriseOnboardingService.js";
import { LiabilityRadarService } from "../src/services/liabilityRadarService.js";
import { MasterJournalRepo } from "../src/database/repos/masterJournalRepo.js";
import { AuditLogRepo } from "../src/database/repos/auditLogRepo.js";
import { TreasuryAccountsRepo } from "../src/database/repos/treasuryAccountsRepo.js";
import { DbClient } from "../src/database/dbClient.js";
import { LoudRoundingError } from "../src/foundation/usdc/usdcService.js";

describe("D6-D9 Real-World ERP Connectors & Enterprise Onboarding Audit", () => {
  const erpNext = new ErpNextConnector();
  const odoo = new OdooConnector();
  const onboarding = new EnterpriseOnboardingService();
  const radar = new LiabilityRadarService();

  before(async () => {
    // Seed standard test accounts for ERP linkage
    await TreasuryAccountsRepo.upsertAccount({
      account_id: "acc_engineering",
      name: "Engineering Operations",
      role: "OPEX_DEV",
      wallet_address: "0x1111111111111111111111111111111111111101",
      chain_id: 5042002,
      min_operating_floor_usdc: 50.0,
      safety_buffer_ratio: 1.2,
      is_active: true,
    });
  });

  after(async () => {
    await DbClient.closePool();
  });

  it("Test 1: ERPNext Connector fetches Purchase Orders, GRNs, and Invoices", async () => {
    const pos = await erpNext.getPurchaseOrders();
    assert.ok(pos.length >= 1, "Should fetch at least 1 PO from ERPNext");
    assert.equal(pos[0].supplier, "vnd_aws");
    assert.equal(pos[0].grand_total, 12500.0);

    const receipts = await erpNext.getPurchaseReceipts(pos[0].name);
    assert.ok(receipts.length >= 1, "Should fetch Goods Receipt Note (GRN) for PO");
    assert.equal(receipts[0].purchase_order, pos[0].name);
    assert.equal(receipts[0].status, "Completed");

    const invoices = await erpNext.getPurchaseInvoices();
    assert.ok(invoices.length >= 1, "Should fetch Purchase Invoices from ERPNext");
    assert.equal(invoices[0].supplier, "vnd_aws");
    assert.equal(invoices[0].outstanding_amount, 12500.0);
  });

  it("Test 2: Rule 5 Loud Repair: Refusal of ERPNext 0.5 round-off sweeps", async () => {
    const cleanInvoice = {
      name: "PINV-CLEAN",
      supplier: "vnd_aws",
      grand_total: 100.0,
      outstanding_amount: 100.0,
      due_date: new Date().toISOString(),
      status: "Unpaid",
      items: [],
      round_off: 0,
    };
    const cleanCheck = erpNext.verifyNoSilentRoundOff(cleanInvoice);
    assert.equal(cleanCheck.hasSilentRoundOff, false);

    const silentRoundOffInvoice = {
      name: "PINV-DIRTY",
      supplier: "vnd_aws",
      grand_total: 100.0,
      rounded_total: 100.45,
      round_off: 0.45, // Silent ERPNext round-off sweep
      outstanding_amount: 100.45,
      due_date: new Date().toISOString(),
      status: "Unpaid",
      items: [],
    };
    const dirtyCheck = erpNext.verifyNoSilentRoundOff(silentRoundOffInvoice);
    assert.equal(dirtyCheck.hasSilentRoundOff, true);
    assert.equal(dirtyCheck.roundOffAmount, 0.45);

    // Verify LiabilityRadarService loudly throws LoudRoundingError
    await assert.rejects(
      async () => {
        await radar.ingestLiabilityDocument({
          accountId: "acc_engineering",
          vendorId: "vnd_aws",
          title: "Dirty ERPNext Round-off Invoice",
          category: "INFRASTRUCTURE",
          amountUsdc: 100.45,
          dueDate: new Date(Date.now() + 86400000),
          claimedPayoutAddress: "0x1111111111111111111111111111111111111111",
          roundOffSweepDetected: true,
          erpRoundOffAmount: 0.45,
        });
      },
      (err: any) => {
        assert.ok(err instanceof LoudRoundingError);
        assert.ok(err.message.includes("LOUD REPAIR REFUSAL: ERPNext 0.5 round-off sweep detected"));
        return true;
      }
    );
  });

  it("Test 3: Rule 1 Document Linkage: Post onchain-linked Payment Entry to ERPNext", async () => {
    const payment = await erpNext.postPaymentEntry({
      payment_type: "Pay",
      party_type: "Supplier",
      party: "vnd_aws",
      paid_amount: 12500.0,
      reference_no: "0xarc_tx_payment_hash_12345",
      reference_date: new Date().toISOString().split("T")[0],
      purchase_invoice_id: "PINV-2026-AWS-01",
      cost_center: "acc_engineering",
    });

    assert.equal(payment.success, true);
    assert.ok(payment.docName.startsWith("PE-"));
  });

  it("Test 4: Odoo Connector executes JSON-RPC authentication and fetches POs, pickings, and bills", async () => {
    const uid = await odoo.authenticate();
    assert.ok(uid > 0, "Odoo authentication must return a valid integer UID");

    const orders = await odoo.getPurchaseOrders();
    assert.ok(orders.length >= 1);
    assert.equal(orders[0].amount_total, 12500.0);

    const pickings = await odoo.getStockPickings(orders[0].name);
    assert.ok(pickings.length >= 1);
    assert.equal(pickings[0].state, "done");

    const bills = await odoo.getVendorBills();
    assert.ok(bills.length >= 1);
    assert.equal(bills[0].move_type, "in_invoice");

    const paymentRes = await odoo.registerPayment(bills[0].id, 12500.0, "0xarc_odoo_settled_tx");
    assert.equal(paymentRes.success, true);
    assert.ok(paymentRes.paymentId > 0);
  });

  it("Test 5: D6 erp_sync_state checkpoint persistence and retrieval", async () => {
    const syncCheckpoint = await ErpSyncRepo.upsertSyncState({
      sync_id: "sync_erpnext_acc_engineering_01",
      system_type: "ERPNEXT",
      account_id: "acc_engineering",
      entity_type: "PURCHASE_INVOICE",
      last_sync_timestamp: new Date(),
      last_synced_document_id: "PINV-2026-AWS-01",
      sync_checkpoint_data: { batch_size: 50, latest_modified: "2026-10-01T20:00:00Z" },
      status: "SYNCED",
    });

    assert.equal(syncCheckpoint.sync_id, "sync_erpnext_acc_engineering_01");
    assert.equal(syncCheckpoint.system_type, "ERPNEXT");
    assert.equal(syncCheckpoint.last_synced_document_id, "PINV-2026-AWS-01");

    const retrieved = await ErpSyncRepo.getSyncState("sync_erpnext_acc_engineering_01");
    assert.ok(retrieved);
    assert.equal(retrieved?.status, "SYNCED");

    const updated = await ErpSyncRepo.updateCheckpoint(
      "sync_erpnext_acc_engineering_01",
      "PINV-2026-AWS-02",
      { batch_size: 50, latest_modified: "2026-10-01T21:00:00Z" }
    );
    assert.equal(updated?.last_synced_document_id, "PINV-2026-AWS-02");
  });

  it("Test 6: D0.B Phase 5: Smart contract vault registration & ERC-20 allowances", async () => {
    const vaultConfig = await onboarding.registerVaultAndAllowances("acc_engineering");
    assert.equal(vaultConfig.accountId, "acc_engineering");
    assert.equal(vaultConfig.isRegistered, true);
    assert.ok(vaultConfig.registrationCalldata.startsWith("0x"));
    assert.ok(vaultConfig.approvalCalldata.startsWith("0x"));
  });

  it("Test 7: D0.B Phase 7: Activation deposit ingestion & ledger genesis", async () => {
    const activation = await onboarding.ingestActivationDeposit(
      "acc_engineering",
      "0xarc_activation_deposit_tx_hash_112233" as `0x${string}`,
      5000.0
    );

    assert.equal(activation.accountId, "acc_engineering");
    assert.equal(activation.amountUsdc, 5000.0);
    assert.equal(activation.status, "ACTIVATED");
    assert.equal(activation.journalEntryHash.length, 64);

    // Verify journal has document-linked entry (Rule 1)
    const journalEntries = await MasterJournalRepo.getEntriesByAccount("acc_engineering");
    const activationEntry = journalEntries.find((e) => e.action_type === "ACTIVATION_DEPOSIT_INGESTED");
    assert.ok(activationEntry);
    assert.equal(activationEntry?.amount_usdc, 5000.0);
    assert.equal(activationEntry?.document_ref, "ARC:TX:0xarc_activation_deposit_tx_hash_112233");

    // Verify audit log
    const auditLogs = await AuditLogRepo.getAuditLogsByAccount("acc_engineering");
    const activationLog = auditLogs.find((l) => l.action_type === "ACCOUNT_ACTIVATED");
    assert.ok(activationLog);
    assert.equal(activationLog?.actor_agent, "OnboardingAgent");
  });
});
