import {
  createWalletClient,
  http,
  WalletClient,
  Account,
  Chain,
  PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ArcClientManager } from "../arc/client.js";
import { ARC_CONSTANTS } from "../arc/constants.js";
import { WalletExecutionRequest, WalletExecutionResult } from "./types.js";

export class ViemWalletAdapter {
  private walletClient: WalletClient;
  private account: Account;
  private publicClient: PublicClient;

  constructor(privateKey: `0x${string}`, network: "arcTestnet" | "arcMainnet" = "arcTestnet") {
    this.account = privateKeyToAccount(privateKey);
    const chain = ArcClientManager.getChain(network);
    const rpcUrl =
      network === "arcMainnet"
        ? ARC_CONSTANTS.MAINNET.rpcUrl
        : ARC_CONSTANTS.TESTNET.rpcUrl;

    this.walletClient = createWalletClient({
      account: this.account,
      chain,
      transport: http(rpcUrl),
    });

    this.publicClient = ArcClientManager.getPublicClient({ network, rpcUrl });
  }

  public getAddress(): `0x${string}` {
    return this.account.address;
  }

  /**
   * Executes a smart contract write on Arc, enforcing 20 Gwei gas floor.
   */
  public async executeContract(
    request: WalletExecutionRequest
  ): Promise<WalletExecutionResult> {
    const gasParameters = ArcClientManager.enforceGasFloor(
      request.maxGasFeeGwei ? request.maxGasFeeGwei * 10n ** 9n : undefined
    );

    const hash = await this.walletClient.writeContract({
      address: request.targetContract,
      abi: request.abi as any,
      functionName: request.functionName,
      args: request.args as any,
      chain: this.walletClient.chain,
      account: this.account,
      maxFeePerGas: gasParameters.maxFeePerGas,
      maxPriorityFeePerGas: gasParameters.maxPriorityFeePerGas,
    });

    // Wait for deterministic Arc sub-second receipt
    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash,
      timeout: 10000,
    });

    return {
      txHash: hash,
      status: receipt.status === "success" ? "CONFIRMED" : "FAILED",
      idempotencyKey: request.idempotencyKey,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed,
    };
  }

  /**
   * Signs EIP-712 typed data (for human gate admin authorizations).
   */
  public async signTypedData(params: {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<`0x${string}`> {
    const signature = await this.walletClient.signTypedData({
      account: this.account,
      domain: params.domain as any,
      types: params.types as any,
      primaryType: params.primaryType,
      message: params.message as any,
    });
    return signature;
  }
}
