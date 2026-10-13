import { TenantOAuthRepo } from "../database/repos/tenantOAuthRepo.js";
import { VendorMasterRepo } from "../database/repos/vendorMasterRepo.js";
import {
  VendorBillingData,
  VendorDiscoveredCostCenter,
  VendorInvoiceItem,
  IVendorTransport,
  MissingVendorCredentialsError,
} from "./vendorBillingTypes.js";

export class GithubBillingConnector {
  private companyId: string;
  private transport?: IVendorTransport;

  constructor(companyId: string, transport?: IVendorTransport) {
    this.companyId = companyId;
    this.transport = transport;
  }

  public async fetchBillingData(): Promise<VendorBillingData> {
    const token = await TenantOAuthRepo.getToken(this.companyId, "GITHUB_ENTERPRISE");
    const accessToken = token?.access_token_encrypted || process.env.GITHUB_TOKEN;
    const org = token?.session_metadata?.orgName || process.env.GITHUB_ORG || "bizarc-corp";

    let actionsData: any;
    let storageData: any;
    let copilotData: any;
    let costCentersData: any;

    if (this.transport) {
      actionsData = await this.transport.request(`/orgs/${org}/settings/billing/actions`, { method: "GET" });
      storageData = await this.transport.request(`/orgs/${org}/settings/billing/shared-storage`, { method: "GET" });
      copilotData = await this.transport.request(`/orgs/${org}/copilot/billing`, { method: "GET" });
      costCentersData = await this.transport.request(`/enterprises/${org}/settings/billing/cost-centers`, { method: "GET" });
    } else if (accessToken) {
      const baseUrl = "https://api.github.com";
      const headers = {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${accessToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
      };

      const [actRes, storRes, copRes, ccRes] = await Promise.all([
        fetch(`${baseUrl}/orgs/${org}/settings/billing/actions`, { headers }),
        fetch(`${baseUrl}/orgs/${org}/settings/billing/shared-storage`, { headers }),
        fetch(`${baseUrl}/orgs/${org}/copilot/billing`, { headers }),
        fetch(`${baseUrl}/enterprises/${org}/settings/billing/cost-centers`, { headers }),
      ]);

      if (!actRes.ok) throw new Error(`GitHub Actions Billing error: HTTP ${actRes.status} ${actRes.statusText}`);
      if (!storRes.ok) throw new Error(`GitHub Storage Billing error: HTTP ${storRes.status} ${storRes.statusText}`);
      if (!copRes.ok) throw new Error(`GitHub Copilot Billing error: HTTP ${copRes.status} ${copRes.statusText}`);

      actionsData = await actRes.json();
      storageData = await storRes.json();
      copilotData = await copRes.json();
      costCentersData = ccRes.ok ? await ccRes.json() : { cost_centers: [] };
    } else {
      throw new MissingVendorCredentialsError(
        "GitHub Enterprise",
        this.companyId,
        "Neither GITHUB_ENTERPRISE OAuth record nor GITHUB_TOKEN environment variable found."
      );
    }

    // Calculate spend breakdown
    // Standard Enterprise seats: $21/seat, Copilot: $39/seat
    const enterpriseSeats = copilotData.seat_breakdown?.total || copilotData.seats_count || 50;
    const copilotSeats = copilotData.seat_breakdown?.active_this_cycle || 30;
    const actionsSpend = actionsData.total_paid_minutes_used
      ? actionsData.total_paid_minutes_used * 0.008
      : actionsData.total_spend || 120.0;
    const storageSpend = storageData.estimated_paid_storage_for_month || storageData.total_spend || 45.0;

    const seatsSpend = enterpriseSeats * 21.0;
    const copilotSpend = copilotSeats * 39.0;
    const totalSpend = Math.round((seatsSpend + copilotSpend + actionsSpend + storageSpend) * 100) / 100;
    const forecastedSpend = Math.round(totalSpend * 1.04 * 100) / 100;

    const discoveredCostCenters: VendorDiscoveredCostCenter[] = [];
    if (costCentersData?.cost_centers && Array.isArray(costCentersData.cost_centers)) {
      for (const cc of costCentersData.cost_centers) {
        discoveredCostCenters.push({
          tag: cc.name || cc.cost_center_name,
          suggestedRole: "OPEX_DEV",
          dimensionSource: "/enterprises/{enterprise}/settings/billing/cost-centers",
        });
      }
    }

    if (discoveredCostCenters.length === 0) {
      discoveredCostCenters.push(
        { tag: "Developer Tooling & CI/CD", suggestedRole: "OPEX_DEV", dimensionSource: "github:billing/actions" },
        { tag: "AI Engineering & Copilot", suggestedRole: "OPEX_DEV", dimensionSource: "github:copilot/billing" }
      );
    }

    const dueDate = new Date(Date.now() + 14 * 86400 * 1000).toISOString().split("T")[0];
    const payoutAddress = await VendorMasterRepo.resolveVerifiedPayoutAddress("vendor_github_enterprise");
    const invoices: VendorInvoiceItem[] = [
      {
        invoiceId: `INV-2026-GH-${Date.now()}`,
        amountUsdc: totalSpend,
        dueDate,
        payoutAddress,
        poNumber: "PO-2026-GH-DEVELOPER",
        costCenterTag: discoveredCostCenters[0].tag,
      },
    ];

    return {
      vendorId: "vendor_github_enterprise",
      vendorName: "GitHub, Inc.",
      monthlySpendUsdc: totalSpend,
      forecastedMonthlySpendUsdc: forecastedSpend,
      billingCycleAnchorDay: 1,
      invoices,
      discoveredCostCenters,
      optimalPaymentRail: "MODULAR_SESSION_KEY",
    };
  }
}
