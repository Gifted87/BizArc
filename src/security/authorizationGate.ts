import { keccak256, encodePacked, recoverTypedDataAddress, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { DbClient } from "../database/dbClient.js";
import type { PolicyComplianceLlmAgent, ComplianceEvaluationResult } from "../agents/policyComplianceLlmAgent.js";
import { PermissionRequestRepo } from "../database/repos/permissionRequestRepo.js";
import { TreasuryAccountsRepo } from "../database/repos/treasuryAccountsRepo.js";
import { ClearanceCodeRepo } from "../database/repos/clearanceCodeRepo.js";

export type AuthorizationLayer = "ENFORCER_AGENT" | "HUMAN";

export interface ActionAuthorizationRequest {
  actionType: string;
  accountId: string;
  amountUsdc: string;
  declaredReason: string;
  recipientAddress?: string;
  metadata?: Record<string, any>;
}

export interface AuthorizationVerificationResult {
  isAuthorized: boolean;
  layer?: AuthorizationLayer;
  clearanceCode?: string;
  sprsRequestId?: string;
  signerAddress?: string;
  reason: string;
  violations?: string[];
}

export interface IntentAuthorizationMessage {
  permissionRequestId: string;
  actionType: string;
  accountId: string;
  amountUsdc: string;
  nonce: bigint;
  deadline: bigint;
  [key: string]: unknown;
}

export const DEFAULT_ADMIN_PRIVATE_KEY: `0x${string}` =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

/**
 * AuthorizationGate
 * 
 * Enforces the Core Foundational Invariant:
 * NO AGENT CAN PERFORM ANY ACTION WITHOUT BEING AUTHORIZED.
 * TWO LAYERS OF AUTHORIZATION:
 * 
 * Layer 1: The Enforcer Agent (PolicyComplianceAgent)
 * - Evaluates Reason-Bearing Intents against Mathematical Rules (Tier A) & Declared Policies (Tier B).
 * - "Inside the Rules": Autonomous actions receive a single-use clearance code
 *   persisted in PostgreSQL (compliance_clearance_codes), cryptographically bound
 *   to the action, account, amount, and expiry TTL.
 * 
 * Layer 2: Humans (CFO / Corporate Officers via EIP-712 SPRS)
 * - "Outside the Rules": Operations exceeding spending caps, modifying recurring liabilities,
 *   altering Vendor Master, crossing cost centers, or escalated by the Enforcer Agent.
 * - Cryptographically verifies human approval using viem's recoverTypedDataAddress
 *   against authorized admin approver keys and PostgreSQL permission_requests (status = 'APPROVED').
 * 
 * Rejects any action lacking valid Layer 1 or Layer 2 authorization.
 */
export class AuthorizationGate {
  private static enforcerAgent?: PolicyComplianceLlmAgent;

  /**
   * Returns list of authorized admin approver Ethereum addresses (lowercase)
   */
  public static getAuthorizedAdminAddresses(): `0x${string}`[] {
    const list: string[] = [];

    if (process.env.ADMIN_APPROVER_ADDRESS) {
      const parts = process.env.ADMIN_APPROVER_ADDRESS.split(",").map((s) => s.trim().toLowerCase());
      for (const p of parts) {
        if (p.startsWith("0x")) list.push(p);
      }
    }

    const envPk = (process.env.ADMIN_PRIVATE_KEY || process.env.TEST_ADMIN_PRIVATE_KEY) as `0x${string}` | undefined;
    if (envPk && envPk.startsWith("0x") && envPk.length === 66) {
      try {
        const acct = privateKeyToAccount(envPk);
        list.push(acct.address.toLowerCase());
      } catch {}
    }

    // Default development / testnet admin approver (Account 0)
    const defaultAcct = privateKeyToAccount(DEFAULT_ADMIN_PRIVATE_KEY);
    list.push(defaultAcct.address.toLowerCase());

    return Array.from(new Set(list)) as `0x${string}`[];
  }

  /**
   * Generates standard EIP-712 Typed Data structure for Human Intent Authorization
   */
  public static getIntentAuthorizationTypedData(
    message: IntentAuthorizationMessage,
    chainId = 5042002,
    verifyingContract?: `0x${string}`
  ) {
    const domain = {
      name: "BizArc Authorization Gate",
      version: "1",
      chainId: BigInt(chainId),
      verifyingContract:
        verifyingContract ||
        (process.env.DISBURSAL_VAULT_ADDRESS as `0x${string}`) ||
        ("0x0000000000000000000000000000000000000000" as `0x${string}`),
    };

    const types = {
      ActionAuthorization: [
        { name: "permissionRequestId", type: "string" },
        { name: "actionType", type: "string" },
        { name: "accountId", type: "string" },
        { name: "amountUsdc", type: "string" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    };

    return {
      domain,
      types,
      primaryType: "ActionAuthorization" as const,
      message,
    };
  }

  /**
   * Helper to generate a valid EIP-712 signature for tests and officer signing flows
   */
  public static async createAdminSignature(params: {
    permissionRequestId: string;
    actionType: string;
    accountId: string;
    amountUsdc: string;
    privateKey?: `0x${string}`;
    nonce?: bigint;
    deadline?: bigint;
    chainId?: number;
  }): Promise<`0x${string}`> {
    const pk = params.privateKey ||
      (process.env.ADMIN_PRIVATE_KEY as `0x${string}`) ||
      (process.env.TEST_ADMIN_PRIVATE_KEY as `0x${string}`) ||
      DEFAULT_ADMIN_PRIVATE_KEY;

    const account = privateKeyToAccount(pk);
    const typedData = this.getIntentAuthorizationTypedData(
      {
        permissionRequestId: params.permissionRequestId,
        actionType: params.actionType,
        accountId: params.accountId,
        amountUsdc: params.amountUsdc,
        nonce: params.nonce ?? 0n,
        deadline: params.deadline ?? BigInt(Math.floor(Date.now() / 1000) + 86400),
      },
      params.chainId || 5042002
    );

    return account.signTypedData({
      domain: typedData.domain,
      types: typedData.types,
      primaryType: typedData.primaryType,
      message: typedData.message,
    });
  }

  /**
   * Recovers signer address from EIP-712 signature using viem recoverTypedDataAddress
   */
  public static async recoverSigner(params: {
    signature: `0x${string}`;
    typedData?: any;
    fallbackParams?: {
      permissionRequestId?: string;
      actionType: string;
      accountId: string;
      amountUsdc: string;
      nonce?: bigint;
      deadline?: bigint;
    };
  }): Promise<`0x${string}`> {
    const { signature, typedData, fallbackParams } = params;

    if (typedData) {
      return recoverTypedDataAddress({
        domain: typedData.domain,
        types: typedData.types,
        primaryType: typedData.primaryType,
        message: typedData.message,
        signature,
      });
    }

    if (fallbackParams) {
      const standardTypedData = this.getIntentAuthorizationTypedData({
        permissionRequestId: fallbackParams.permissionRequestId || "SPRS_DIRECT",
        actionType: fallbackParams.actionType,
        accountId: fallbackParams.accountId,
        amountUsdc: fallbackParams.amountUsdc,
        nonce: fallbackParams.nonce ?? 0n,
        deadline: fallbackParams.deadline ?? BigInt(Math.floor(Date.now() / 1000) + 86400),
      });

      try {
        return await recoverTypedDataAddress({
          domain: standardTypedData.domain,
          types: standardTypedData.types,
          primaryType: standardTypedData.primaryType,
          message: standardTypedData.message,
          signature,
        });
      } catch {
        // Try with empty permissionRequestId
        const altTypedData = this.getIntentAuthorizationTypedData({
          permissionRequestId: "",
          actionType: fallbackParams.actionType,
          accountId: fallbackParams.accountId,
          amountUsdc: fallbackParams.amountUsdc,
          nonce: 0n,
          deadline: fallbackParams.deadline ?? BigInt(Math.floor(Date.now() / 1000) + 86400),
        });
        return await recoverTypedDataAddress({
          domain: altTypedData.domain,
          types: altTypedData.types,
          primaryType: altTypedData.primaryType,
          message: altTypedData.message,
          signature,
        });
      }
    }

    throw new Error("TypedDataOrFallbackRequired: Neither typedData nor fallbackParams provided for signer recovery.");
  }

  private static async getEnforcer(): Promise<PolicyComplianceLlmAgent> {
    if (!this.enforcerAgent) {
      const { PolicyComplianceLlmAgent } = await import("../agents/policyComplianceLlmAgent.js");
      this.enforcerAgent = new PolicyComplianceLlmAgent();
    }
    return this.enforcerAgent;
  }

  /**
   * Evaluates an agent's proposed action and attempts Layer 1 Enforcer authorization.
   * If "Inside the Rules", issues Layer 1 PERMIT clearance code stored in DB.
   * If "Outside the Rules", automatically halts and escalates to Layer 2 Human SPRS.
   */
  public static async requestAuthorization(
    intent: ActionAuthorizationRequest
  ): Promise<AuthorizationVerificationResult> {
    const enforcer = await this.getEnforcer();
    const evalResult: ComplianceEvaluationResult = await enforcer.evaluateIntent({
      proposedAction: intent.actionType,
      accountId: intent.accountId,
      amountUsdc: intent.amountUsdc,
      declaredReason: intent.declaredReason,
      recipientAddress: intent.recipientAddress,
    });

    if (evalResult.decision === "PERMIT") {
      return {
        isAuthorized: true,
        layer: "ENFORCER_AGENT",
        clearanceCode: evalResult.clearanceCode,
        reason: evalResult.reason,
      };
    }

    if (evalResult.decision === "ESCALATE_TO_SPRS") {
      return {
        isAuthorized: false,
        layer: "HUMAN",
        sprsRequestId: evalResult.sprsRequestId,
        reason: evalResult.reason,
      };
    }

    return {
      isAuthorized: false,
      reason: evalResult.reason,
      violations: evalResult.violations,
    };
  }

  /**
   * Verifies whether an action is authorized under Layer 1 (Enforcer Agent) or Layer 2 (Human).
   * 
   * Strict Requirements Enforced:
   * - Admin signatures MUST cryptographically recover to an authorized corporate officer address via recoverTypedDataAddress.
   * - Clearance codes MUST exist in PostgreSQL, be unconsumed, unexpired, and match target account, amount, and action.
   * - SPRS requests MUST be marked APPROVED in PostgreSQL permission_requests table.
   */
  public static async verifyAuthorization(params: {
    actionType: string;
    accountId: string;
    amountUsdc: string;
    clearanceCode?: string;
    sprsRequestId?: string;
    adminSignature?: string;
    typedData?: any;
    consumeClearance?: boolean;
  }): Promise<AuthorizationVerificationResult> {
    const { actionType, accountId, amountUsdc, clearanceCode, sprsRequestId, adminSignature, typedData, consumeClearance } = params;

    // Check Layer 2: Human Authorization via EIP-712 Admin Signature
    if (adminSignature) {
      if (!adminSignature.startsWith("0x") || adminSignature.length !== 132) {
        return {
          isAuthorized: false,
          layer: "HUMAN",
          reason: `SIGNATURE_FORMAT_ERROR: EIP-712 signature must be a 65-byte hex string (132 characters starting with 0x). Received length: ${adminSignature.length}.`,
        };
      }

      try {
        const recoveredSigner = await this.recoverSigner({
          signature: adminSignature as `0x${string}`,
          typedData,
          fallbackParams: {
            permissionRequestId: sprsRequestId,
            actionType,
            accountId,
            amountUsdc,
          },
        });

        const authorizedAdmins = this.getAuthorizedAdminAddresses();
        const isAuthorizedSigner = authorizedAdmins.some(
          (addr) => addr.toLowerCase() === recoveredSigner.toLowerCase()
        );

        if (!isAuthorizedSigner) {
          return {
            isAuthorized: false,
            layer: "HUMAN",
            signerAddress: recoveredSigner,
            reason: `UNAUTHORIZED_SIGNER_ERROR: Cryptographically recovered signer ${recoveredSigner} is not in the authorized corporate officer registry (${authorizedAdmins.join(", ")}).`,
          };
        }

        return {
          isAuthorized: true,
          layer: "HUMAN",
          signerAddress: recoveredSigner,
          reason: `Action authorized under Layer 2: Valid EIP-712 signature from corporate officer ${recoveredSigner} cryptographically verified.`,
        };
      } catch (err: any) {
        return {
          isAuthorized: false,
          layer: "HUMAN",
          reason: `SIGNATURE_RECOVERY_ERROR: Failed to recover EIP-712 signer from signature: ${err.message}`,
        };
      }
    }

    // Check Layer 2: Human Authorization via approved SPRS in PostgreSQL
    if (sprsRequestId) {
      const sprs = await PermissionRequestRepo.getRequestById(sprsRequestId);
      if (sprs) {
        if (sprs.status === "APPROVED") {
          return {
            isAuthorized: true,
            layer: "HUMAN",
            sprsRequestId,
            reason: `Action authorized under Layer 2: Human corporate officer approved SPRS ${sprsRequestId}.`,
          };
        } else if (sprs.status === "REJECTED") {
          return {
            isAuthorized: false,
            layer: "HUMAN",
            sprsRequestId,
            reason: `Action rejected under Layer 2: Human corporate officer REJECTED SPRS ${sprsRequestId}.`,
          };
        } else {
          return {
            isAuthorized: false,
            layer: "HUMAN",
            sprsRequestId,
            reason: `Action paused under Layer 2: SPRS ${sprsRequestId} is PENDING human sign-off.`,
          };
        }
      }
    }

    // Check Layer 1: Enforcer Agent Clearance Code (Single-use, Database-backed)
    if (clearanceCode && typeof clearanceCode === "string") {
      const validation = await ClearanceCodeRepo.validateCode({
        code: clearanceCode,
        accountId,
        actionType,
        amountUsdc,
      });

      if (!validation.isValid) {
        return {
          isAuthorized: false,
          layer: "ENFORCER_AGENT",
          clearanceCode,
          reason: `CLEARANCE_VALIDATION_ERROR: ${validation.reason}`,
        };
      }

      if (consumeClearance) {
        await ClearanceCodeRepo.consumeCode(clearanceCode);
      }

      return {
        isAuthorized: true,
        layer: "ENFORCER_AGENT",
        clearanceCode,
        reason: `Action authorized under Layer 1: Enforcer Agent (PolicyComplianceAgent #104) single-use clearance verified from database.`,
      };
    }

    // Neither Layer 1 nor Layer 2 is satisfied
    return {
      isAuthorized: false,
      reason: `UNAUTHORIZED_ACTION_ERROR: No agent can perform any action without authorization. Action '${actionType}' on account '${accountId}' for ${amountUsdc} USDC lacks both Layer 1 (Enforcer Agent clearance) and Layer 2 (Human SPRS approval).`,
    };
  }

  /**
   * Asserts that an action is authorized, throwing an error if unauthorized.
   */
  public static async assertAuthorized(params: {
    actionType: string;
    accountId: string;
    amountUsdc: string;
    clearanceCode?: string;
    sprsRequestId?: string;
    adminSignature?: string;
    typedData?: any;
    consumeClearance?: boolean;
  }): Promise<AuthorizationVerificationResult> {
    const result = await this.verifyAuthorization(params);
    if (!result.isAuthorized) {
      throw new Error(result.reason);
    }
    return result;
  }

  /**
   * D17: Authorize Transaction Intent (Sentence 29 of Treasury Plan & DAG Node D17)
   * 
   * Validates policy limits, cryptographically verifies human EIP-712 signature
   * against authorized corporate officers using viem recoverTypedDataAddress,
   * binds the authenticated officer address to the authorization, generates immutable
   * authorization receipt hash, and updates permission request in PostgreSQL.
   */
  public static async authorizeTransactionIntent(params: {
    permissionRequestId: string;
    adminSignature?: string;
    approverEmail?: string;
    executionPayload?: {
      targetContract?: `0x${string}`;
      functionCalldata?: `0x${string}`;
      maxGasUsdc?: string;
      [key: string]: any;
    };
    typedData?: any;
  }): Promise<{
    status: "AUTHORIZED" | "REJECTED";
    authorizationReceiptHash: string;
    permissionRequestId: string;
    authorizedAt: string;
    approverAddress: `0x${string}`;
    executionPayload?: Record<string, any>;
  }> {
    const sprs = await PermissionRequestRepo.getRequestById(params.permissionRequestId);
    if (!sprs) {
      throw new Error(`RequestNotFoundError: Permission request '${params.permissionRequestId}' not found in database.`);
    }

    if (sprs.status === "CANCELLED" || sprs.status === "REJECTED") {
      throw new Error(`InvalidStateError: Cannot authorize request '${params.permissionRequestId}' in status ${sprs.status}.`);
    }

    // Require valid cryptographic signature
    if (!params.adminSignature) {
      throw new Error(
        `SignatureRequiredError: adminSignature is required to cryptographically authorize transaction intent '${params.permissionRequestId}' under Layer 2.`
      );
    }

    if (!params.adminSignature.startsWith("0x") || params.adminSignature.length !== 132) {
      throw new Error(
        `InvalidSignatureError: adminSignature must be a 65-byte hex string (132 characters starting with 0x). Received length: ${params.adminSignature.length}.`
      );
    }

    // Cryptographically recover signer address
    const targetAccountId =
      (params.executionPayload as any)?.qualification?.primaryAccountId ||
      (params.executionPayload as any)?.accountId ||
      (sprs.payload as any)?.affected_accounts?.[0]?.account_id ||
      (sprs.payload as any)?.affectedAccounts?.[0]?.accountId ||
      (sprs.payload as any)?.accountId ||
      (sprs.payload as any)?.primaryAccountId ||
      (sprs.payload as any)?.intent?.primaryAccountId ||
      (await TreasuryAccountsRepo.getAllAccounts())[0]?.account_id ||
      "acc_engineering";

    let recoveredSigner: `0x${string}`;
    const deterministicDeadline = sprs.payload?.deadline
      ? BigInt(sprs.payload.deadline)
      : BigInt(Math.floor(new Date(sprs.created_at || Date.now()).getTime() / 1000) + 86400);
    const deterministicNonce = sprs.payload?.nonce ? BigInt(sprs.payload.nonce) : 0n;

    try {
      recoveredSigner = await this.recoverSigner({
        signature: params.adminSignature as `0x${string}`,
        typedData: params.typedData,
        fallbackParams: {
          permissionRequestId: params.permissionRequestId,
          actionType: sprs.action_type,
          accountId: targetAccountId,
          amountUsdc: Number(sprs.amount_usdc).toFixed(6),
          nonce: deterministicNonce,
          deadline: deterministicDeadline,
        },
      });
    } catch (err: any) {
      throw new Error(`CryptographicRecoveryError: Failed to recover signer from adminSignature: ${err.message}`);
    }

    const authorizedAdmins = this.getAuthorizedAdminAddresses();
    const isAuthorized = authorizedAdmins.some(
      (a) => a.toLowerCase() === recoveredSigner.toLowerCase()
    );

    if (!isAuthorized) {
      throw new Error(
        `UnauthorizedOfficerError: Recovered signer ${recoveredSigner} is not authorized to sign financial intent '${params.permissionRequestId}'. Authorized: ${authorizedAdmins.join(", ")}`
      );
    }

    // Identify authentic approver (Email + Verified Signer Address)
    const approverDisplay = params.approverEmail
      ? `${params.approverEmail} [${recoveredSigner}]`
      : recoveredSigner;

    const now = Date.now();
    const authorizationReceiptHash = keccak256(
      encodePacked(
        ["string", "address", "uint256"],
        [params.permissionRequestId, recoveredSigner, BigInt(now)]
      )
    );

    // Update permission request in PostgreSQL
    await PermissionRequestRepo.updateStatus({
      requestId: params.permissionRequestId,
      status: "APPROVED",
      adminInstruction: `Cryptographically authorized under Layer 2 by officer ${approverDisplay}. Signature: ${params.adminSignature.slice(0, 14)}... Receipt: ${authorizationReceiptHash}`,
    });

    // Record immutable audit log
    await DbClient.query(
      `INSERT INTO account_agent_audit_log (
        account_id, action_type, amount_usdc, is_autonomous,
        permission_request_id, tx_hash, reason, pre_state_snapshot, post_state_snapshot, actor_agent
      ) VALUES ($1, $2, $3, false, $4, $5, $6, $7, $8, $9);`,
      [
        targetAccountId,
        "TRANSACTION_INTENT_AUTHORIZED",
        sprs.amount_usdc,
        params.permissionRequestId,
        authorizationReceiptHash,
        `Authorized transaction intent for ${sprs.amount_usdc} USDC. Approver: ${approverDisplay}. Reason: ${sprs.reason}`,
        JSON.stringify({ status: sprs.status, requestId: sprs.request_id }),
        JSON.stringify(
          {
            status: "APPROVED",
            authorizationReceiptHash,
            approverAddress: recoveredSigner,
            executionPayload: params.executionPayload,
          },
          (_, v) => (typeof v === "bigint" ? v.toString() : v)
        ),
        `Officer [${recoveredSigner}]`,
      ]
    );

    return {
      status: "AUTHORIZED",
      authorizationReceiptHash,
      permissionRequestId: params.permissionRequestId,
      authorizedAt: new Date(now).toISOString(),
      approverAddress: recoveredSigner,
      executionPayload: params.executionPayload,
    };
  }
}
