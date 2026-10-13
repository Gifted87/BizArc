import type { PaymentRailType } from "../payments/rails/types.js";

export class MissingVendorCredentialsError extends Error {
  public readonly vendorName: string;
  public readonly companyId: string;

  constructor(vendorName: string, companyId: string, details?: string) {
    super(
      `[Rule 5 Loud Failure] Missing credentials for vendor '${vendorName}' (tenant: '${companyId}'). ${
        details || "OAuth token, API key, or Service Account credentials must be configured."
      }`
    );
    this.name = "MissingVendorCredentialsError";
    this.vendorName = vendorName;
    this.companyId = companyId;
  }
}

export type SuggestedAccountRole =
  | "OPEX_DEV"
  | "OPEX_INFRA"
  | "OPEX_GROWTH"
  | "OPEX_SUPPORT"
  | "OPEX_DESIGN"
  | "OPEX_PRODUCT"
  | "OPEX_AI"
  | "TREASURY_RESERVE";

export type { PaymentRailType } from "../payments/rails/types.js";

export interface VendorDiscoveredCostCenter {
  tag: string;
  suggestedRole: SuggestedAccountRole;
  dimensionSource: string;
}

export interface VendorInvoiceItem {
  invoiceId: string;
  amountUsdc: number;
  dueDate: string;
  payoutAddress: string;
  poNumber: string;
  costCenterTag: string;
}

export interface VendorBillingData {
  vendorId: string;
  vendorName: string;
  monthlySpendUsdc: number;
  forecastedMonthlySpendUsdc: number;
  billingCycleAnchorDay: number;
  invoices: VendorInvoiceItem[];
  discoveredCostCenters: VendorDiscoveredCostCenter[];
  optimalPaymentRail: PaymentRailType;
}

export interface IVendorTransport {
  request(endpoint: string, options: {
    method?: string;
    headers?: Record<string, string>;
    body?: any;
    params?: Record<string, any>;
  }): Promise<any>;
}
