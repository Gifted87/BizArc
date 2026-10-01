import { PublicClient, getContract, parseUnits, formatUnits, TransactionReceipt, decodeEventLog } from "viem";
import { ARC_CONSTANTS } from "../arc/constants.js";
import { ArcClientManager } from "../arc/client.js";
import { USDC_ABI } from "./usdcAbi.js";

export class LoudRoundingError extends Error {
  constructor(message: string) {
    super(`[LoudRoundingError - Rule 5 Refuse Silent Rounding] ${message}`);
    this.name = "LoudRoundingError";
  }
}

export class ArcAssetDualityViolationError extends Error {
  constructor(message: string) {
    super(`[ArcAssetDualityViolation] ${message}`);
    this.name = "ArcAssetDualityViolationError";
  }
}

export class UsdcService {
  private client: PublicClient;
  private usdcAddress: `0x${string}`;

  constructor(client?: PublicClient, usdcAddress?: `0x${string}`) {
    this.client = client ?? ArcClientManager.getPublicClient();
    this.usdcAddress = usdcAddress ?? ARC_CONSTANTS.USDC_PREDEPLOY;
  }

  /**
   * Converts a decimal string to 6-decimal integer units.
   * Rule 5 (Agents and Ledgers): Refuses silent rounding if decimal precision exceeds 6 places.
   */
  public static parseUsdc(amountStr: string): bigint {
    const trimmed = amountStr.trim();
    if (!/^\d+(\.\d+)?$/.test(trimmed)) {
      throw new Error(`Invalid USDC amount format: '${amountStr}'`);
    }

    const parts = trimmed.split(".");
    if (parts.length === 2 && parts[1].length > ARC_CONSTANTS.USDC_DECIMALS) {
      throw new LoudRoundingError(
        `Precision overflow: Amount '${amountStr}' has ${parts[1].length} decimal places. USDC permits exactly 6 decimals. Silent rounding is forbidden.`
      );
    }

    return parseUnits(trimmed, ARC_CONSTANTS.USDC_DECIMALS);
  }

  /**
   * Formats 6-decimal integer units to a standard decimal string (e.g. "100.500000").
   */
  public static formatUsdc(amountUnits: bigint): string {
    return formatUnits(amountUnits, ARC_CONSTANTS.USDC_DECIMALS);
  }

  /**
   * Guards against attempting to treat native gas and ERC-20 USDC as different assets.
   */
  public static validateNotDuplicateAsset(tokenA: string, tokenB: string): void {
    const isArcUsdc = (addr: string) =>
      addr.toLowerCase() === ARC_CONSTANTS.USDC_PREDEPLOY.toLowerCase() ||
      addr.toLowerCase() === "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee" ||
      addr.toLowerCase() === "native";

    if (isArcUsdc(tokenA) && isArcUsdc(tokenB)) {
      throw new ArcAssetDualityViolationError(
        "Cannot convert or swap between native USDC and ERC-20 USDC on Arc. They represent the same pool of funds."
      );
    }
  }

  /**
   * Queries real-time 6-decimal USDC ERC-20 balance.
   */
  public async getBalance(walletAddress: `0x${string}`): Promise<bigint> {
    const balance = await this.client.readContract({
      address: this.usdcAddress,
      abi: USDC_ABI,
      functionName: "balanceOf",
      args: [walletAddress],
    });
    return balance;
  }

  /**
   * Queries real-time allowance granted to spender.
   */
  public async getAllowance(
    owner: `0x${string}`,
    spender: `0x${string}`
  ): Promise<bigint> {
    const allowance = await this.client.readContract({
      address: this.usdcAddress,
      abi: USDC_ABI,
      functionName: "allowance",
      args: [owner, spender],
    });
    return allowance;
  }

  /**
   * Extracts and validates on-chain Transfer events from a transaction receipt.
   */
  public verifyTransferFromReceipt(
    receipt: TransactionReceipt,
    expected?: {
      from?: `0x${string}`;
      to?: `0x${string}`;
      amount?: bigint;
    }
  ): {
    matched: boolean;
    transfers: Array<{ from: `0x${string}`; to: `0x${string}`; value: bigint }>;
  } {
    const transfers: Array<{ from: `0x${string}`; to: `0x${string}`; value: bigint }> = [];

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() === this.usdcAddress.toLowerCase()) {
        try {
          const decoded = decodeEventLog({
            abi: USDC_ABI,
            data: log.data,
            topics: log.topics,
          });

          if (decoded.eventName === "Transfer") {
            const { from, to, value } = decoded.args as {
              from: `0x${string}`;
              to: `0x${string}`;
              value: bigint;
            };
            transfers.push({ from, to, value });
          }
        } catch {
          // Log was not an ERC-20 event or different signature
        }
      }
    }

    if (!expected) {
      return { matched: transfers.length > 0, transfers };
    }

    const matched = transfers.some(t => {
      const matchFrom = !expected.from || t.from.toLowerCase() === expected.from.toLowerCase();
      const matchTo = !expected.to || t.to.toLowerCase() === expected.to.toLowerCase();
      const matchAmount = expected.amount === undefined || t.value === expected.amount;
      return matchFrom && matchTo && matchAmount;
    });

    return { matched, transfers };
  }
}
