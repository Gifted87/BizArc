import { TenantOAuthRepo } from "../database/repos/tenantOAuthRepo.js";
import { VendorMasterRepo } from "../database/repos/vendorMasterRepo.js";
import {
  VendorBillingData,
  VendorDiscoveredCostCenter,
  VendorInvoiceItem,
  IVendorTransport,
  MissingVendorCredentialsError,
} from "./vendorBillingTypes.js";

export class OpenAiBillingConnector {
  private companyId: string;
  private transport?: IVendorTransport;

  constructor(companyId: string, transport?: IVendorTransport) {
    this.companyId = companyId;
    this.transport = transport;
  }

  public async fetchBillingData(): Promise<VendorBillingData> {
    const token = await TenantOAuthRepo.getToken(this.companyId, "OPENAI_ADMIN");
    const adminKey = token?.access_token_encrypted || process.env.OPENAI_ADMIN_KEY;

    let costsData: any;
    let usageData: any;

    if (this.transport) {
      costsData = await this.transport.request("/v1/organization/costs", { method: "GET" });
      usageData = await this.transport.request("/v1/organization/usage", { method: "GET" });
    } else if (adminKey) {
      const baseUrl = "https://api.openai.com/v1/organization";
      const headers = {
        Authorization: `Bearer ${adminKey}`,
        "Content-Type": "application/json",
      };

      const now = Math.floor(Date.now() / 1000);
      const thirtyDaysAgo = now - 30 * 86400;

      const [costsRes, usageRes] = await Promise.all([
        fetch(`${baseUrl}/costs?start_time=${thirtyDaysAgo}&bucket_width=1d&group_by=project_id`, { headers }),
        fetch(`${baseUrl}/usage/completions?start_time=${thirtyDaysAgo}&bucket_width=1d`, { headers }),
      ]);

      if (!costsRes.ok) {
        throw new Error(`OpenAI Organization Costs API error: HTTP ${costsRes.status} ${costsRes.statusText}`);
      }
      costsData = await costsRes.json();
      usageData = usageRes.ok ? await usageRes.json() : { data: [] };
    } else {
      throw new MissingVendorCredentialsError(
        "OpenAI",
        this.companyId,
        "Neither OPENAI_ADMIN OAuth/API-key record nor OPENAI_ADMIN_KEY environment variable found."
      );
    }

    let monthlySpend = 0;
    const discoveredCostCenters: VendorDiscoveredCostCenter[] = [];

    if (costsData?.data && Array.isArray(costsData.data)) {
      for (const bucket of costsData.data) {
        const results = bucket.results || [];
        for (const r of results) {
          const amount = parseFloat(r.amount?.value || "0");
          monthlySpend += amount;
          const projectId = r.project_id || "default-project";
          if (!discoveredCostCenters.some((c) => c.tag === projectId)) {
            discoveredCostCenters.push({
              tag: `OpenAI Project: ${projectId}`,
              suggestedRole: "OPEX_AI",
              dimensionSource: "openai:organization/costs (project_id)",
            });
          }
        }
      }
    } else if (typeof costsData?.monthlySpend === "number") {
      monthlySpend = costsData.monthlySpend;
    } else {
      monthlySpend = 0;
    }

    if (discoveredCostCenters.length === 0) {
      discoveredCostCenters.push(
        { tag: "Autonomous Agent Inference (GPT-4o)", suggestedRole: "OPEX_AI", dimensionSource: "openai:project_id (prod-agents)" },
        { tag: "Code Copilot & Embeddings", suggestedRole: "OPEX_DEV", dimensionSource: "openai:project_id (internal-copilot)" }
      );
    }

    monthlySpend = Math.round(monthlySpend * 100) / 100;
    const forecastedSpend = Math.round(monthlySpend * 1.10 * 100) / 100;
    const dueDate = new Date(Date.now() + 15 * 86400 * 1000).toISOString().split("T")[0];
    const payoutAddress = await VendorMasterRepo.resolveVerifiedPayoutAddress("vendor_openai");

    const invoices: VendorInvoiceItem[] = [
      {
        invoiceId: `INV-2026-OAI-${Date.now()}`,
        amountUsdc: monthlySpend,
        dueDate,
        payoutAddress,
        poNumber: "PO-2026-OPENAI-API",
        costCenterTag: discoveredCostCenters[0].tag,
      },
    ];

    return {
      vendorId: "vendor_openai",
      vendorName: "OpenAI, Inc.",
      monthlySpendUsdc: monthlySpend,
      forecastedMonthlySpendUsdc: forecastedSpend,
      billingCycleAnchorDay: 1,
      invoices,
      discoveredCostCenters,
      optimalPaymentRail: "GATEWAY_X402",
    };
  }
}
