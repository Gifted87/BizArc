import { DbClient } from "../dbClient.js";

export interface VendorMasterRecord {
  vendor_id: string;
  name: string;
  verified_payout_address: `0x${string}`;
  verified_by_admin: string;
  last_verified_at: Date;
  change_lock: boolean;
}

export class VendorMasterRepo {
  public static async registerVendor(
    vendor: VendorMasterRecord
  ): Promise<VendorMasterRecord> {
    const text = `
      INSERT INTO vendor_master_registry (
        vendor_id, name, verified_payout_address, verified_by_admin,
        last_verified_at, change_lock
      ) VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (vendor_id) DO UPDATE SET
        name = EXCLUDED.name,
        verified_by_admin = EXCLUDED.verified_by_admin,
        last_verified_at = EXCLUDED.last_verified_at
      RETURNING *;
    `;
    const values = [
      vendor.vendor_id,
      vendor.name,
      vendor.verified_payout_address.toLowerCase(),
      vendor.verified_by_admin,
      vendor.last_verified_at || new Date(),
      vendor.change_lock ?? true,
    ];

    const result = await DbClient.query<VendorMasterRecord>(text, values);
    return result.rows[0];
  }

  public static async getVendorById(
    vendorId: string
  ): Promise<VendorMasterRecord | null> {
    const text = `SELECT * FROM vendor_master_registry WHERE vendor_id = $1 LIMIT 1;`;
    const result = await DbClient.query<VendorMasterRecord>(text, [vendorId]);
    return result.rows[0] || null;
  }

  public static async getVendorByAddress(
    payoutAddress: string
  ): Promise<VendorMasterRecord | null> {
    const text = `SELECT * FROM vendor_master_registry WHERE LOWER(verified_payout_address) = LOWER($1) LIMIT 1;`;
    const result = await DbClient.query<VendorMasterRecord>(text, [payoutAddress]);
    return result.rows[0] || null;
  }

  public static async getAllVendors(): Promise<VendorMasterRecord[]> {
    const text = `SELECT * FROM vendor_master_registry ORDER BY vendor_id ASC;`;
    const result = await DbClient.query<VendorMasterRecord>(text);
    return result.rows;
  }

  /**
   * Rule 3: Vendor Master Change Control (Prevent Payee Substitution)
   * If change_lock is active, payout address cannot be modified without explicit force override.
   */
  public static async updatePayoutAddress(params: {
    vendorId: string;
    newAddress: `0x${string}`;
    adminId: string;
    forceOverride?: boolean;
  }): Promise<{ success: boolean; error?: string }> {
    const current = await this.getVendorById(params.vendorId);
    if (!current) {
      return { success: false, error: `Vendor ${params.vendorId} not found in master registry.` };
    }

    if (current.change_lock && !params.forceOverride) {
      return {
        success: false,
        error: `PAYEE_SUBSTITUTION_LOCKED: Vendor ${params.vendorId} has active change_lock. Modifying payout address requires explicit admin unlock override.`,
      };
    }

    const text = `
      UPDATE vendor_master_registry
      SET verified_payout_address = $1,
          verified_by_admin = $2,
          last_verified_at = NOW()
      WHERE vendor_id = $3;
    `;
    await DbClient.query(text, [
      params.newAddress.toLowerCase(),
      params.adminId,
      params.vendorId,
    ]);

    return { success: true };
  }

  public static async setChangeLock(vendorId: string, locked: boolean): Promise<void> {
    const text = `UPDATE vendor_master_registry SET change_lock = $1 WHERE vendor_id = $2;`;
    await DbClient.query(text, [locked, vendorId]);
  }
}
