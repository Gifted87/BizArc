export type SPRActionType =
  | "DISBURSEMENT_PAYMENT"
  | "MULTI_HOP_SUBSCRIPTION_SETTLEMENT"
  | "CROSS_ACCOUNT_REBALANCE"
  | "UNREGISTERED_VENDOR_ADDITION"
  | "HIGH_VALUE_SWEEP_EXEMPTION";

export type SPRStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED_WITH_INSTRUCTIONS"
  | "EXECUTED";

export interface AffectedAccountSummary {
  accountId: string;
  role: string;
  chain: string;
  address: `0x${string}`;
  currentLiquidBalance: string;
  currentInvestedUsyc: string;
  totalEffectiveBalance: string;
  committedLiabilities30d: string;
  unencumberedBalance: string;
  usycRecallAmount: string;
  postTxLiquidBalance: string;
  postTxInvestedUsyc: string;
}

export interface TargetRecipientDetails {
  vendorId: string;
  vendorName: string;
  payoutAddress: `0x${string}`;
  isInVerifiedMaster: boolean;
  payeeAddressMatchesHistory: boolean;
}

export interface AssociatedDocumentRecords {
  purchaseOrderId?: string;
  purchaseOrderHash?: `0x${string}`;
  goodsReceiptId?: string;
  goodsReceiptHash?: `0x${string}`;
  invoiceDocumentId?: string;
  invoiceDocumentHash?: `0x${string}`;
  idempotencyKey: `0x${string}`;
}

export interface SPROption {
  action: "APPROVE" | "CANCEL_WITH_INSTRUCTIONS";
  label: string;
  requiresText?: boolean;
}

export interface StandardizedPermissionRequest {
  requestId: string;
  timestamp: string;
  action: SPRActionType;
  reason: string;
  amountUsdc: string;
  affectedAccounts: AffectedAccountSummary[];
  targetRecipient?: TargetRecipientDetails;
  associatedRecords: AssociatedDocumentRecords;
  options: SPROption[];
  status: SPRStatus;
  adminInstructions?: string;
  decidedAt?: string;
}
