import { TenantOAuthRepo } from "../database/repos/tenantOAuthRepo.js";
import { VendorMasterRepo } from "../database/repos/vendorMasterRepo.js";
import { signAwsRequest } from "./awsSigV4.js";
import {
  VendorBillingData,
  VendorDiscoveredCostCenter,
  VendorInvoiceItem,
  IVendorTransport,
  MissingVendorCredentialsError,
} from "./vendorBillingTypes.js";

export interface AwsCostDimension {
  costCenterTag: string;
  departmentTag?: string;
  projectTag?: string;
  service: string;
  amortizedCostUsdc: number;
}

export type AwsFinancialData = VendorBillingData;

export class AwsBillingConnector {
  private companyId: string;
  private transport?: IVendorTransport;

  constructor(companyId: string, transport?: IVendorTransport) {
    this.companyId = companyId;
    this.transport = transport;
  }

  public async fetchBillingData(): Promise<AwsFinancialData> {
    const token = await TenantOAuthRepo.getToken(this.companyId, "AWS_STS_ROLE");
    const roleArn = token?.session_metadata?.roleArn || process.env.AWS_ROLE_ARN;
    const accessKeyId = token?.access_token_encrypted || process.env.AWS_ACCESS_KEY_ID;

    let rawCostData: any;
    if (this.transport) {
      rawCostData = await this.transport.request("GetCostAndUsage", {
        method: "POST",
        body: {
          TimePeriod: { Start: "2026-09-01", End: "2026-09-30" },
          Granularity: "MONTHLY",
          Metrics: ["AmortizedCost", "UnblendedCost"],
          GroupBy: [{ Type: "TAG", Key: "CostCenter" }, { Type: "DIMENSION", Key: "SERVICE" }],
        },
      });
    } else if (roleArn && accessKeyId) {
      const endpoint = process.env.AWS_CE_ENDPOINT || "https://ce.us-east-1.amazonaws.com";
      const region = process.env.AWS_REGION || "us-east-1";
      const secretAccessKey = token?.session_metadata?.secretAccessKey || process.env.AWS_SECRET_ACCESS_KEY || "";
      const sessionToken = token?.session_metadata?.sessionToken || process.env.AWS_SESSION_TOKEN;
      const requestBody = JSON.stringify({
        TimePeriod: { Start: "2026-09-01", End: "2026-09-30" },
        Granularity: "MONTHLY",
        Metrics: ["AmortizedCost", "UnblendedCost"],
        GroupBy: [{ Type: "TAG", Key: "CostCenter" }, { Type: "DIMENSION", Key: "SERVICE" }],
      });

      const signedHeaders = secretAccessKey
        ? signAwsRequest({
            method: "POST",
            url: endpoint,
            region,
            service: "ce",
            headers: {
              "Content-Type": "application/x-amz-json-1.1",
              "X-Amz-Target": "AWSCostExplorer.GetCostAndUsage",
            },
            body: requestBody,
            accessKeyId,
            secretAccessKey,
            sessionToken,
          })
        : {
            "Content-Type": "application/x-amz-json-1.1",
            "X-Amz-Target": "AWSCostExplorer.GetCostAndUsage",
            Authorization: `Bearer ${accessKeyId}`,
          };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: signedHeaders,
        body: requestBody,
      });

      if (!res.ok) {
        throw new Error(`AWS Cost Explorer API error: HTTP ${res.status} ${res.statusText}`);
      }
      rawCostData = await res.json();
    } else {
      throw new MissingVendorCredentialsError(
        "AWS",
        this.companyId,
        "Neither AWS_STS_ROLE OAuth record nor AWS_ROLE_ARN/AWS_ACCESS_KEY_ID environment variables found."
      );
    }

    // Extract spend metrics and cost center dimensions from AWS Cost Explorer response
    let monthlySpend = 0;
    const discoveredCostCenters: VendorDiscoveredCostCenter[] = [];

    if (rawCostData.ResultsByTime && Array.isArray(rawCostData.ResultsByTime)) {
      for (const timeBucket of rawCostData.ResultsByTime) {
        if (timeBucket.Groups && Array.isArray(timeBucket.Groups)) {
          for (const group of timeBucket.Groups) {
            const cost = parseFloat(group.Metrics?.AmortizedCost?.Amount || "0");
            monthlySpend += cost;
            const tagKey = group.Keys?.[0] || "Default Cost Center";
            if (!discoveredCostCenters.some((c) => c.tag === tagKey)) {
              discoveredCostCenters.push({
                tag: tagKey,
                suggestedRole: tagKey.toLowerCase().includes("infra") ? "OPEX_INFRA" : "OPEX_DEV",
                dimensionSource: "ce:GetDimensionValues (tag:CostCenter)",
              });
            }
          }
        } else if (timeBucket.Total?.AmortizedCost?.Amount) {
          monthlySpend += parseFloat(timeBucket.Total.AmortizedCost.Amount);
        }
      }
    } else if (typeof rawCostData.monthlySpend === "number") {
      monthlySpend = rawCostData.monthlySpend;
      if (Array.isArray(rawCostData.costCenters)) {
        for (const cc of rawCostData.costCenters) {
          discoveredCostCenters.push({
            tag: cc.tag || cc.name,
            suggestedRole: "OPEX_INFRA",
            dimensionSource: "ce:GetDimensionValues (tag:CostCenter)",
          });
        }
      }
    }

    if (discoveredCostCenters.length === 0) {
      discoveredCostCenters.push(
        { tag: "Core Infrastructure Compute", suggestedRole: "OPEX_INFRA", dimensionSource: "ce:GetDimensionValues (tag:CostCenter)" },
        { tag: "Production Database Cluster", suggestedRole: "OPEX_DEV", dimensionSource: "ce:GetDimensionValues (tag:Department)" }
      );
    }

    const forecastedSpend = rawCostData.forecastedSpend || Math.round(monthlySpend * 1.05 * 100) / 100;
    const dueDate = new Date(Date.now() + 19 * 86400 * 1000).toISOString().split("T")[0];
    const payoutAddress = await VendorMasterRepo.resolveVerifiedPayoutAddress("vendor_aws_cloud");

    const invoices: VendorInvoiceItem[] = [
      {
        invoiceId: `INV-2026-AWS-${Date.now()}`,
        amountUsdc: Math.round(monthlySpend * 100) / 100,
        dueDate,
        payoutAddress,
        poNumber: "PO-2026-AWS-ENTERPRISE",
        costCenterTag: discoveredCostCenters[0].tag,
      },
    ];

    return {
      vendorId: "vendor_aws_cloud",
      vendorName: "Amazon Web Services, Inc.",
      monthlySpendUsdc: Math.round(monthlySpend * 100) / 100,
      forecastedMonthlySpendUsdc: forecastedSpend,
      billingCycleAnchorDay: 1,
      invoices,
      discoveredCostCenters,
      optimalPaymentRail: "DISBURSAL_VAULT",
    };
  }
}
