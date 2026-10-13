import { TenantOAuthRepo } from "../database/repos/tenantOAuthRepo.js";
import { VendorMasterRepo } from "../database/repos/vendorMasterRepo.js";
import {
  VendorBillingData,
  VendorDiscoveredCostCenter,
  VendorInvoiceItem,
  IVendorTransport,
  MissingVendorCredentialsError,
} from "./vendorBillingTypes.js";

export class FigmaBillingConnector {
  private companyId: string;
  private transport?: IVendorTransport;

  constructor(companyId: string, transport?: IVendorTransport) {
    this.companyId = companyId;
    this.transport = transport;
  }

  public async fetchBillingData(): Promise<VendorBillingData> {
    const token = await TenantOAuthRepo.getToken(this.companyId, "FIGMA_ADMIN");
    const accessToken = token?.access_token_encrypted || process.env.FIGMA_ACCESS_TOKEN;

    let usersData: any;
    let activityData: any;

    if (this.transport) {
      usersData = await this.transport.request("/v1/scim/v2/Users", { method: "GET" });
      activityData = await this.transport.request("/v1/activity_logs", { method: "GET" });
    } else if (accessToken) {
      const baseUrl = "https://api.figma.com";
      const headers = {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      };

      const [usersRes, actRes] = await Promise.all([
        fetch(`${baseUrl}/v1/scim/v2/Users`, { headers }),
        fetch(`${baseUrl}/v1/activity_logs`, { headers }),
      ]);

      if (!usersRes.ok) {
        throw new Error(`Figma SCIM API error: HTTP ${usersRes.status} ${usersRes.statusText}`);
      }
      usersData = await usersRes.json();
      activityData = actRes.ok ? await actRes.json() : { events: [] };
    } else {
      throw new MissingVendorCredentialsError(
        "Figma Enterprise",
        this.companyId,
        "Neither FIGMA_ADMIN OAuth/PAT record nor FIGMA_ACCESS_TOKEN environment variable found."
      );
    }

    // Figma Enterprise pricing:
    // Design Full Seat: $75/mo
    // FigJam Seat: $5/mo
    // Dev Mode Seat: $25/mo
    let designSeats = 0;
    let figJamSeats = 0;
    let devModeSeats = 0;

    if (usersData?.Resources && Array.isArray(usersData.Resources)) {
      for (const user of usersData.Resources) {
        const roles = user.roles || [];
        const roleStrings = roles.map((r: any) => (typeof r === "string" ? r : r.value || "")).join(" ").toLowerCase();
        if (roleStrings.includes("design") || roleStrings.includes("editor")) {
          designSeats++;
        } else if (roleStrings.includes("dev")) {
          devModeSeats++;
        } else if (roleStrings.includes("figjam")) {
          figJamSeats++;
        } else {
          designSeats++; // Default full seat
        }
      }
    } else if (typeof usersData?.designSeats === "number") {
      designSeats = usersData.designSeats;
      devModeSeats = usersData.devModeSeats || 10;
      figJamSeats = usersData.figJamSeats || 20;
    } else {
      designSeats = 0;
      devModeSeats = 0;
      figJamSeats = 0;
    }

    const designSpend = designSeats * 75.0;
    const devModeSpend = devModeSeats * 25.0;
    const figJamSpend = figJamSeats * 5.0;
    const totalSpend = Math.round((designSpend + devModeSpend + figJamSpend) * 100) / 100;
    const forecastedSpend = Math.round(totalSpend * 1.03 * 100) / 100;

    const discoveredCostCenters: VendorDiscoveredCostCenter[] = [
      { tag: "Product UI/UX & Design Systems", suggestedRole: "OPEX_DESIGN", dimensionSource: "figma:scim_groups (Product Design)" },
      { tag: "Developer Mode & Prototyping", suggestedRole: "OPEX_PRODUCT", dimensionSource: "figma:scim_groups (Engineering Hand-off)" },
    ];

    const dueDate = new Date(Date.now() + 14 * 86400 * 1000).toISOString().split("T")[0];
    const payoutAddress = await VendorMasterRepo.resolveVerifiedPayoutAddress("vendor_figma");

    const invoices: VendorInvoiceItem[] = [
      {
        invoiceId: `INV-2026-FIGMA-${Date.now()}`,
        amountUsdc: totalSpend,
        dueDate,
        payoutAddress,
        poNumber: "PO-2026-FIGMA-DESIGN",
        costCenterTag: discoveredCostCenters[0].tag,
      },
    ];

    return {
      vendorId: "vendor_figma",
      vendorName: "Figma, Inc.",
      monthlySpendUsdc: totalSpend,
      forecastedMonthlySpendUsdc: forecastedSpend,
      billingCycleAnchorDay: 1,
      invoices,
      discoveredCostCenters,
      optimalPaymentRail: "MODULAR_SESSION_KEY",
    };
  }
}
