import { TenantOAuthRepo } from "../database/repos/tenantOAuthRepo.js";
import { VendorMasterRepo } from "../database/repos/vendorMasterRepo.js";
import {
  VendorBillingData,
  VendorDiscoveredCostCenter,
  VendorInvoiceItem,
  IVendorTransport,
  MissingVendorCredentialsError,
} from "./vendorBillingTypes.js";

export class StripeBillingConnector {
  private companyId: string;
  private transport?: IVendorTransport;

  constructor(companyId: string, transport?: IVendorTransport) {
    this.companyId = companyId;
    this.transport = transport;
  }

  public async fetchBillingData(): Promise<VendorBillingData> {
    const token = await TenantOAuthRepo.getToken(this.companyId, "STRIPE_RESTRICTED");
    const apiKey = token?.access_token_encrypted || process.env.STRIPE_SECRET_KEY;

    let invoicesData: any;
    let subscriptionsData: any;

    if (this.transport) {
      invoicesData = await this.transport.request("/v1/invoices", { method: "GET" });
      subscriptionsData = await this.transport.request("/v1/subscriptions", { method: "GET" });
    } else if (apiKey) {
      const baseUrl = "https://api.stripe.com/v1";
      const headers = {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      };

      const [invRes, subRes] = await Promise.all([
        fetch(`${baseUrl}/invoices?limit=10&status=open`, { headers }),
        fetch(`${baseUrl}/subscriptions?limit=10&status=active`, { headers }),
      ]);

      if (!invRes.ok) {
        throw new Error(`Stripe Invoices API error: HTTP ${invRes.status} ${invRes.statusText}`);
      }
      invoicesData = await invRes.json();
      subscriptionsData = subRes.ok ? await subRes.json() : { data: [] };
    } else {
      throw new MissingVendorCredentialsError(
        "Stripe",
        this.companyId,
        "Neither STRIPE_RESTRICTED OAuth/API-key record nor STRIPE_SECRET_KEY environment variable found."
      );
    }

    let monthlySpend = 0;
    const discoveredCostCenters: VendorDiscoveredCostCenter[] = [];

    if (invoicesData?.data && Array.isArray(invoicesData.data)) {
      for (const inv of invoicesData.data) {
        const amount = (inv.amount_due || inv.total || 0) / 100.0;
        monthlySpend += amount;
        const ccTag = inv.metadata?.cost_center || inv.metadata?.department || "Merchant Processing Fees";
        if (!discoveredCostCenters.some((c) => c.tag === ccTag)) {
          discoveredCostCenters.push({
            tag: ccTag,
            suggestedRole: "OPEX_GROWTH",
            dimensionSource: "stripe:invoices.metadata.cost_center",
          });
        }
      }
    } else if (typeof invoicesData?.monthlySpend === "number") {
      monthlySpend = invoicesData.monthlySpend;
    } else {
      monthlySpend = 0;
    }

    if (discoveredCostCenters.length === 0) {
      discoveredCostCenters.push(
        { tag: "Merchant Processing & Gateway Fees", suggestedRole: "OPEX_GROWTH", dimensionSource: "stripe:metadata.cost_center" },
        { tag: "Billing Subscriptions Infrastructure", suggestedRole: "TREASURY_RESERVE", dimensionSource: "stripe:metadata.department" }
      );
    }

    monthlySpend = Math.round(monthlySpend * 100) / 100;
    const forecastedSpend = Math.round(monthlySpend * 1.05 * 100) / 100;
    const dueDate = new Date(Date.now() + 10 * 86400 * 1000).toISOString().split("T")[0];
    const payoutAddress = await VendorMasterRepo.resolveVerifiedPayoutAddress("vendor_stripe");

    const invoices: VendorInvoiceItem[] = [
      {
        invoiceId: `INV-2026-STRIPE-${Date.now()}`,
        amountUsdc: monthlySpend,
        dueDate,
        payoutAddress,
        poNumber: "PO-2026-STRIPE-PAYMENTS",
        costCenterTag: discoveredCostCenters[0].tag,
      },
    ];

    return {
      vendorId: "vendor_stripe",
      vendorName: "Stripe, Inc.",
      monthlySpendUsdc: monthlySpend,
      forecastedMonthlySpendUsdc: forecastedSpend,
      billingCycleAnchorDay: 1,
      invoices,
      discoveredCostCenters,
      optimalPaymentRail: "ERC3009_AUTHORIZATION",
    };
  }
}
