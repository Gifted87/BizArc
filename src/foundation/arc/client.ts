import {
  createPublicClient,
  http,
  webSocket,
  PublicClient,
  Chain,
  defineChain,
} from "viem";
import { arc, arcTestnet } from "viem/chains";
import { ARC_CONSTANTS } from "./constants.js";

export interface ArcClientConfig {
  network: "arcTestnet" | "arcMainnet";
  rpcUrl?: string;
  wsUrl?: string;
}

export class ArcClientManager {
  private static publicClient: PublicClient | null = null;
  private static currentNetwork: "arcTestnet" | "arcMainnet" = "arcTestnet";

  public static getChain(network: "arcTestnet" | "arcMainnet"): Chain {
    if (network === "arcMainnet") {
      return arc;
    }
    return arcTestnet;
  }

  public static getPublicClient(config?: Partial<ArcClientConfig>): PublicClient {
    const targetNetwork = config?.network ?? this.currentNetwork;

    if (this.publicClient && this.currentNetwork === targetNetwork && !config?.rpcUrl) {
      return this.publicClient;
    }

    const chain = this.getChain(targetNetwork);
    const rpcUrl =
      config?.rpcUrl ??
      (targetNetwork === "arcMainnet"
        ? ARC_CONSTANTS.MAINNET.rpcUrl
        : ARC_CONSTANTS.TESTNET.rpcUrl);

    this.publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl, {
        retryCount: 3,
        retryDelay: 1000,
        timeout: 15000,
      }),
    });

    this.currentNetwork = targetNetwork;
    return this.publicClient;
  }

  /**
   * Enforces Arc L1 20 Gwei gas floor on transaction fee parameters.
   * Arc nodes immediately reject any transaction where maxFeePerGas < 20 Gwei.
   */
  public static enforceGasFloor(suggestedMaxFeePerGas?: bigint): {
    maxFeePerGas: bigint;
    maxPriorityFeePerGas: bigint;
  } {
    const floor = ARC_CONSTANTS.MIN_GAS_FLOOR_WEI;
    const fee = suggestedMaxFeePerGas && suggestedMaxFeePerGas > floor
      ? suggestedMaxFeePerGas
      : floor;

    return {
      maxFeePerGas: fee,
      maxPriorityFeePerGas: fee,
    };
  }

  /**
   * Helper to verify RPC health and connectivity.
   */
  public static async verifyConnectivity(client?: PublicClient): Promise<{
    connected: boolean;
    chainId: number;
    blockNumber: bigint;
  }> {
    const pc = client ?? this.getPublicClient();
    const [chainId, blockNumber] = await Promise.all([
      pc.getChainId(),
      pc.getBlockNumber(),
    ]);

    return {
      connected: true,
      chainId,
      blockNumber,
    };
  }
}
