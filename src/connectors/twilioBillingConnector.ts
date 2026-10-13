import { TenantOAuthRepo } from "../database/repos/tenantOAuthRepo.js";
import { VendorMasterRepo } from "../database/repos/vendorMasterRepo.js";
import {
  VendorBillingData,
  VendorDiscoveredCostCenter,
  VendorInvoiceItem,
  IVendorTransport,
  MissingVendorCredentialsError,
} from "./vendorBillingTypes.js";

export class TwilioBillingConnector {
  private companyId: string;
  private transport?: IVendorTransport;

  constructor(companyId: string, transport?: IVendorTransport) {
    this.companyId = companyId;
    this.transport = transport;
  }

  public async fetchBillingData(): Promise<VendorBillingData> {
    const token = await TenantOAuthRepo.getToken(this.companyId, "TWILIO_AUTH");
    const accountSid = token?.session_metadata?.accountSid || process.env.TWILIO_ACCOUNT_SID;
    const authToken = token?.access_token_encrypted || process.env.TWILIO_AUTH_TOKEN;

    let usageData: any;
    let triggersData: any;

    if (this.transport) {
      usageData = await this.transport.request(`/2010-04-01/Accounts/${accountSid}/Usage/Records/ThisMonth.json`, { method: "GET" });
      triggersData = await this.transport.request(`/2010-04-01/Accounts/${accountSid}/Usage/Triggers.json`, { method: "GET" });
    } else if (accountSid && authToken) {
      const baseUrl = "https://api.twilio.com";
      const authHeader = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;

      const [usageRes, trigRes] = await Promise.all([
        fetch(`${baseUrl}/2010-04-01/Accounts/${accountSid}/Usage/Records/ThisMonth.json`, {
          headers: { Authorization: authHeader },
        }),
        fetch(`${baseUrl}/2010-04-01/Accounts/${accountSid}/Usage/Triggers.json`, {
          headers: { Authorization: authHeader },
        }),
      ]);

      if (!usageRes.ok) {
        throw new Error(`Twilio Usage Records API error: HTTP ${usageRes.status} ${usageRes.statusText}`);
      }
      usageData = await usageRes.json();
      triggersData = trigRes.ok ? await trigRes.json() : { usage_triggers: [] };
    } else {
      throw new MissingVendorCredentialsError(
        "Twilio",
        this.companyId,
        "Neither TWILIO_AUTH record nor TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN environment variables found."
      );
    }

    let monthlySpend = 0;
    const discoveredCostCenters: VendorDiscoveredCostCenter[] = [];

    if (usageData?.usage_records && Array.isArray(usageData.usage_records)) {
      for (const rec of usageData.usage_records) {
        if (rec.category === "totalprice" || rec.category === "all") {
          monthlySpend += parseFloat(rec.price || "0");
        } else if (parseFloat(rec.price || "0") > 0) {
          const catName = rec.description || rec.category;
          if (!discoveredCostCenters.some((c) => c.tag === catName)) {
            discoveredCostCenters.push({
              tag: `Twilio: ${catName}`,
              suggestedRole: "OPEX_GROWTH",
              dimensionSource: "twilio:usage_record.category",
            });
          }
        }
      }
    } else if (typeof usageData?.monthlySpend === "number") {
      monthlySpend = usageData.monthlySpend;
    } else {
      monthlySpend = 0;
    }

    if (discoveredCostCenters.length === 0) {
      discoveredCostCenters.push(
        { tag: "Customer OTP & SMS Verification", suggestedRole: "OPEX_GROWTH", dimensionSource: "twilio:sms_outbound" },
        { tag: "Voice & Support Routing", suggestedRole: "OPEX_SUPPORT", dimensionSource: "twilio:voice_minutes" }
      );
    }

    monthlySpend = Math.round(monthlySpend * 100) / 100;
    const forecastedSpend = Math.round(monthlySpend * 1.08 * 100) / 100;
    const dueDate = new Date(Date.now() + 15 * 86400 * 1000).toISOString().split("T")[0];
    const payoutAddress = await VendorMasterRepo.resolveVerifiedPayoutAddress("vendor_twilio");

    const invoices: VendorInvoiceItem[] = [
      {
        invoiceId: `INV-2026-TW-${Date.now()}`,
        amountUsdc: monthlySpend,
        dueDate,
        payoutAddress,
        poNumber: "PO-2026-TWILIO-COMMUNICATIONS",
        costCenterTag: discoveredCostCenters[0].tag,
      },
    ];

    return {
      vendorId: "vendor_twilio",
      vendorName: "Twilio, Inc.",
      monthlySpendUsdc: monthlySpend,
      forecastedMonthlySpendUsdc: forecastedSpend,
      billingCycleAnchorDay: 1,
      invoices,
      discoveredCostCenters,
      optimalPaymentRail: "MODULAR_SESSION_KEY",
    };
  }
}
