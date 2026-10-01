export type LiabilityFrequency = "ONE_OFF" | "MONTHLY" | "QUARTERLY" | "ANNUAL";

export type LiabilityStatus =
  | "SCHEDULED"
  | "AWAITING_APPROVAL"
  | "DISBURSED"
  | "CANCELLED"
  | "FROZEN"
  | "DISPUTED";

export interface DynamicLiabilityRecord {
  liabilityId: string;
  accountId: string;
  vendorId: string;
  vendorTitle: string;
  payoutAddress: string;
  amountUsdc: string; // Exact 6-decimal string (e.g. "12500.000000")
  rawAmount: bigint;  // 6-decimal integer (e.g. 12500000000n)
  dueDate: Date;
  frequency: LiabilityFrequency;
  documentHash: string; // SHA-256 of invoice/contract
  poReference?: string;
  status: LiabilityStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface ParallelTripartiteBalance {
  liquidCashUsdc: string;
  investedYieldUsdc: string;
  availableBalanceUsdc: string;
  liquidCashRaw: bigint;
  investedYieldRaw: bigint;
  availableBalanceRaw: bigint;
  invariantSatisfied: boolean;
}

export interface DynamicSafeToInvestRecord {
  recordId?: number;
  accountId: string;
  tripartiteBalance: ParallelTripartiteBalance;
  targetReserveUsdc: string;
  targetReserveRaw: bigint;
  upcomingLiabilitiesTotalUsdc: string;
  upcomingLiabilitiesTotalRaw: bigint;
  safeToInvestUsdc: string;
  safeToInvestRaw: bigint;
  timeHorizonSeconds: number;
  recallSpeedSeconds: number;
  status: "ACTIVE" | "RECALL_REQUIRED" | "SWEEP_RECOMMENDED" | "BALANCED";
  createdAt: Date;
}
