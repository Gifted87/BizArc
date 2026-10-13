import {
  PublicClient,
  encodeFunctionData,
  keccak256,
  encodePacked,
  stringToHex,
  pad,
} from "viem";
import { DisbursalVaultABI } from "./artifacts.js";
import { ArcClientManager } from "../foundation/arc/client.js";

export interface DisbursalApprovalMessage {
  permissionRequestId: `0x${string}`;
  vendor: `0x${string}`;
  amount: bigint;
  idempotencyKey: `0x${string}`;
  nonce: bigint;
  deadline: bigint;
}

export class DisbursalVaultService {
  private vaultAddress: `0x${string}`;
  private publicClient: PublicClient;
  private chainId: number;

  constructor(vaultAddress: `0x${string}`, chainId = 5042002, client?: PublicClient) {
    this.vaultAddress = vaultAddress;
    this.chainId = chainId;
    this.publicClient = client ?? ArcClientManager.getPublicClient();
  }

  public getAddress(): `0x${string}` {
    return this.vaultAddress;
  }

  public static formatRequestId(requestId: string): `0x${string}` {
    const hex = stringToHex(requestId);
    return pad(hex, { size: 32, dir: "right" });
  }

  /**
   * Generates deterministic idempotency key for vendor payment:
   * idempotencyKey = keccak256(abi.encodePacked(vendor, invoiceId, amount))
   */
  public static generateIdempotencyKey(
    vendor: `0x${string}`,
    invoiceId: string,
    amount: bigint
  ): `0x${string}` {
    return keccak256(
      encodePacked(
        ["address", "string", "uint256"],
        [vendor, invoiceId, amount]
      )
    );
  }

  /**
   * Returns EIP-712 typed data structure required for admin signature verification
   */
  public getEIP712TypedData(message: DisbursalApprovalMessage) {
    const domain = {
      name: "DisbursalVault",
      version: "1",
      chainId: BigInt(this.chainId),
      verifyingContract: this.vaultAddress,
    };

    const types = {
      DisbursalApproval: [
        { name: "permissionRequestId", type: "bytes32" },
        { name: "vendor", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "idempotencyKey", type: "bytes32" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };

    return {
      domain,
      types,
      primaryType: "DisbursalApproval" as const,
      message,
    };
  }

  public async isVendorApproved(vendor: `0x${string}`): Promise<boolean> {
    const approved = await this.publicClient.readContract({
      address: this.vaultAddress,
      abi: DisbursalVaultABI,
      functionName: "approvedVendors",
      args: [vendor],
    });
    return Boolean(approved);
  }

  public async isIdempotencyKeyExecuted(key: `0x${string}`): Promise<boolean> {
    try {
      const executed = await this.publicClient.readContract({
        address: this.vaultAddress,
        abi: DisbursalVaultABI,
        functionName: "executedIdempotencyKeys",
        args: [key],
      });
      return Boolean(executed);
    } catch {
      return false;
    }
  }

  public async getCaps(): Promise<{
    perTxCap: bigint;
    dailyCap: bigint;
    eip712Threshold: bigint;
    dailySpent: bigint;
  }> {
    const [perTxCap, dailyCap, eip712Threshold, dailySpent] = await Promise.all([
      this.publicClient.readContract({
        address: this.vaultAddress,
        abi: DisbursalVaultABI,
        functionName: "perTxCap",
      }),
      this.publicClient.readContract({
        address: this.vaultAddress,
        abi: DisbursalVaultABI,
        functionName: "dailyCap",
      }),
      this.publicClient.readContract({
        address: this.vaultAddress,
        abi: DisbursalVaultABI,
        functionName: "eip712ApprovalThreshold",
      }),
      this.publicClient.readContract({
        address: this.vaultAddress,
        abi: DisbursalVaultABI,
        functionName: "dailySpent",
      }),
    ]);

    return { perTxCap, dailyCap, eip712Threshold, dailySpent };
  }

  public encodeExecutePayment(params: {
    permissionRequestId: `0x${string}`;
    vendor: `0x${string}`;
    amount: bigint;
    idempotencyKey: `0x${string}`;
    nonce: bigint;
    deadline: bigint;
    adminSignature: `0x${string}`;
  }): `0x${string}` {
    return encodeFunctionData({
      abi: DisbursalVaultABI,
      functionName: "executePayment",
      args: [
        params.permissionRequestId,
        params.vendor,
        params.amount,
        params.idempotencyKey,
        params.nonce,
        params.deadline,
        params.adminSignature,
      ],
    });
  }

  public encodeSetVendorApproval(vendor: `0x${string}`, approved: boolean): `0x${string}` {
    return encodeFunctionData({
      abi: DisbursalVaultABI,
      functionName: "setVendorApproval",
      args: [vendor, approved],
    });
  }
}
