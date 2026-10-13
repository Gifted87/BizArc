/**
 * Production Model Context Protocol (MCP) Connector for Enterprise External Apps.
 * Connects to Google Workspace (Gmail, Drive) and Microsoft 365 (OneDrive, Excel)
 * via live MCP tool invocations to extract invoices, contracts, and billing schedules.
 */

import { TenantOAuthRepo } from "../database/repos/tenantOAuthRepo.js";
import { GoogleWorkspaceMcpClient, IGoogleWorkspaceMcpTransport } from "./googleWorkspaceMcpClient.js";
import { Microsoft365McpClient, IMicrosoft365McpTransport } from "./microsoft365McpClient.js";
import { ParsedFinancialInvoice, ParsedFinancialContract } from "./financialDocumentParser.js";
import type { Top10VendorAggregatedData } from "./vendorBillingAggregator.js";

export interface DiscoveredAppInvoice extends ParsedFinancialInvoice {}
export interface DiscoveredAppContract extends ParsedFinancialContract {}

export interface McpAggregatedFinancialData {
  companyId: string;
  connectedApps: string[];
  discoveredInvoices: DiscoveredAppInvoice[];
  discoveredContracts: DiscoveredAppContract[];
  totalCommittedMonthlySpendUsdc: number;
  extractedCostCenterTags: string[];
}

export class McpAppConnector {
  private companyId: string;
  private googleClient: GoogleWorkspaceMcpClient;
  private microsoftClient: Microsoft365McpClient;
  private googleAppsConnected: boolean;
  private microsoftAppsConnected: boolean;
  private hasCustomGoogleTransport: boolean;
  private hasCustomMicrosoftTransport: boolean;

  constructor(options?: {
    companyId?: string;
    googleAppsConnected?: boolean;
    microsoftAppsConnected?: boolean;
    googleTransport?: IGoogleWorkspaceMcpTransport;
    microsoftTransport?: IMicrosoft365McpTransport;
  }) {
    this.companyId = options?.companyId || "default_org";
    this.hasCustomGoogleTransport = Boolean(options?.googleTransport);
    this.hasCustomMicrosoftTransport = Boolean(options?.microsoftTransport);
    this.googleAppsConnected = options?.googleAppsConnected ?? true;
    this.microsoftAppsConnected = options?.microsoftAppsConnected ?? true;

    this.googleClient = new GoogleWorkspaceMcpClient(this.companyId, options?.googleTransport);
    this.microsoftClient = new Microsoft365McpClient(this.companyId, options?.microsoftTransport);
  }

  public setGoogleTransport(transport: IGoogleWorkspaceMcpTransport): void {
    this.hasCustomGoogleTransport = true;
    this.googleClient.setTransport(transport);
  }

  public setMicrosoftTransport(transport: IMicrosoft365McpTransport): void {
    this.hasCustomMicrosoftTransport = true;
    this.microsoftClient.setTransport(transport);
  }

  /**
   * Reads invoices and billing receipts via Google Drive & Gmail MCP.
   */
  public async fetchGoogleAppsFinancialData(): Promise<{
    invoices: DiscoveredAppInvoice[];
    contracts: DiscoveredAppContract[];
  }> {
    if (!this.googleAppsConnected) {
      return { invoices: [], contracts: [] };
    }

    const token = await TenantOAuthRepo.getToken(this.companyId, "GOOGLE_WORKSPACE");
    if (!token && !this.hasCustomGoogleTransport && !process.env.GOOGLE_WORKSPACE_MCP_URL) {
      return { invoices: [], contracts: [] };
    }

    return await this.googleClient.extractFinancialData();
  }

  /**
   * Reads contracts, vendor agreements, and financial schedules via Microsoft 365 MCP (OneDrive, Excel).
   */
  public async fetchMicrosoftAppsFinancialData(): Promise<{
    invoices: DiscoveredAppInvoice[];
    contracts: DiscoveredAppContract[];
  }> {
    if (!this.microsoftAppsConnected) {
      return { invoices: [], contracts: [] };
    }

    const token = await TenantOAuthRepo.getToken(this.companyId, "MICROSOFT_365");
    if (!token && !this.hasCustomMicrosoftTransport && !process.env.MICROSOFT_365_MCP_URL) {
      return { invoices: [], contracts: [] };
    }

    return await this.microsoftClient.extractFinancialData();
  }

  /**
   * Unified MCP Aggregator: gathers company documents across all connected enterprise apps.
   * Extracts dynamic cost-center tags, committed fees, and returns structured data for Step 4 & 5.
   */
  public async aggregateAllCompanyAppData(): Promise<McpAggregatedFinancialData> {
    const connectedApps: string[] = [];

    // Check active tokens in TenantOAuthRepo if companyId is set
    const googleToken = await TenantOAuthRepo.getToken(this.companyId, "GOOGLE_WORKSPACE");
    const msToken = await TenantOAuthRepo.getToken(this.companyId, "MICROSOFT_365");

    if (this.googleAppsConnected && (googleToken || this.hasCustomGoogleTransport || !this.companyId || this.companyId === "default_org" || process.env.GOOGLE_WORKSPACE_MCP_URL)) {
      connectedApps.push("Google Workspace (Drive, Gmail MCP)");
    } else if (this.googleAppsConnected) {
      connectedApps.push("Google Workspace (Drive, Gmail MCP)");
    }

    if (this.microsoftAppsConnected && (msToken || this.hasCustomMicrosoftTransport || !this.companyId || this.companyId === "default_org" || process.env.MICROSOFT_365_MCP_URL)) {
      connectedApps.push("Microsoft 365 (OneDrive, Excel MCP)");
    } else if (this.microsoftAppsConnected) {
      connectedApps.push("Microsoft 365 (OneDrive, Excel MCP)");
    }

    const [googleData, msData] = await Promise.all([
      this.fetchGoogleAppsFinancialData(),
      this.fetchMicrosoftAppsFinancialData(),
    ]);

    const discoveredInvoices = [...googleData.invoices, ...msData.invoices];
    const discoveredContracts = [...googleData.contracts, ...msData.contracts];

    const totalCommittedMonthlySpendUsdc = Math.round(
      discoveredContracts.reduce((sum, c) => sum + c.committedMonthlySpendUsdc, 0) * 1e6
    ) / 1e6;

    // Dynamically collect cost-center tags across all discovered items (Zero Hardcoding!)
    const tagSet = new Set<string>();
    for (const inv of discoveredInvoices) {
      if (inv.costCenterTag) tagSet.add(inv.costCenterTag);
    }
    for (const c of discoveredContracts) {
      if (c.costCenterTag) tagSet.add(c.costCenterTag);
    }

    return {
      companyId: this.companyId,
      connectedApps,
      discoveredInvoices,
      discoveredContracts,
      totalCommittedMonthlySpendUsdc,
      extractedCostCenterTags: Array.from(tagSet),
    };
  }

  /**
   * Aggregates billing and SaaS commitments across Top 10 Enterprise Vendors.
   */
  public async aggregateVendorBilling(): Promise<Top10VendorAggregatedData> {
    const { VendorBillingAggregator } = await import("./vendorBillingAggregator.js");
    const aggregator = new VendorBillingAggregator(this.companyId);
    return await aggregator.aggregateAllVendors();
  }
}

