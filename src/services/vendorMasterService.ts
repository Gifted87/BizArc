import { PublicClient, keccak256, encodePacked, WalletClient } from "viem";
import { VendorMasterRepo, VendorMasterRecord } from "../database/repos/vendorMasterRepo.js";
import { PermissionRequestRepo, PermissionRequestRecord } from "../database/repos/permissionRequestRepo.js";
import { DisbursalVaultService, DisbursalApprovalMessage } from "../contracts/disbursalVaultService.js";
import { DisbursalVaultABI } from "../contracts/artifacts.js";
import { ViemWalletAdapter } from "../foundation/wallets/viemWalletAdapter.js";
import { PolicyLoader } from "../config/policyLoader.js";
import { ArcClientManager } from "../foundation/arc/client.js";

export interface ThreeWayMatchParams {
  vendorId: string;
  invoiceId: string;
  poHash: `0x${string}`;
  invoiceHash: `0x${string}`;
  poAmountUsdc: bigint;        // Exact 6-decimal units
  invoiceAmountUsdc: bigint;   // Exact 6-decimal units
  payoutAddress: `0x${string}`;
  deliveryVerified: boolean;
  notes?: string;
}

export interface ThreeWayMatchResult {
  passed: boolean;
  idempotencyKey?: `0x${string}`;
  rejectionReason?: string;
  vendorRecord?: VendorMasterRecord;
  requiresHumanGate: boolean;
}

export interface InitialVendorSeed {
  vendor_id: string;
  name: string;
  verified_payout_address: `0x${string}`;
  verified_by_admin: string;
  default_category: string;
}

export const DEFAULT_PRODUCTION_VENDORS: InitialVendorSeed[] = [
  {
    vendor_id: "vnd_aws_cloud",
    name: "Amazon Web Services Inc.",
    verified_payout_address: "0xaaaa111111111111111111111111111111111101",
    verified_by_admin: "admin_sec_ops",
    default_category: "INFRASTRUCTURE",
  },
  {
    vendor_id: "vendor_aws_cloud",
    name: "Amazon Web Services, Inc.",
    verified_payout_address: "0xaaaa111111111111111111111111111111111101",
    verified_by_admin: "admin_sec_ops",
    default_category: "INFRASTRUCTURE",
  },
  {
    vendor_id: "vnd_anthropic_ai",
    name: "Anthropic PBC",
    verified_payout_address: "0xbbbb222222222222222222222222222222222202",
    verified_by_admin: "admin_sec_ops",
    default_category: "DEVELOPER_TOOLS",
  },
  {
    vendor_id: "vnd_github_enterprise",
    name: "GitHub, Inc.",
    verified_payout_address: "0xcccc333333333333333333333333333333333303",
    verified_by_admin: "admin_sec_ops",
    default_category: "DEVELOPER_TOOLS",
  },
  {
    vendor_id: "vendor_github_enterprise",
    name: "GitHub, Inc.",
    verified_payout_address: "0xcccc333333333333333333333333333333333303",
    verified_by_admin: "admin_sec_ops",
    default_category: "DEVELOPER_TOOLS",
  },
  {
    vendor_id: "vendor_datadog",
    name: "Datadog, Inc.",
    verified_payout_address: "0xdddd333333333333333333333333333333333301",
    verified_by_admin: "admin_sec_ops",
    default_category: "INFRASTRUCTURE",
  },
  {
    vendor_id: "vendor_google_cloud",
    name: "Google Cloud Platform",
    verified_payout_address: "0xeeee444444444444444444444444444444444401",
    verified_by_admin: "admin_sec_ops",
    default_category: "INFRASTRUCTURE",
  },
  {
    vendor_id: "vendor_microsoft_azure",
    name: "Microsoft Azure",
    verified_payout_address: "0xffff555555555555555555555555555555555501",
    verified_by_admin: "admin_sec_ops",
    default_category: "INFRASTRUCTURE",
  },
  {
    vendor_id: "vendor_openai",
    name: "OpenAI, Inc.",
    verified_payout_address: "0xaaaa666666666666666666666666666666666601",
    verified_by_admin: "admin_sec_ops",
    default_category: "DEVELOPER_TOOLS",
  },
  {
    vendor_id: "vendor_stripe",
    name: "Stripe, Inc.",
    verified_payout_address: "0xbbbb777777777777777777777777777777777701",
    verified_by_admin: "admin_sec_ops",
    default_category: "PAYMENT_PROCESSING",
  },
  {
    vendor_id: "vendor_snowflake",
    name: "Snowflake Inc.",
    verified_payout_address: "0xcccc888888888888888888888888888888888801",
    verified_by_admin: "admin_sec_ops",
    default_category: "INFRASTRUCTURE",
  },
  {
    vendor_id: "vendor_twilio",
    name: "Twilio, Inc.",
    verified_payout_address: "0xdddd999999999999999999999999999999999901",
    verified_by_admin: "admin_sec_ops",
    default_category: "COMMUNICATIONS",
  },
  {
    vendor_id: "vendor_figma",
    name: "Figma, Inc.",
    verified_payout_address: "0xeeeeaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa01",
    verified_by_admin: "admin_sec_ops",
    default_category: "DESIGN_TOOLS",
  },
  {
    vendor_id: "vnd_deel_payroll",
    name: "Deel Global Payroll Solutions",
    verified_payout_address: "0xdddd444444444444444444444444444444444404",
    verified_by_admin: "admin_cfo",
    default_category: "SALARIES",
  },
];

export class VendorMasterService {
  private disbursalVaultService?: DisbursalVaultService;
  private adminWalletAdapter?: ViemWalletAdapter;
  private publicClient: PublicClient;

  constructor(params?: {
    disbursalVaultAddress?: `0x${string}`;
    adminWalletAdapter?: ViemWalletAdapter;
    publicClient?: PublicClient;
    chainId?: number;
  }) {
    this.publicClient = params?.publicClient ?? ArcClientManager.getPublicClient();
    if (params?.disbursalVaultAddress) {
      this.disbursalVaultService = new DisbursalVaultService(
        params.disbursalVaultAddress,
        params.chainId ?? 5042002,
        this.publicClient
      );
    }
    this.adminWalletAdapter = params?.adminWalletAdapter;
  }

  /**
   * Seeds initial verified vendors into PostgreSQL and onchain allowlist in DisbursalVault.
   */
  public async seedInitialVendors(
    vendors: InitialVendorSeed[] = DEFAULT_PRODUCTION_VENDORS
  ): Promise<VendorMasterRecord[]> {
    const records: VendorMasterRecord[] = [];

    for (const v of vendors) {
      const record = await VendorMasterRepo.registerVendor({
        vendor_id: v.vendor_id,
        name: v.name,
        verified_payout_address: v.verified_payout_address.toLowerCase() as `0x${string}`,
        verified_by_admin: v.verified_by_admin,
        last_verified_at: new Date(),
        change_lock: true,
      });

      records.push(record);

      // Synchronize with onchain allowlist if contract and admin adapter available
      if (this.disbursalVaultService && this.adminWalletAdapter) {
        try {
          const isApproved = await this.disbursalVaultService.isVendorApproved(
            v.verified_payout_address
          );
          if (!isApproved) {
            await this.adminWalletAdapter.executeContract({
              targetContract: this.disbursalVaultService.getAddress(),
              abi: DisbursalVaultABI,
              functionName: "setVendorApproval",
              args: [v.verified_payout_address, true],
              idempotencyKey: `seed_vendor_${v.vendor_id}`,
            });
          }
        } catch (err) {
          console.warn(`Could not set onchain approval for vendor ${v.vendor_id}:`, err);
        }
      }
    }

    return records;
  }

  /**
   * Rule 2: Enforce the Three-Way Match Before Payment
   * Rule 3: Vendor Master Change Control (Prevent Payee Substitution)
   * Rule 5: Make Repair Loud — Refuse Silent Rounding
   */
  public async verifyThreeWayMatch(
    params: ThreeWayMatchParams
  ): Promise<ThreeWayMatchResult> {
    // 1. Verify vendor exists in Master Registry
    const vendor = await VendorMasterRepo.getVendorById(params.vendorId);
    if (!vendor) {
      return {
        passed: false,
        rejectionReason: `VENDOR_NOT_FOUND: Vendor ID ${params.vendorId} does not exist in master registry.`,
        requiresHumanGate: true,
      };
    }

    // 2. Payee Substitution Protection (Rule 3)
    const verifiedAddr = vendor.verified_payout_address?.toLowerCase();
    if (verifiedAddr && params.payoutAddress.toLowerCase() !== verifiedAddr) {
      return {
        passed: false,
        rejectionReason: `PAYEE_SUBSTITUTION_DETECTED: Payout address ${params.payoutAddress} differs from verified master address ${vendor.verified_payout_address}.`,
        vendorRecord: vendor,
        requiresHumanGate: true,
      };
    }

    // 3. Document Linkage & Delivery Verification (Rule 1 & Rule 2)
    if (!params.poHash || params.poHash === "0x" || !params.invoiceHash || params.invoiceHash === "0x") {
      return {
        passed: false,
        rejectionReason: "DOCUMENT_HASH_MISSING: Both PO hash and Invoice hash must be present.",
        vendorRecord: vendor,
        requiresHumanGate: true,
      };
    }

    if (!params.deliveryVerified) {
      return {
        passed: false,
        rejectionReason: "GOODS_DELIVERY_UNVERIFIED: Milestone or Goods Receipt delivery has not been verified.",
        vendorRecord: vendor,
        requiresHumanGate: true,
      };
    }

    // 4. Exact Arithmetic Check (Rule 5)
    if (params.poAmountUsdc !== params.invoiceAmountUsdc) {
      return {
        passed: false,
        rejectionReason: `AMOUNT_MISMATCH: PO amount (${params.poAmountUsdc}) != Invoice amount (${params.invoiceAmountUsdc}). Refusing silent rounding.`,
        vendorRecord: vendor,
        requiresHumanGate: true,
      };
    }

    // 5. Generate Deterministic Idempotency Key
    const payoutTarget = (vendor.verified_payout_address || params.payoutAddress) as `0x${string}`;
    const idempotencyKey = DisbursalVaultService.generateIdempotencyKey(
      payoutTarget,
      params.invoiceId,
      params.invoiceAmountUsdc
    );

    // 6. Check if already executed onchain
    if (this.disbursalVaultService) {
      try {
        const isExecuted = await this.disbursalVaultService.isIdempotencyKeyExecuted(idempotencyKey);
        if (isExecuted) {
          return {
            passed: false,
            idempotencyKey,
            rejectionReason: `IDEMPOTENCY_COLLISION: Key ${idempotencyKey} has already been executed onchain.`,
            vendorRecord: vendor,
            requiresHumanGate: false,
          };
        }
      } catch (err) {
        console.warn("Could not check onchain idempotency key:", err);
      }
    }

    // 7. Check spending caps against policy
    const { profile: policy } = PolicyLoader.getActiveProfile();
    const amountFloat = Number(params.invoiceAmountUsdc) / 1e6;
    const requiresHumanGate =
      amountFloat >= policy.spending_limits.single_tx_human_gate_threshold_usdc;

    if (amountFloat > policy.spending_limits.daily_hard_cap_usdc) {
      return {
        passed: false,
        idempotencyKey,
        rejectionReason: `DAILY_HARD_CAP_EXCEEDED: Amount $${amountFloat} exceeds daily cap $${policy.spending_limits.daily_hard_cap_usdc}.`,
        vendorRecord: vendor,
        requiresHumanGate: true,
      };
    }

    return {
      passed: true,
      idempotencyKey,
      vendorRecord: vendor,
      requiresHumanGate,
    };
  }

  /**
   * Prepares or stages an SPRS permission request if human approval is needed.
   */
  public async createPaymentPermissionRequest(params: {
    requestId: string;
    actionType: string;
    reason: string;
    amountUsdc: number;
    payload: Record<string, any>;
  }): Promise<PermissionRequestRecord> {
    return PermissionRequestRepo.createRequest({
      request_id: params.requestId,
      action_type: params.actionType,
      reason: params.reason,
      amount_usdc: params.amountUsdc,
      status: "PENDING",
      payload: params.payload,
    });
  }

  /**
   * Helper to sign EIP-712 approval for admin authorization gatekeeper.
   */
  public async signAdminApproval(
    message: DisbursalApprovalMessage,
    adminAdapter: ViemWalletAdapter
  ): Promise<`0x${string}`> {
    if (!this.disbursalVaultService) {
      throw new Error("DisbursalVaultService is required to compute typed data.");
    }
    const typedData = this.disbursalVaultService.getEIP712TypedData(message);
    return adminAdapter.signTypedData(typedData as any);
  }
}
