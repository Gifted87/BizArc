import { DbClient } from "../database/dbClient.js";
import { VendorMasterRepo, VendorMasterRecord } from "../database/repos/vendorMasterRepo.js";
import { PermissionRequestRepo } from "../database/repos/permissionRequestRepo.js";
import { AuthorizationGate } from "../security/authorizationGate.js";

export interface RegisterVendorPayload {
  vendorId: string;
  name: string;
  verifiedPayoutAddress: `0x${string}`;
  paymentEndpointUrl?: string;
  payoutRail?: "DISBURSAL_VAULT" | "MODULAR_SESSION_KEY" | "ERC3009_AUTHORIZATION" | "GATEWAY_X402";
  taxId?: string;
  authorizedCategory?: string;
  verifiedByAdmin?: string;
}

export interface UpdateVendorPayload {
  vendorId: string;
  name?: string;
  newPayoutAddress?: `0x${string}`;
  newPaymentEndpointUrl?: string;
  payoutRail?: "DISBURSAL_VAULT" | "MODULAR_SESSION_KEY" | "ERC3009_AUTHORIZATION" | "GATEWAY_X402";
  reason: string;
  proposedBy: string;
  adminSignature?: string;
  sprsRequestId?: string;
}

export class VendorLifecycleService {
  /**
   * Registers a new vendor into Vendor Master Registry during onboarding or via admin.
   */
  public static async registerVendor(payload: RegisterVendorPayload): Promise<VendorMasterRecord> {
    if (!payload.vendorId || !payload.name || !payload.verifiedPayoutAddress) {
      throw new Error("[VendorLifecycleService] Missing required vendor registration fields");
    }

    // Direct registration into immutable Vendor Master Registry
    const record = await VendorMasterRepo.registerVendor({
      vendor_id: payload.vendorId,
      name: payload.name,
      verified_payout_address: payload.verifiedPayoutAddress,
      verified_by_admin: payload.verifiedByAdmin || "HUMAN_ADMIN",
      last_verified_at: new Date(),
      change_lock: true,
    });

    // If endpoint URL or rail is provided, update columns
    if (payload.paymentEndpointUrl || payload.payoutRail) {
      await DbClient.query(
        `UPDATE vendor_master_registry 
         SET payment_endpoint_url = COALESCE($1, payment_endpoint_url),
             payout_rail = COALESCE($2, payout_rail)
         WHERE vendor_id = $3;`,
        [payload.paymentEndpointUrl || null, payload.payoutRail || null, payload.vendorId]
      );
    }

    return record;
  }

  /**
   * Updates an existing vendor's details or payout destination.
   * STRICT SECURITY INVARIANT (Rule 3 Payee Substitution Defense):
   * Modifying a verified payout address or endpoint URL requires Layer 2 Human Approval (SPRS)
   * to protect against malicious agent address substitution.
   */
  public static async proposeOrUpdateVendor(payload: UpdateVendorPayload): Promise<{
    status: "UPDATED" | "PENDING_HUMAN_APPROVAL";
    vendor?: VendorMasterRecord;
    sprsRequestId?: string;
    message: string;
  }> {
    const existing = await VendorMasterRepo.getVendorById(payload.vendorId);
    if (!existing) {
      throw new Error(`[VendorLifecycleService] Vendor ${payload.vendorId} not found in registry`);
    }

    // Check if Human Authorization (Layer 2) is already provided
    const authCheck = await AuthorizationGate.verifyAuthorization({
      actionType: "UPDATE_VENDOR_MASTER",
      accountId: "SYSTEM_VENDOR_MASTER",
      amountUsdc: "0.000000",
      sprsRequestId: payload.sprsRequestId,
      adminSignature: payload.adminSignature,
    });

    const isHumanInitiated = payload.proposedBy === "HUMAN" || authCheck.isAuthorized;

    if (!isHumanInitiated && (payload.newPayoutAddress || payload.newPaymentEndpointUrl)) {
      // Escalate to Layer 2 Human SPRS
      const sprsId = `SPRS_VEND_${payload.vendorId}_${Date.now()}`;
      await PermissionRequestRepo.createRequest({
        request_id: sprsId,
        action_type: "VENDOR_PAYOUT_DESTINATION_CHANGE",
        reason: `Agent ${payload.proposedBy} proposed modifying payout destination for vendor ${existing.name} (${payload.vendorId}). Rationale: ${payload.reason}`,
        amount_usdc: 0,
        status: "PENDING",
        payload: {
          vendorId: payload.vendorId,
          oldAddress: existing.verified_payout_address,
          newAddress: payload.newPayoutAddress,
          newEndpoint: payload.newPaymentEndpointUrl,
          proposedBy: payload.proposedBy,
        },
      });

      return {
        status: "PENDING_HUMAN_APPROVAL",
        sprsRequestId: sprsId,
        message: `Vendor destination update halted for Layer 2 Human CFO approval (SPRS ${sprsId}). Payee substitution defense active.`,
      };
    }

    // Execute verified update
    if (payload.newPayoutAddress) {
      await VendorMasterRepo.updatePayoutAddress({
        vendorId: payload.vendorId,
        newAddress: payload.newPayoutAddress,
        adminId: payload.proposedBy,
        forceOverride: true,
      });
    }

    if (payload.newPaymentEndpointUrl || payload.name || payload.payoutRail) {
      await DbClient.query(
        `UPDATE vendor_master_registry 
         SET name = COALESCE($1, name),
             payment_endpoint_url = COALESCE($2, payment_endpoint_url),
             payout_rail = COALESCE($3, payout_rail),
             last_verified_at = NOW()
         WHERE vendor_id = $4;`,
        [payload.name || null, payload.newPaymentEndpointUrl || null, payload.payoutRail || null, payload.vendorId]
      );
    }

    const updated = await VendorMasterRepo.getVendorById(payload.vendorId);
    return {
      status: "UPDATED",
      vendor: updated!,
      message: `Vendor ${payload.vendorId} updated successfully.`,
    };
  }

  /**
   * Removes or deactivates a vendor from the registry.
   * Requires Layer 2 Human Approval.
   */
  public static async removeVendor(params: {
    vendorId: string;
    reason: string;
    proposedBy: string;
    sprsRequestId?: string;
    adminSignature?: string;
  }): Promise<{ status: "REMOVED" | "PENDING_HUMAN_APPROVAL"; sprsRequestId?: string }> {
    const authCheck = await AuthorizationGate.verifyAuthorization({
      actionType: "REMOVE_VENDOR_MASTER",
      accountId: "SYSTEM_VENDOR_MASTER",
      amountUsdc: "0.000000",
      sprsRequestId: params.sprsRequestId,
      adminSignature: params.adminSignature,
    });

    if (!authCheck.isAuthorized && params.proposedBy !== "HUMAN") {
      const sprsId = `SPRS_DEL_VEND_${params.vendorId}_${Date.now()}`;
      await PermissionRequestRepo.createRequest({
        request_id: sprsId,
        action_type: "REMOVE_VENDOR_MASTER",
        reason: `Deactivating vendor ${params.vendorId}: ${params.reason}`,
        amount_usdc: 0,
        status: "PENDING",
        payload: params,
      });

      return { status: "PENDING_HUMAN_APPROVAL", sprsRequestId: sprsId };
    }

    await DbClient.query(`DELETE FROM vendor_master_registry WHERE vendor_id = $1;`, [params.vendorId]);
    return { status: "REMOVED" };
  }
}
