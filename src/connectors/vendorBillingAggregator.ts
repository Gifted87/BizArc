import { TenantOAuthRepo } from "../database/repos/tenantOAuthRepo.js";
import { AwsBillingConnector } from "./awsBillingConnector.js";
import { GithubBillingConnector } from "./githubBillingConnector.js";
import { DatadogBillingConnector } from "./datadogBillingConnector.js";
import { GoogleCloudBillingConnector } from "./googleCloudBillingConnector.js";
import { AzureBillingConnector } from "./azureBillingConnector.js";
import { OpenAiBillingConnector } from "./openAiBillingConnector.js";
import { StripeBillingConnector } from "./stripeBillingConnector.js";
import { SnowflakeBillingConnector } from "./snowflakeBillingConnector.js";
import { TwilioBillingConnector } from "./twilioBillingConnector.js";
import { FigmaBillingConnector } from "./figmaBillingConnector.js";
import {
  VendorBillingData,
  VendorDiscoveredCostCenter,
  VendorInvoiceItem,
  IVendorTransport,
  MissingVendorCredentialsError,
} from "./vendorBillingTypes.js";

export interface Top10VendorAggregatedData {
  companyId: string;
  totalMonthlySpendUsdc: number;
  totalForecastedMonthlySpendUsdc: number;
  vendors: VendorBillingData[];
  aggregatedInvoices: VendorInvoiceItem[];
  aggregatedCostCenters: VendorDiscoveredCostCenter[];
  railDistribution: Record<string, number>;
}

export class VendorBillingAggregator {
  private companyId: string;
  private transports: Partial<Record<string, IVendorTransport>>;

  constructor(companyId: string, transports?: Partial<Record<string, IVendorTransport>>) {
    this.companyId = companyId;
    this.transports = transports || {};
  }

  /**
   * Aggregates billing and cost-center data across all 10 enterprise vendors.
   * If a vendor has credentials configured (or a test transport injected), its data is fetched.
   */
  public async aggregateAllVendors(): Promise<Top10VendorAggregatedData> {
    const connectors = [
      { id: "AWS", connector: new AwsBillingConnector(this.companyId, this.transports["AWS"]) },
      { id: "GITHUB", connector: new GithubBillingConnector(this.companyId, this.transports["GITHUB"]) },
      { id: "DATADOG", connector: new DatadogBillingConnector(this.companyId, this.transports["DATADOG"]) },
      { id: "GCP", connector: new GoogleCloudBillingConnector(this.companyId, this.transports["GCP"]) },
      { id: "AZURE", connector: new AzureBillingConnector(this.companyId, this.transports["AZURE"]) },
      { id: "OPENAI", connector: new OpenAiBillingConnector(this.companyId, this.transports["OPENAI"]) },
      { id: "STRIPE", connector: new StripeBillingConnector(this.companyId, this.transports["STRIPE"]) },
      { id: "SNOWFLAKE", connector: new SnowflakeBillingConnector(this.companyId, this.transports["SNOWFLAKE"]) },
      { id: "TWILIO", connector: new TwilioBillingConnector(this.companyId, this.transports["TWILIO"]) },
      { id: "FIGMA", connector: new FigmaBillingConnector(this.companyId, this.transports["FIGMA"]) },
    ];

    const results: VendorBillingData[] = [];
    const aggregatedInvoices: VendorInvoiceItem[] = [];
    const costCenterMap = new Map<string, VendorDiscoveredCostCenter>();
    const railDistribution: Record<string, number> = {};

    for (const item of connectors) {
      try {
        const data = await item.connector.fetchBillingData();
        results.push(data);
        aggregatedInvoices.push(...data.invoices);

        for (const cc of data.discoveredCostCenters) {
          if (!costCenterMap.has(cc.tag)) {
            costCenterMap.set(cc.tag, cc);
          }
        }

        railDistribution[data.optimalPaymentRail] = (railDistribution[data.optimalPaymentRail] || 0) + 1;
      } catch (err: any) {
        if (err instanceof MissingVendorCredentialsError) {
          // Vendor not linked for this tenant - skip without polluting with dummy stubs
          continue;
        }
        // If credentials exist but wire failure occurs, throw loudly per Rule 5!
        throw err;
      }
    }

    const totalMonthlySpendUsdc = Math.round(
      results.reduce((sum, v) => sum + v.monthlySpendUsdc, 0) * 100
    ) / 100;
    const totalForecastedMonthlySpendUsdc = Math.round(
      results.reduce((sum, v) => sum + v.forecastedMonthlySpendUsdc, 0) * 100
    ) / 100;

    return {
      companyId: this.companyId,
      totalMonthlySpendUsdc,
      totalForecastedMonthlySpendUsdc,
      vendors: results,
      aggregatedInvoices,
      aggregatedCostCenters: Array.from(costCenterMap.values()),
      railDistribution,
    };
  }
}
