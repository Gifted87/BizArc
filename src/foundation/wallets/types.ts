export type WalletMode = "CIRCLE_DEV_CONTROLLED" | "VIEM_SIGNER";

export interface WalletExecutionRequest {
  targetContract: `0x${string}`;
  abi: readonly unknown[];
  functionName: string;
  args: readonly unknown[];
  idempotencyKey: string;
  accountWalletAddress?: `0x${string}`;
  maxGasFeeGwei?: bigint;
}

export interface WalletExecutionResult {
  txHash: `0x${string}`;
  status: "CONFIRMED" | "SUBMITTED" | "FAILED";
  idempotencyKey: string;
  blockNumber?: bigint;
  gasUsed?: bigint;
}
