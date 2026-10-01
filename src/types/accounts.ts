import { AccountRole } from "./policy.js";

export interface TripartiteBalance {
  liquidUsdc: bigint;              // 6 decimals
  investedYieldUsdc: bigint;       // 6 decimals
  totalEffectiveUsdc: bigint;      // 6 decimals (liquid + invested)
  lastOracleNavUpdate: string;
}

export type LiabilityCategory =
  | "SUBSCRIPTION"
  | "DEBT_SERVICE"
  | "PAYROLL"
  | "MILESTONE"
  | "INFRASTRUCTURE"
  | "CONTRACTOR";

export type LiabilityStatus =
  | "SCHEDULED"
  | "AWAITING_APPROVAL"
  | "DISBURSED"
  | "CANCELLED"
  | "FROZEN";

export interface AccountLiabilityRecord {
  liabilityId: string;
  accountId: string;
  vendorId: string;
  title: string;
  category: LiabilityCategory;
  amountUsdc: bigint;              // 6 decimals
  dueDate: string;                 // ISO-8601
  frequencyCron?: string;          // e.g., '0 0 1 * *'
  payoutAddress: `0x${string}`;
  sourcePoHash?: `0x${string}`;
  sourceInvoiceHash?: `0x${string}`;
  status: LiabilityStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CorporateAccountOverview {
  accountId: string;
  name: string;
  role: AccountRole;
  arcWalletAddress: `0x${string}`;
  chainId: number;
  balance: TripartiteBalance;
  minOperatingFloorUsdc: bigint;
  committedLiabilitiesWindowUsdc: bigint;
  unencumberedFreeCapitalUsdc: bigint;
  recurringLiabilities: AccountLiabilityRecord[];
}
