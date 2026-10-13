import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { DbClient } from "../src/database/dbClient.js";
import { McpClientManager } from "../src/connectors/mcpClientManager.js";
import { MissingVendorCredentialsError } from "../src/connectors/vendorBillingTypes.js";
import { IntakeDiscoveryAgent } from "../src/services/intakeDiscoveryAgent.js";
import { VendorMasterRepo } from "../src/database/repos/vendorMasterRepo.js";
import { OnboardingWizardService } from "../src/services/onboardingWizardService.js";

describe("IntakeDiscoveryAgent & McpClientManager Architecture Verification", () => {
  const companyId = `cmp_intake_test_${Date.now()}`;
  let sessionId: string;

  before(async () => {
    // Seed verified vendor in VendorMasterRepo (Rule 3 Payee Verification)
    await VendorMasterRepo.registerVendor({
      vendor_id: "vnd_datadog",
      name: "Datadog, Inc.",
      verified_payout_address: "0x2222222222222222222222222222222222222222",
      verified_by_admin: "admin_tester",
      last_verified_at: new Date(),
      change_lock: true,
    });

    const wizardService = new OnboardingWizardService();
    const session = await wizardService.createSession({
      companyId,
      entryPath: "GOOGLE_WORKSPACE",
    });
    sessionId = session.sessionId;
  });

  after(async () => {
    await DbClient.closePool();
  });

  it("1. McpClientManager loudly throws MissingVendorCredentialsError when credentials missing (Rule 5)", async () => {
    await assert.rejects(
      async () => await McpClientManager.getClientSession("cmp_unauthed_999", "GOOGLE_WORKSPACE"),
      (err: any) => {
        assert.ok(err instanceof MissingVendorCredentialsError);
        assert.equal(err.vendorName, "Google Workspace MCP");
        return true;
      }
    );

    await assert.rejects(
      async () => await McpClientManager.getClientSession("cmp_unauthed_999", "MICROSOFT_365"),
      (err: any) => {
        assert.ok(err instanceof MissingVendorCredentialsError);
        assert.equal(err.vendorName, "Microsoft 365 MCP");
        return true;
      }
    );
  });

  it("2. IntakeDiscoveryAgent synthesizes across Workspace MCP and Top 10 Vendor Connectors", async () => {
    const testGoogleTransport = {
      async callTool(name: string, args: Record<string, any>) {
        if (name === "gmail_search_messages") return { messageIds: ["msg_dd_01"] };
        if (name === "gmail_get_message") {
          return {
            id: "msg_dd_01",
            bodyText: "Datadog Invoice INV-2026-DD-9812 for $1,250.00 USDC due 2026-10-15 to 0x2222222222222222222222222222222222222222 PO: PO-2026-DATADOG-01 Cost Center: Engineering Cloud Infrastructure",
          };
        }
        if (name === "gdrive_search_files") {
          return {
            files: [
              {
                id: "doc_dd_contract",
                name: "Datadog_Enterprise_Agreement.pdf",
                textContent: "Master Services Agreement Datadog Committed Monthly Spend $1,000.00 USDC. Terms: Vendor must provide 30-day prior written notice for price increases exceeding 5%. Department: Engineering Cloud Infrastructure",
              },
            ],
          };
        }
        return {};
      },
    };

    const testMicrosoftTransport = {
      async callTool(name: string, args: Record<string, any>) {
        if (name === "onedrive_search_files") {
          return {
            files: [
              { id: "wb_budget", name: "Budget_Schedule.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
            ],
          };
        }
        if (name === "excel_read_range") {
          return {
            values: [
              ["Vendor Name", "Monthly Cost (USDC)", "Due Date", "Department Tag", "PO Number", "Payout Wallet"],
              ["GitHub, Inc.", "$500.00", "2026-10-25", "Developer Tooling & CI/CD", "PO-2026-GH-01", "0x3333333333333333333333333333333333333333"],
            ],
          };
        }
        return {};
      },
    };

    const testAwsTransport = {
      async request() {
        return {
          monthlySpend: 9200.0,
          forecastedSpend: 9500.0,
          costCenters: [{ tag: "Core Cloud Compute", amount: 9200.0 }],
        };
      },
    };

    const agent = new IntakeDiscoveryAgent({
      companyId,
      googleTransport: testGoogleTransport,
      microsoftTransport: testMicrosoftTransport,
      vendorTransports: { AWS: testAwsTransport },
    });

    const synthesis = await agent.synthesizeAllSources();

    assert.equal(synthesis.companyId, companyId);
    assert.ok(synthesis.discoveredCostCenters.length >= 2, "Must discover normalized cost centers");
    assert.ok(synthesis.discoveredLiabilities.length >= 2, "Must discover liabilities from workspace & AWS");
    assert.ok(synthesis.totalCommittedMonthlySpendUsdc > 0);

    // Rule 3 Payee Verification
    const datadogLiab = synthesis.discoveredLiabilities.find((l) => l.vendorName.includes("Datadog"));
    assert.ok(datadogLiab);
    assert.equal(datadogLiab?.payeeVerified, true, "Datadog payout address must be verified against VendorMasterRepo");

    // Stealth Price Creep Detection (Datadog billed $1,250 vs $1,000 baseline)
    assert.ok(synthesis.stealthCreepAlerts.length >= 1, "Must trigger Stealth Price Creep alert");
    assert.equal(synthesis.stealthCreepAlerts[0].vendorName, "Datadog, Inc.");
    assert.ok(synthesis.stealthCreepAlerts[0].clause.includes("30-day prior written notice"));
  });

  it("3. IntakeDiscoveryAgent pre-fills wizard draft session successfully", async () => {
    const testAwsTransport = {
      async request() {
        return {
          monthlySpend: 5000.0,
          forecastedSpend: 5200.0,
          costCenters: [{ tag: "Cloud Infrastructure", amount: 5000.0 }],
        };
      },
    };

    const agent = new IntakeDiscoveryAgent({
      companyId,
      vendorTransports: { AWS: testAwsTransport },
    });

    const updatedSession = await agent.prefillWizardSession(sessionId);
    assert.equal(updatedSession.sessionId, sessionId);
    assert.equal(updatedSession.status, "DRAFT_READY");
    assert.ok(updatedSession.draftPayload.step4_accounts.length >= 1);
    assert.ok(updatedSession.draftPayload.step5_liabilities.length >= 1);
  });
});
