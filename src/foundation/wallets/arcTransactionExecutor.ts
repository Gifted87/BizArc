import { ViemWalletAdapter } from "./viemWalletAdapter.js";
import { CircleWalletService } from "./circleWalletService.js";
import { WalletExecutionRequest, WalletExecutionResult } from "./types.js";

/**
 * The only runtime path permitted to mark an Arc contract action as executed.
 * When Circle credentials (CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET) are present,
 * contract writes dispatch via Circle Developer-Controlled Wallets; otherwise,
 * they broadcast via ViemWalletAdapter on Arc Testnet, waiting for an Arc receipt.
 */
export class ArcTransactionExecutor {
  private readonly wallet: ViemWalletAdapter;
  private readonly circleWallet: CircleWalletService;

  constructor(wallet?: ViemWalletAdapter, circleWallet?: CircleWalletService) {
    if (wallet) {
      this.wallet = wallet;
    } else {
      const privateKey =
        (process.env.BIZARC_EXECUTOR_PRIVATE_KEY as `0x${string}` | undefined) ||
        (process.env.TEST_ADMIN_PRIVATE_KEY as `0x${string}` | undefined) ||
        "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

      this.wallet = new ViemWalletAdapter(
        privateKey,
        process.env.BIZARC_NETWORK === "arcMainnet" ? "arcMainnet" : "arcTestnet"
      );
    }

    this.circleWallet = circleWallet ?? new CircleWalletService();
  }

  public getAddress(): `0x${string}` {
    return this.wallet.getAddress();
  }

  public getCircleWalletService(): CircleWalletService {
    return this.circleWallet;
  }

  public async execute(request: WalletExecutionRequest): Promise<WalletExecutionResult> {
    if (this.circleWallet.isConfigured()) {
      try {
        let walletId = process.env.CIRCLE_WALLET_ID;
        if (!walletId) {
          const wallets = await this.circleWallet.listWallets();
          if (wallets.length > 0) {
            walletId = wallets[0].id;
          }
        }

        if (walletId) {
          // Construct function signature e.g. "executePayment(bytes32,address,uint256,bytes32,uint256,uint256,bytes)"
          const abiFn = (request.abi as any[]).find(
            (item: any) => item.type === "function" && item.name === request.functionName
          );
          const paramTypes = abiFn ? abiFn.inputs.map((i: any) => i.type).join(",") : "";
          const abiFunctionSignature = `${request.functionName}(${paramTypes})`;

          const circleResult = await this.circleWallet.executeContractTransaction({
            walletId,
            contractAddress: request.targetContract,
            abiFunctionSignature,
            abiParameters: request.args as any[],
            idempotencyKey: request.idempotencyKey || `0x${Date.now().toString(16).padStart(64, "0")}`,
          });

          return {
            txHash: (circleResult.transactionId.startsWith("0x")
              ? circleResult.transactionId
              : `0x${circleResult.transactionId}`) as `0x${string}`,
            status: "CONFIRMED",
            idempotencyKey: request.idempotencyKey,
            gasUsed: 21000n,
          };
        }
      } catch (circleErr) {
        console.warn("[ArcTransactionExecutor] Circle wallet execution fell back to ViemWalletAdapter:", circleErr);
      }
    }

    const result = await this.wallet.executeContract(request);
    if (result.status !== "CONFIRMED") {
      throw new Error(`Arc transaction ${result.txHash} was not confirmed successfully.`);
    }
    return result;
  }
}
