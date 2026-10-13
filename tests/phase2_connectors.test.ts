import assert from "assert";
import { DbClient } from "../src/database/dbClient.js";
import { FinancialDocumentParser } from "../src/connectors/financialDocumentParser.js";
import { GoogleWorkspaceMcpClient } from "../src/connectors/googleWorkspaceMcpClient.js";
import { Microsoft365McpClient } from "../src/connectors/microsoft365McpClient.js";
import { SessionErpSyncService } from "../src/connectors/sessionErpSyncService.js";
import { McpAppConnector } from "../src/connectors/mcpAppConnector.js";
import { ErpSyncRepo } from "../src/database/repos/erpSyncRepo.js";
import { TenantOAuthRepo } from "../src/database/repos/tenantOAuthRepo.js";

async function runPhase2Tests() {
  console.log("======================================================================");
  console.log("      RUNNING PHASE 2 PRODUCTION CONNECTORS & MCP INTEGRATION         ");
  console.log("======================================================================\n");

  const isConnected = await DbClient.checkConnection();
  assert.strictEqual(isConnected, true, "PostgreSQL must be connected");
  console.log("✓ PostgreSQL Database connection verified.");

  // ----------------------------------------------------------------------------------
  // 1. FinancialDocumentParser Verification
  // ----------------------------------------------------------------------------------
  console.log("\n[Test 1] Verifying FinancialDocumentParser (Unstructured Text, Invoices, Contracts, Excel)...");

  // A. Email invoice text parsing
  const rawEmail = `
    From: billing@datadoghq.com
    Subject: Your Monthly Datadog Bill INV-2026-DD-4412
    Date: 2026-10-01
    Hello Finance Team,
    Your Datadog monitoring invoice for the current billing period is $1,250.50 USDC.
    Payment Due: 2026-10-18
    PO Reference: PO-2026-DATADOG-99
    Authorized Payment Address: 0x9999999999999999999999999999999999999999
    Cost Center: Core Infrastructure Platform (tag:CostCenter=InfraPlatform)
  `;
  const parsedInvoice = FinancialDocumentParser.parseInvoiceText(rawEmail, "email_dd_4412", "GMAIL");
  assert.strictEqual(parsedInvoice.vendorName, "Datadog, Inc.");
  assert.strictEqual(parsedInvoice.amountUsdc, 1250.5);
  assert.strictEqual(parsedInvoice.payoutAddress, "0x9999999999999999999999999999999999999999");
  assert.strictEqual(parsedInvoice.poNumber, "PO-2026-DATADOG-99");
  assert.strictEqual(parsedInvoice.costCenterTag, "Core Infrastructure Platform");
  assert.ok(parsedInvoice.confidenceScore >= 0.8, "Confidence score must be >= 0.8");

  // B. Contract MSA parsing with stealth price creep notice clause
  const rawContract = `
    MASTER SERVICES AGREEMENT
    Between Amazon Web Services (AWS) and Customer LLC.
    Effective Date: 2026-02-01
    Renewal Date: 2027-01-31
    Committed Monthly Minimum: $15,000.00 USDC
    Terms: Vendor must provide 60-day prior written notice for any price or tier increases.
    Cost Center: Global Infrastructure Compute
  `;
  const parsedContract = FinancialDocumentParser.parseContractText(rawContract, "contract_aws_edp", "GOOGLE_DRIVE");
  assert.strictEqual(parsedContract.counterparty, "Amazon Web Services (AWS)");
  assert.strictEqual(parsedContract.committedMonthlySpendUsdc, 15000.0);
  assert.strictEqual(parsedContract.noticePeriodDays, 60);
  assert.strictEqual(parsedContract.effectiveDate, "2026-02-01");
  assert.strictEqual(parsedContract.renewalDate, "2027-01-31");
  assert.ok(parsedContract.stealthPriceCreepClause?.includes("60-day prior written notice"));

  // C. Tabular Excel row parsing
  const excelRow = {
    "Vendor Name": "Snowflake, Inc.",
    "Monthly Cost (USDC)": "$8,450.00",
    "Due Date": "2026-10-25",
    "Department Tag": "Data Engineering",
    "PO Number": "PO-2026-SNOW-01",
    "Payout Wallet": "0x8888888888888888888888888888888888888888",
  };
  const parsedExcelRow = FinancialDocumentParser.parseSpreadsheetRow(excelRow, 1, "MICROSOFT_EXCEL");
  assert.ok(parsedExcelRow);
  assert.strictEqual(parsedExcelRow.vendorName, "Snowflake, Inc.");
  assert.strictEqual(parsedExcelRow.amountUsdc, 8450.0);
  assert.strictEqual(parsedExcelRow.payoutAddress, "0x8888888888888888888888888888888888888888");
  assert.strictEqual(parsedExcelRow.costCenterTag, "Data Engineering");
  console.log("✓ FinancialDocumentParser accurately parsed invoices, contracts, and spreadsheets.");

  // ----------------------------------------------------------------------------------
  // 2. Google Workspace MCP Client (Gmail & Google Drive)
  // ----------------------------------------------------------------------------------
  console.log("\n[Test 2] Verifying GoogleWorkspaceMcpClient Tool Invocations...");
  const tenantCorp = `tenant_mcp_${Date.now()}`;

  const testGoogleTransport = {
    async callTool(name: string, args: Record<string, any>) {
      if (name === "gmail_search_messages") {
        return { messageIds: ["msg_dd_101"] };
      }
      if (name === "gmail_get_message") {
        return {
          id: "msg_dd_101",
          bodyText: "Datadog Invoice INV-2026-DD-9812 of $450.00 USDC payable to 0x2222222222222222222222222222222222222222 for Core Platform PO: PO-2026-DATADOG-01 due 2026-10-15 Cost Center: Engineering Cloud Infrastructure (tag:CostCenter=InfraOps)",
        };
      }
      if (name === "gdrive_search_files") {
        return {
          files: [
            {
              id: "f_contract_1",
              name: "AWS_Agreement.pdf",
              textContent: "Master Services Agreement AWS Committed Monthly Spend $12,500.00 USDC Effective 2026-01-01 Renewal 2026-12-31 PO: PO-2026-AWS-01 Payout Address: 0x1111111111111111111111111111111111111111 Cost Center: Cloud Infrastructure Platform Notice Period: 60-day prior written notice required for rate changes.",
            },
          ],
        };
      }
      if (name === "gdrive_download_file") {
        return { text: "Master Services Agreement AWS Committed Monthly Spend $12,500.00 USDC" };
      }
      return {};
    },
  };

  const googleClient = new GoogleWorkspaceMcpClient(tenantCorp, testGoogleTransport);

  const googleData = await googleClient.extractFinancialData();
  assert.ok(googleData.invoices.length >= 1, "Must extract invoices from Gmail messages");
  assert.ok(googleData.contracts.length >= 1, "Must extract contracts from Google Drive files");
  assert.ok(googleData.invoices.some((i) => i.vendorName.includes("Datadog")), "Must identify Datadog invoice");
  assert.ok(googleData.contracts.some((c) => c.committedMonthlySpendUsdc > 0), "Must extract committed monthly spend");
  console.log(`✓ GoogleWorkspaceMcpClient retrieved ${googleData.invoices.length} invoices and ${googleData.contracts.length} contracts.`);

  // ----------------------------------------------------------------------------------
  // 3. Microsoft 365 MCP Client (OneDrive & Excel)
  // ----------------------------------------------------------------------------------
  console.log("\n[Test 3] Verifying Microsoft365McpClient Tool Invocations...");

  const testMicrosoftTransport = {
    async callTool(name: string, args: Record<string, any>) {
      if (name === "onedrive_search_files") {
        return {
          files: [
            {
              id: "wb_1",
              name: "Corporate_Budget.xlsx",
              mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            },
            {
              id: "doc_1",
              name: "GitHub_Enterprise.pdf",
              mimeType: "application/pdf",
              textContent: "GitHub Enterprise Agreement Committed Monthly Spend $450.00 USDC PO: PO-2026-GH-01 Payout: 0x3333333333333333333333333333333333333333 Cost Center: Developer Tooling",
            },
          ],
        };
      }
      if (name === "excel_read_range") {
        return {
          values: [
            ["Vendor Name", "Monthly Cost (USDC)", "Due Date", "Department Tag", "PO Number", "Payout Wallet"],
            ["GitHub, Inc.", "$450.00", "2026-10-20", "Developer Tooling", "PO-2026-GH-01", "0x3333333333333333333333333333333333333333"],
          ],
        };
      }
      return {};
    },
  };

  const msClient = new Microsoft365McpClient(tenantCorp, testMicrosoftTransport);

  const msData = await msClient.extractFinancialData();
  assert.ok(msData.invoices.length >= 1, "Must extract invoices from Excel budget sheet");
  assert.ok(msData.contracts.length >= 1, "Must extract contracts from OneDrive agreements");
  assert.ok(msData.invoices.some((i) => i.vendorName.includes("GitHub")), "Must identify GitHub invoice from Excel");
  console.log(`✓ Microsoft365McpClient retrieved ${msData.invoices.length} invoices and ${msData.contracts.length} contracts.`);

  // ----------------------------------------------------------------------------------
  // 4. Session-Based Odoo & ERPNext Sync
  // ----------------------------------------------------------------------------------
  console.log("\n[Test 4] Verifying SessionErpSyncService (Odoo & ERPNext Real Integrations)...");

  const testOdooTransport = {
    async callJsonRpc<T>(service: string, method: string, args: any[]): Promise<T> {
      if (service === "common" && method === "authenticate") return 1 as any;
      if (service === "object" && method === "execute_kw") {
        const model = args[3];
        if (model === "purchase.order") {
          return [{ id: 101, name: "PO-2026-AWS-01", partner_id: [42, "AWS EMEA"], amount_total: 12500.0, state: "purchase", order_line: [1001] }] as any;
        }
        if (model === "stock.picking") {
          return [{ id: 501, name: "GRN-2026-AWS-01", origin: "PO-2026-AWS-01", state: "done", date_done: new Date().toISOString() }] as any;
        }
        if (model === "account.move") {
          return [{ id: 901, name: "BILL/2026/05/0001", partner_id: [42, "AWS EMEA"], move_type: "in_invoice", amount_total: 12500.0, amount_residual: 12500.0, invoice_date_due: new Date(Date.now() + 86400000 * 5).toISOString(), payment_state: "not_paid", invoice_line_ids: [2001] }] as any;
        }
      }
      return {} as any;
    },
  };

  const testErpNextTransport = {
    async get<T>(path: string, params?: Record<string, any>): Promise<T> {
      if (path === "/api/resource/Purchase Order") {
        return [{ name: "PO-2026-AWS-01", supplier: "vnd_aws", grand_total: 12500.0, currency: "USD", status: "To Receive and Bill", items: [] }] as any;
      }
      if (path === "/api/resource/Purchase Receipt") {
        return [{ name: "GRN-2026-AWS-01", purchase_order: "PO-2026-AWS-01", supplier: "vnd_aws", status: "Completed", items: [] }] as any;
      }
      if (path === "/api/resource/Purchase Invoice") {
        return [{ name: "PINV-2026-AWS-01", supplier: "vnd_aws", grand_total: 12500.0, outstanding_amount: 12500.0, due_date: new Date(Date.now() + 86400000 * 5).toISOString(), status: "Unpaid", items: [] }] as any;
      }
      return [] as any;
    },
    async post<T>(path: string, body: any): Promise<T> {
      return { success: true, docName: "PE-2026-AWS-01" } as any;
    },
  };

  // Sync Odoo with transport
  const odooSync = await SessionErpSyncService.syncOdoo(tenantCorp, undefined, testOdooTransport);
  assert.strictEqual(odooSync.systemType, "ODOO");
  assert.ok(odooSync.discoveredCostCenters.length >= 1, "Must discover Odoo operational cost centers");

  // Sync ERPNext with transport
  const erpnextSync = await SessionErpSyncService.syncErpNext(tenantCorp, undefined, testErpNextTransport);
  assert.strictEqual(erpnextSync.systemType, "ERPNEXT");
  assert.ok(erpnextSync.discoveredCostCenters.length >= 1, "Must discover ERPNext operational cost centers");

  // Check audit state in PostgreSQL
  const odooAudit = await ErpSyncRepo.getSyncState(`sync_odoo_${tenantCorp}`);
  const erpnextAudit = await ErpSyncRepo.getSyncState(`sync_erpnext_${tenantCorp}`);
  assert.ok(odooAudit, "Odoo sync checkpoint must be persisted in PostgreSQL");
  assert.ok(erpnextAudit, "ERPNext sync checkpoint must be persisted in PostgreSQL");
  assert.strictEqual(odooAudit.status, "SYNCED");
  assert.strictEqual(erpnextAudit.status, "SYNCED");
  console.log("✓ SessionErpSyncService synchronized Odoo and ERPNext with PostgreSQL audit states.");

  // ----------------------------------------------------------------------------------
  // 5. Unified McpAppConnector (Production Aggregator — No Stubs)
  // ----------------------------------------------------------------------------------
  console.log("\n[Test 5] Verifying Production McpAppConnector Aggregator (Zero Hardcoded Stubs)...");

  // Store OAuth tokens for tenant in database
  await TenantOAuthRepo.storeToken({
    companyId: tenantCorp,
    provider: "GOOGLE_WORKSPACE",
    accessTokenEncrypted: "enc_gsuite_token_active",
    tokenScope: "https://www.googleapis.com/auth/drive.readonly",
    expiresAt: new Date(Date.now() + 3600000),
  });

  await TenantOAuthRepo.storeToken({
    companyId: tenantCorp,
    provider: "MICROSOFT_365",
    accessTokenEncrypted: "enc_ms365_token_active",
    tokenScope: "Files.Read.All",
    expiresAt: new Date(Date.now() + 3600000),
  });

  const mcpConnector = new McpAppConnector({
    companyId: tenantCorp,
    googleAppsConnected: true,
    microsoftAppsConnected: true,
    googleTransport: testGoogleTransport,
    microsoftTransport: testMicrosoftTransport,
  });

  const aggregate = await mcpConnector.aggregateAllCompanyAppData();
  assert.strictEqual(aggregate.companyId, tenantCorp);
  assert.ok(aggregate.connectedApps.length >= 2);
  assert.ok(aggregate.discoveredInvoices.length >= 2, "Must aggregate invoices from both Google and Microsoft apps");
  assert.ok(aggregate.discoveredContracts.length >= 2, "Must aggregate contracts from both Google and Microsoft apps");
  assert.ok(aggregate.totalCommittedMonthlySpendUsdc > 0, "Committed monthly spend must be positive");

  // Verify dynamic cost-center tags extracted (No hardcoded acc_engineering!)
  assert.ok(aggregate.extractedCostCenterTags.length >= 1, "Must extract dynamic cost-center tags");
  console.log(`✓ Extracted dynamic cost-center tags: [${aggregate.extractedCostCenterTags.join(", ")}]`);
  console.log(`✓ Total committed monthly spend aggregated: $${aggregate.totalCommittedMonthlySpendUsdc.toLocaleString()} USDC`);

  console.log("\n======================================================================");
  console.log(" >>> ALL PHASE 2 PRODUCTION CONNECTORS TESTS PASSED CLEANLY <<< ");
  console.log("======================================================================\n");
}

runPhase2Tests()
  .then(async () => {
    await DbClient.closePool();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("\n❌ PHASE 2 TEST SUITE FAILED:", err);
    await DbClient.closePool();
    process.exit(1);
  });
