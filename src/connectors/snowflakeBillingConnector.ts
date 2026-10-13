import { TenantOAuthRepo } from "../database/repos/tenantOAuthRepo.js";
import { VendorMasterRepo } from "../database/repos/vendorMasterRepo.js";
import {
  VendorBillingData,
  VendorDiscoveredCostCenter,
  VendorInvoiceItem,
  IVendorTransport,
  MissingVendorCredentialsError,
} from "./vendorBillingTypes.js";

export class SnowflakeBillingConnector {
  private companyId: string;
  private transport?: IVendorTransport;

  constructor(companyId: string, transport?: IVendorTransport) {
    this.companyId = companyId;
    this.transport = transport;
  }

  public async fetchBillingData(): Promise<VendorBillingData> {
    const token = await TenantOAuthRepo.getToken(this.companyId, "SNOWFLAKE_JWT");
    const jwtToken = token?.access_token_encrypted || process.env.SNOWFLAKE_JWT_TOKEN;
    const accountIdentifier = token?.session_metadata?.accountIdentifier || process.env.SNOWFLAKE_ACCOUNT || "xy12345.us-east-1";

    let statementData: any;

    if (this.transport) {
      statementData = await this.transport.request("/api/v2/statements", {
        method: "POST",
        body: {
          statement: `SELECT START_TIME, WAREHOUSE_NAME, CREDITS_USED FROM SNOWFLAKE.ACCOUNT_USAGE.WAREHOUSE_METERING_HISTORY WHERE START_TIME >= DATEADD('day', -30, CURRENT_TIMESTAMP()) ORDER BY START_TIME DESC;`,
        },
      });
    } else if (jwtToken) {
      const baseUrl = `https://${accountIdentifier}.snowflakecomputing.com`;
      const res = await fetch(`${baseUrl}/api/v2/statements`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${jwtToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Snowflake-Authorization-Token-Type": "KEYPAIR_JWT",
        },
        body: JSON.stringify({
          statement: `SELECT START_TIME, WAREHOUSE_NAME, CREDITS_USED FROM SNOWFLAKE.ACCOUNT_USAGE.WAREHOUSE_METERING_HISTORY WHERE START_TIME >= DATEADD('day', -30, CURRENT_TIMESTAMP()) ORDER BY START_TIME DESC;`,
          timeout: 60,
        }),
      });

      if (!res.ok) {
        throw new Error(`Snowflake SQL API error: HTTP ${res.status} ${res.statusText}`);
      }
      statementData = await res.json();
    } else {
      throw new MissingVendorCredentialsError(
        "Snowflake",
        this.companyId,
        "Neither SNOWFLAKE_JWT record nor SNOWFLAKE_JWT_TOKEN environment variable found."
      );
    }

    let totalCredits = 0;
    const discoveredCostCenters: VendorDiscoveredCostCenter[] = [];

    if (statementData?.data && Array.isArray(statementData.data)) {
      for (const row of statementData.data) {
        const whName = row[1] || "COMPUTE_WH";
        const credits = parseFloat(row[2] || "0");
        totalCredits += credits;
        if (!discoveredCostCenters.some((c) => c.tag === whName)) {
          discoveredCostCenters.push({
            tag: `Warehouse: ${whName}`,
            suggestedRole: "OPEX_DEV",
            dimensionSource: "snowflake:WAREHOUSE_METERING_HISTORY",
          });
        }
      }
    } else if (typeof statementData?.monthlyCredits === "number") {
      totalCredits = statementData.monthlyCredits;
    } else {
      totalCredits = 0;
    }

    if (discoveredCostCenters.length === 0) {
      discoveredCostCenters.push(
        { tag: "Enterprise Analytics Warehouse", suggestedRole: "OPEX_DEV", dimensionSource: "snowflake:WAREHOUSE_NAME" },
        { tag: "ETL & Pipeline Compute", suggestedRole: "OPEX_INFRA", dimensionSource: "snowflake:WAREHOUSE_NAME" }
      );
    }

    // Standard Snowflake Enterprise credit rate: $3.00/credit
    const monthlySpend = Math.round(totalCredits * 3.0 * 100) / 100;
    const forecastedSpend = Math.round(monthlySpend * 1.05 * 100) / 100;
    const dueDate = new Date(Date.now() + 30 * 86400 * 1000).toISOString().split("T")[0];
    const payoutAddress = await VendorMasterRepo.resolveVerifiedPayoutAddress("vendor_snowflake");

    const invoices: VendorInvoiceItem[] = [
      {
        invoiceId: `INV-2026-SNOW-${Date.now()}`,
        amountUsdc: monthlySpend,
        dueDate,
        payoutAddress,
        poNumber: "PO-2026-SNOWFLAKE-DATA",
        costCenterTag: discoveredCostCenters[0].tag,
      },
    ];

    return {
      vendorId: "vendor_snowflake",
      vendorName: "Snowflake Inc.",
      monthlySpendUsdc: monthlySpend,
      forecastedMonthlySpendUsdc: forecastedSpend,
      billingCycleAnchorDay: 1,
      invoices,
      discoveredCostCenters,
      optimalPaymentRail: "DISBURSAL_VAULT",
    };
  }
}
