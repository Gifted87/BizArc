import { TenantOAuthRepo } from "../database/repos/tenantOAuthRepo.js";
import { VendorMasterRepo } from "../database/repos/vendorMasterRepo.js";
import {
  VendorBillingData,
  VendorDiscoveredCostCenter,
  VendorInvoiceItem,
  IVendorTransport,
  MissingVendorCredentialsError,
} from "./vendorBillingTypes.js";

export class AzureBillingConnector {
  private companyId: string;
  private transport?: IVendorTransport;

  constructor(companyId: string, transport?: IVendorTransport) {
    this.companyId = companyId;
    this.transport = transport;
  }

  public async fetchBillingData(): Promise<VendorBillingData> {
    const token = await TenantOAuthRepo.getToken(this.companyId, "AZURE_SERVICE_PRINCIPAL");
    const accessToken = token?.access_token_encrypted || process.env.AZURE_BEARER_TOKEN;
    const subscriptionId = token?.session_metadata?.subscriptionId || process.env.AZURE_SUBSCRIPTION_ID || "sub-11223344-5566-7788";

    let costData: any;
    let invoiceData: any;

    if (this.transport) {
      costData = await this.transport.request(`/subscriptions/${subscriptionId}/providers/Microsoft.CostManagement/query`, {
        method: "POST",
      });
      invoiceData = await this.transport.request("/providers/Microsoft.Billing/invoices", { method: "GET" });
    } else if (accessToken) {
      const baseUrl = "https://management.azure.com";
      const headers = {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      };

      const costRes = await fetch(
        `${baseUrl}/subscriptions/${subscriptionId}/providers/Microsoft.CostManagement/query?api-version=2021-10-01`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            type: "Usage",
            timeframe: "MonthToDate",
            dataset: {
              granularity: "Monthly",
              aggregation: { totalCost: { name: "PreTaxCost", function: "Sum" } },
              grouping: [{ type: "Dimension", name: "ResourceGroup" }],
            },
          }),
        }
      );

      if (!costRes.ok) {
        throw new Error(`Azure Cost Management API error: HTTP ${costRes.status} ${costRes.statusText}`);
      }
      costData = await costRes.json();
      invoiceData = { value: [] };
    } else {
      throw new MissingVendorCredentialsError(
        "Microsoft Azure",
        this.companyId,
        "Neither AZURE_SERVICE_PRINCIPAL OAuth record nor AZURE_BEARER_TOKEN environment variable found."
      );
    }

    let monthlySpend = 0;
    const discoveredCostCenters: VendorDiscoveredCostCenter[] = [];

    if (costData?.properties?.rows && Array.isArray(costData.properties.rows)) {
      for (const row of costData.properties.rows) {
        const cost = parseFloat(row[0] || "0");
        const rgName = row[1] || "rg-core-infra";
        monthlySpend += cost;
        discoveredCostCenters.push({
          tag: rgName,
          suggestedRole: rgName.toLowerCase().includes("infra") ? "OPEX_INFRA" : "OPEX_DEV",
          dimensionSource: `azure:resourceGroup (${rgName})`,
        });
      }
    } else if (typeof costData?.monthlySpend === "number") {
      monthlySpend = costData.monthlySpend;
    } else {
      monthlySpend = 0;
    }

    if (discoveredCostCenters.length === 0) {
      discoveredCostCenters.push(
        { tag: "Azure Virtual WAN & Gateways", suggestedRole: "OPEX_INFRA", dimensionSource: "azure:tags['cost-center']" },
        { tag: "Enterprise Active Directory & Entra ID", suggestedRole: "OPEX_DEV", dimensionSource: "azure:tags['department']" }
      );
    }

    monthlySpend = Math.round(monthlySpend * 100) / 100;
    const forecastedSpend = Math.round(monthlySpend * 1.05 * 100) / 100;
    const dueDate = new Date(Date.now() + 20 * 86400 * 1000).toISOString().split("T")[0];
    const payoutAddress = await VendorMasterRepo.resolveVerifiedPayoutAddress("vendor_microsoft_azure");

    const invoices: VendorInvoiceItem[] = [
      {
        invoiceId: `INV-2026-AZ-${Date.now()}`,
        amountUsdc: monthlySpend,
        dueDate,
        payoutAddress,
        poNumber: "PO-2026-AZURE-ENTERPRISE",
        costCenterTag: discoveredCostCenters[0].tag,
      },
    ];

    return {
      vendorId: "vendor_microsoft_azure",
      vendorName: "Microsoft Azure",
      monthlySpendUsdc: monthlySpend,
      forecastedMonthlySpendUsdc: forecastedSpend,
      billingCycleAnchorDay: 1,
      invoices,
      discoveredCostCenters,
      optimalPaymentRail: "DISBURSAL_VAULT",
    };
  }
}
