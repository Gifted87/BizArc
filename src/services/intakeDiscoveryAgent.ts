/**
 * IntakeDiscoveryAgent (Section 4.4 & Section 6 of complete-analysis.md).
 * Automatically ingests documents, invoices, and SaaS schedules from:
 * 1. Google Workspace MCP Client (Gmail, Drive)
 * 2. Microsoft 365 MCP Client (OneDrive, Excel)
 * 3. Top 10 Major Enterprise Vendor Connectors (AWS, GitHub, Datadog, GCP, Azure, OpenAI, Stripe, Snowflake, Twilio, Figma)
 * 4. ERP Integrations (Odoo, ERPNext)
 *
 * Normalizes tags & dimensions, infers suggested account roles (Step 4 proposals),
 * validates counterparties against VendorMasterRepo (Rule 3 Payee Verification),
 * evaluates stealth price creep against contract baselines, and prepares draft pre-fill payloads.
 */

import { McpAppConnector, McpAggregatedFinancialData } from "../connectors/mcpAppConnector.js";
import { VendorBillingAggregator, Top10VendorAggregatedData } from "../connectors/vendorBillingAggregator.js";
import { SessionErpSyncService, ErpSyncResult } from "../connectors/sessionErpSyncService.js";
import { VendorMasterRepo, VendorMasterRecord } from "../database/repos/vendorMasterRepo.js";
import { OnboardingWizardService } from "./onboardingWizardService.js";
import { MasterJournalRepo } from "../database/repos/masterJournalRepo.js";
import { IVendorTransport } from "../connectors/vendorBillingTypes.js";
import { IGoogleWorkspaceMcpTransport } from "../connectors/googleWorkspaceMcpClient.js";
import { IMicrosoft365McpTransport } from "../connectors/microsoft365McpClient.js";

export interface DiscoveredCostCenterCandidate {
  tag: string;
  name: string;
  suggestedRole: "OPEX_INFRA" | "OPEX_DEV" | "OPEX_GROWTH" | "OPEX_AI" | "OPEX_SUPPORT" | "OPEX_DESIGN" | "OPEX_PRODUCT" | "TREASURY_RESERVE";
  dimensionSource: string;
  sourceSystem: string;
}

export interface DiscoveredLiabilityCandidate {
  invoiceId: string;
  vendorName: string;
  vendorId: string;
  amountUsdc: number;
  dueDate: string;
  payoutAddress: string;
  poNumber?: string;
  costCenterTag: string;
  optimalRail: "DISBURSAL_VAULT" | "MODULAR_SESSION_KEY" | "ERC3009_AUTHORIZATION" | "GATEWAY_X402";
  payeeVerified: boolean;
  stealthCreepDetected: boolean;
  stealthCreepClause?: string;
}

export interface IntakeSynthesisResult {
  companyId: string;
  totalCommittedMonthlySpendUsdc: number;
  discoveredCostCenters: DiscoveredCostCenterCandidate[];
  discoveredLiabilities: DiscoveredLiabilityCandidate[];
  connectedSources: string[];
  stealthCreepAlerts: Array<{
    vendorName: string;
    billedAmountUsdc: number;
    baselineAmountUsdc: number;
    clause: string;
  }>;
}

export class IntakeDiscoveryAgent {
  private companyId: string;
  private mcpConnector: McpAppConnector;
  private vendorAggregator: VendorBillingAggregator;

  constructor(options: {
    companyId: string;
    googleTransport?: IGoogleWorkspaceMcpTransport;
    microsoftTransport?: IMicrosoft365McpTransport;
    vendorTransports?: Partial<Record<string, IVendorTransport>>;
  }) {
    this.companyId = options.companyId;
    this.mcpConnector = new McpAppConnector({
      companyId: this.companyId,
      googleTransport: options.googleTransport,
      microsoftTransport: options.microsoftTransport,
    });
    this.vendorAggregator = new VendorBillingAggregator(this.companyId, options.vendorTransports);
  }

  /**
   * Synthesizes financial data across connected workspace apps, ERPs, and top 10 vendors.
   */
  public async synthesizeAllSources(): Promise<IntakeSynthesisResult> {
    const connectedSources: string[] = [];
    const costCenterMap = new Map<string, DiscoveredCostCenterCandidate>();
    const liabilities: DiscoveredLiabilityCandidate[] = [];
    const stealthCreepAlerts: Array<{
      vendorName: string;
      billedAmountUsdc: number;
      baselineAmountUsdc: number;
      clause: string;
    }> = [];

    // 1. Gather Workspace Documents (Google Workspace & Microsoft 365 MCP)
    try {
      const workspaceData: McpAggregatedFinancialData = await this.mcpConnector.aggregateAllCompanyAppData();
      connectedSources.push(...workspaceData.connectedApps);

      for (const tag of workspaceData.extractedCostCenterTags) {
        if (!costCenterMap.has(tag)) {
          costCenterMap.set(tag, {
            tag,
            name: tag,
            suggestedRole: this.inferRoleFromTag(tag),
            dimensionSource: "Workspace Document Extraction (Gmail / OneDrive)",
            sourceSystem: "WORKSPACE_MCP",
          });
        }
      }

      for (const inv of workspaceData.discoveredInvoices) {
        const payoutAddr = inv.payoutAddress || "0x3600000000000000000000000000000000000000";
        const isVerified = await this.verifyPayee(payoutAddr, inv.vendorName);
        liabilities.push({
          invoiceId: (inv as any).invoiceId || inv.documentId || `INV-${Date.now()}`,
          vendorName: inv.vendorName,
          vendorId: `vnd_${inv.vendorName.toLowerCase().replace(/[^a-z0-9]/g, "_")}`,
          amountUsdc: inv.amountUsdc,
          dueDate: inv.dueDate,
          payoutAddress: payoutAddr,
          poNumber: inv.poNumber,
          costCenterTag: inv.costCenterTag || "Core Platform",
          optimalRail: "DISBURSAL_VAULT",
          payeeVerified: isVerified,
          stealthCreepDetected: false,
        });
      }

      // Check contract baseline commitments against invoices for stealth price creep
      for (const contract of workspaceData.discoveredContracts) {
        if (contract.stealthPriceCreepClause) {
          const matchingInvs = workspaceData.discoveredInvoices.filter((i) =>
            i.vendorName.toLowerCase().includes(contract.counterparty.toLowerCase().split(" ")[0])
          );
          for (const inv of matchingInvs) {
            if (inv.amountUsdc > contract.committedMonthlySpendUsdc * 1.05) {
              stealthCreepAlerts.push({
                vendorName: contract.counterparty,
                billedAmountUsdc: inv.amountUsdc,
                baselineAmountUsdc: contract.committedMonthlySpendUsdc,
                clause: contract.stealthPriceCreepClause,
              });
            }
          }
        }
      }
    } catch (err: any) {
      console.warn(`[IntakeDiscoveryAgent] Workspace MCP synthesis notice:`, err.message);
    }

    // 2. Gather Top 10 Major Enterprise Vendor Billing Data
    try {
      const vendorData: Top10VendorAggregatedData = await this.vendorAggregator.aggregateAllVendors();
      if (vendorData.vendors.length > 0) {
        connectedSources.push(`Top 10 Enterprise Vendors (${vendorData.vendors.length} connected)`);
      }

      for (const cc of vendorData.aggregatedCostCenters) {
        if (!costCenterMap.has(cc.tag)) {
          costCenterMap.set(cc.tag, {
            tag: cc.tag,
            name: cc.tag,
            suggestedRole: cc.suggestedRole,
            dimensionSource: cc.dimensionSource,
            sourceSystem: "VENDOR_BILLING_API",
          });
        }
      }

      for (const inv of vendorData.aggregatedInvoices) {
        const isVerified = await this.verifyPayee(inv.payoutAddress, inv.poNumber);
        liabilities.push({
          invoiceId: inv.invoiceId,
          vendorName: inv.poNumber.split("-")[2] || "Enterprise Vendor",
          vendorId: `vnd_${inv.invoiceId.split("-")[2]?.toLowerCase() || "vendor"}`,
          amountUsdc: inv.amountUsdc,
          dueDate: inv.dueDate,
          payoutAddress: inv.payoutAddress,
          poNumber: inv.poNumber,
          costCenterTag: inv.costCenterTag,
          optimalRail: "DISBURSAL_VAULT",
          payeeVerified: isVerified,
          stealthCreepDetected: false,
        });
      }
    } catch (err: any) {
      console.warn(`[IntakeDiscoveryAgent] Vendor aggregator synthesis notice:`, err.message);
    }

    // 3. Gather ERP Sync Data (Odoo / ERPNext)
    try {
      const odooSync: ErpSyncResult = await SessionErpSyncService.syncOdoo(this.companyId);
      if (odooSync.connected) {
        connectedSources.push("Odoo ERP");
        for (const cc of odooSync.discoveredCostCenters) {
          costCenterMap.set(cc.name, {
            tag: cc.name,
            name: cc.name,
            suggestedRole: cc.role as any,
            dimensionSource: "Odoo Analytic Accounts",
            sourceSystem: "ODOO",
          });
        }
      }

      const erpNextSync: ErpSyncResult = await SessionErpSyncService.syncErpNext(this.companyId);
      if (erpNextSync.connected) {
        connectedSources.push("ERPNext");
        for (const cc of erpNextSync.discoveredCostCenters) {
          costCenterMap.set(cc.name, {
            tag: cc.name,
            name: cc.name,
            suggestedRole: cc.role as any,
            dimensionSource: "ERPNext Cost Center Hierarchy",
            sourceSystem: "ERPNEXT",
          });
        }
      }
    } catch (err: any) {
      console.warn(`[IntakeDiscoveryAgent] ERP synthesis notice:`, err.message);
    }

    const totalCommittedMonthlySpendUsdc = Math.round(
      liabilities.reduce((sum, l) => sum + l.amountUsdc, 0) * 100
    ) / 100;

    await MasterJournalRepo.appendEntry({
      account_id: `acc_${this.companyId}_discovery`,
      company_id: this.companyId,
      action_type: "INTAKE_DISCOVERY_SYNTHESIZED",
      debit_account: "INTAKE_DISCOVERY",
      credit_account: "SYSTEM_LEDGER",
      amount_usdc: 0,
      document_ref: `DISCOVERY:SYNTHESIS:${this.companyId}:${Date.now()}`,
    });

    return {
      companyId: this.companyId,
      totalCommittedMonthlySpendUsdc,
      discoveredCostCenters: Array.from(costCenterMap.values()),
      discoveredLiabilities: liabilities,
      connectedSources,
      stealthCreepAlerts,
    };
  }

  /**
   * Pre-populates an onboarding wizard session draft from synthesized intake discoveries.
   */
  public async prefillWizardSession(sessionId: string): Promise<any> {
    const intakeResult = await this.synthesizeAllSources();

    const draftCostCenters = intakeResult.discoveredCostCenters.map((cc, idx) => ({
      accountId: `acc_${this.companyId}_${idx + 1}`,
      name: cc.name,
      role: cc.suggestedRole,
      tag: cc.tag,
      dimensionSource: cc.dimensionSource,
    }));

    const draftInvoices = intakeResult.discoveredLiabilities.map((l) => ({
      invoiceId: l.invoiceId,
      vendorName: l.vendorName,
      amountUsdc: l.amountUsdc,
      dueDate: l.dueDate,
      costCenterTag: l.costCenterTag,
      payoutAddress: l.payoutAddress,
      poNumber: l.poNumber,
      optimalRail: l.optimalRail,
    }));

    const wizardService = new OnboardingWizardService();
    return await wizardService.prefillDraftFromConnectedSource(sessionId, {
      costCenters: draftCostCenters,
      invoices: draftInvoices,
      connectedSources: intakeResult.connectedSources,
    });
  }

  /**
   * Rule 3 Payee Verification against VendorMasterRepo.
   */
  private async verifyPayee(payoutAddress: string, vendorName?: string): Promise<boolean> {
    if (!payoutAddress || !payoutAddress.startsWith("0x")) return false;
    const existing = await VendorMasterRepo.getVendorByAddress(payoutAddress);
    return Boolean(existing);
  }

  /**
   * Infers role from normalized tag names.
   */
  private inferRoleFromTag(
    tag: string
  ): "OPEX_INFRA" | "OPEX_DEV" | "OPEX_GROWTH" | "OPEX_AI" | "OPEX_SUPPORT" | "OPEX_DESIGN" | "OPEX_PRODUCT" | "TREASURY_RESERVE" {
    const lower = tag.toLowerCase();
    if (lower.includes("infra") || lower.includes("cloud") || lower.includes("cluster") || lower.includes("compute")) {
      return "OPEX_INFRA";
    }
    if (lower.includes("ai") || lower.includes("inference") || lower.includes("gpt") || lower.includes("model")) {
      return "OPEX_AI";
    }
    if (lower.includes("marketing") || lower.includes("growth") || lower.includes("sms") || lower.includes("carrier")) {
      return "OPEX_GROWTH";
    }
    if (lower.includes("design") || lower.includes("figma") || lower.includes("ui") || lower.includes("ux")) {
      return "OPEX_DESIGN";
    }
    if (lower.includes("product")) {
      return "OPEX_PRODUCT";
    }
    if (lower.includes("support")) {
      return "OPEX_SUPPORT";
    }
    return "OPEX_DEV";
  }
}
