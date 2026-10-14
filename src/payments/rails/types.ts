export type PaymentRailType =
  | "DISBURSAL_VAULT"
  | "MODULAR_SESSION_KEY"
  | "ERC3009_AUTHORIZATION"
  | "GATEWAY_X402"
  | "FIAT_PAYOUT"
  | "FIAT_OFFRAMP";

export type FiatSubMethodType =
  | "FEDWIRE"
  | "ACH"
  | "PUSH_TO_CARD"
  | "SEPA"
  | "SWIFT";

export interface UniversalDisbursalIntent {
  intentId: string;
  primaryAccountId: string;
  vendorId: string;
  vendorName: string;
  amountUsdc: number; // e.g. 50.000000
  payoutAddress?: string; // EVM address for Rails 1, 2, 3
  serviceUrl?: string; // HTTP 402 URL for Rail 4
  x402Payment?: string; // Signed payment credential produced by a real x402 wallet/facilitator
  x402Method?: "GET" | "POST";
  userOperation?: Record<string, string>; // Fully signed ERC-4337 operation for the configured account
  beneficiaryBank?: {
    accountHolderName: string;
    ibanOrAccountNumber: string;
    routingOrSwift: string;
    bankCountry: string;
    bankName?: string;
    paymentSubMethod?: FiatSubMethodType | string;
    cardToken?: string;
    cardLast4?: string;
    cardNetwork?: string;
  };
  declaredReason: string;
  invoiceId?: string;
  poReference?: string;
  category?: string;
  documentHash?: string;
  deliveryProofHash?: string;
  requireThreeWayMatch?: boolean;
  sessionKeyId?: string;
  sprsRequestId?: string;
}

export interface UniversalDisbursalExecutionResult {
  intentId: string;
  rail: PaymentRailType;
  subMethod?: string;
  success: boolean;
  status: "EXECUTED" | "AWAITING_SETTLEMENT" | "ESCALATE_TO_SPRS" | "REJECTED_BY_POLICY";
  totalAmountUsdc: number;
  allocations: Array<{
    accountId: string;
    amountUsdc: number;
    isPrimary: boolean;
  }>;
  txHash?: string;
  idempotencyKey?: string;
  sessionKeyId?: string;
  authorizationNonce?: string;
  gatewaySettlementRef?: string;
  fiatPayoutId?: string;
  cardPayoutRef?: string;
  imadOmadTrace?: string;
  estimatedArrivalTimestamp?: string;
  sprsRequestId?: string;
  journalSequenceId?: string;
  error?: string;
  executionTimestamp: string;
}
