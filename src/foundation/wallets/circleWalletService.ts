import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import { WalletExecutionRequest, WalletExecutionResult } from "./types.js";

export interface CircleWalletConfig {
  apiKey?: string;
  entitySecret?: string;
  walletSetId?: string;
}

export class CircleWalletService {
  private client: ReturnType<typeof initiateDeveloperControlledWalletsClient> | null = null;
  private walletSetId?: string;

  constructor(config?: CircleWalletConfig) {
    const apiKey = config?.apiKey ?? process.env.CIRCLE_API_KEY;
    const entitySecret = config?.entitySecret ?? process.env.CIRCLE_ENTITY_SECRET;
    this.walletSetId = config?.walletSetId ?? process.env.CIRCLE_WALLET_SET_ID;

    if (apiKey && entitySecret) {
      try {
        this.client = initiateDeveloperControlledWalletsClient({
          apiKey,
          entitySecret,
        });
      } catch (err) {
        console.warn("[CircleWalletService] Could not initialize Circle SDK client:", err);
      }
    }
  }

  public isConfigured(): boolean {
    return this.client !== null;
  }

  /**
   * Retrieves or queries developer controlled wallets from Circle.
   */
  public async listWallets(params?: { address?: string }) {
    if (!this.client) {
      throw new Error("Circle SDK client is not configured with CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET.");
    }
    const response = await this.client.listWallets({
      walletSetId: this.walletSetId,
      address: params?.address,
    });
    return response.data?.wallets ?? [];
  }

  /**
   * Triggers a contract execution transaction via Circle Developer Controlled Wallets.
   */
  public async executeContractTransaction(params: {
    walletId: string;
    contractAddress: string;
    abiFunctionSignature: string;
    abiParameters: unknown[];
    idempotencyKey: string;
    feeLevel?: "LOW" | "MEDIUM" | "HIGH";
  }): Promise<{ transactionId: string; state: string }> {
    if (!this.client) {
      throw new Error("Circle SDK client is not configured.");
    }

    const response = await this.client.createContractExecutionTransaction({
      walletId: params.walletId,
      contractAddress: params.contractAddress,
      abiFunctionSignature: params.abiFunctionSignature,
      abiParameters: params.abiParameters,
      idempotencyKey: params.idempotencyKey,
      fee: {
        type: "level",
        config: {
          feeLevel: params.feeLevel ?? "MEDIUM",
        },
      },
    });

    const tx = response.data;
    return {
      transactionId: tx?.id ?? "",
      state: tx?.state ?? "INITIATED",
    };
  }
}
