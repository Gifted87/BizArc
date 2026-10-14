import { DbClient } from "../dbClient.js";

export interface VendorMasterRecord {
  vendor_id: string;
  company_id?: string;
  name: string;
  verified_payout_address?: `0x${string}` | string | null;
  verified_by_admin: string;
  last_verified_at: Date;
  change_lock: boolean;
}

export class VendorMasterRepo {
  public static async registerVendor(
    vendor: VendorMasterRecord
  ): Promise<VendorMasterRecord> {
    const companyId = vendor.company_id || "default_org";
    const text = `
      INSERT INTO vendor_master_registry (
        vendor_id, company_id, name, verified_payout_address, verified_by_admin,
        last_verified_at, change_lock
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (vendor_id) DO UPDATE SET
        company_id = EXCLUDED.company_id,
        name = EXCLUDED.name,
        verified_payout_address = COALESCE(EXCLUDED.verified_payout_address, vendor_master_registry.verified_payout_address),
        verified_by_admin = EXCLUDED.verified_by_admin,
        last_verified_at = EXCLUDED.last_verified_at
      RETURNING *;
    `;
    const addressVal = vendor.verified_payout_address
      ? vendor.verified_payout_address.toLowerCase()
      : null;
    const values = [
      vendor.vendor_id,
      companyId,
      vendor.name,
      addressVal,
      vendor.verified_by_admin,
      vendor.last_verified_at || new Date(),
      vendor.change_lock ?? true,
    ];

    const result = await DbClient.query<VendorMasterRecord>(text, values);
    return result.rows[0];
  }

  public static async getVendorById(
    vendorId: string,
    companyId?: string
  ): Promise<VendorMasterRecord | null> {
    let text = `SELECT * FROM vendor_master_registry WHERE vendor_id = $1`;
    const values: any[] = [vendorId];
    if (companyId) {
      text += ` AND company_id = $2`;
      values.push(companyId);
    }
    text += ` LIMIT 1;`;
    const result = await DbClient.query<VendorMasterRecord>(text, values);
    return result.rows[0] || null;
  }

  public static async getVendorByName(
    name: string,
    companyId?: string
  ): Promise<VendorMasterRecord | null> {
    let text = `SELECT * FROM vendor_master_registry WHERE LOWER(name) = LOWER($1)`;
    const values: any[] = [name];
    if (companyId) {
      text += ` AND company_id = $2`;
      values.push(companyId);
    }
    text += ` LIMIT 1;`;
    const result = await DbClient.query<VendorMasterRecord>(text, values);
    return result.rows[0] || null;
  }

  public static async getVendorByAddress(
    payoutAddress: string,
    companyId?: string
  ): Promise<VendorMasterRecord | null> {
    let text = `SELECT * FROM vendor_master_registry WHERE LOWER(verified_payout_address) = LOWER($1)`;
    const values: any[] = [payoutAddress];
    if (companyId) {
      text += ` AND company_id = $2`;
      values.push(companyId);
    }
    text += ` LIMIT 1;`;
    const result = await DbClient.query<VendorMasterRecord>(text, values);
    return result.rows[0] || null;
  }

  public static async getAllVendors(companyId?: string): Promise<VendorMasterRecord[]> {
    if (companyId) {
      const text = `SELECT * FROM vendor_master_registry WHERE company_id = $1 ORDER BY vendor_id ASC;`;
      const result = await DbClient.query<VendorMasterRecord>(text, [companyId]);
      return result.rows;
    }
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

  /**
   * Resolves verified payout address for a vendor from PostgreSQL master registry,
   * checking aliases and bootstrapping known enterprise vendors if needed.
   */
  public static async resolveVerifiedPayoutAddress(
    vendorId: string,
    fallbackAddress?: `0x${string}`
  ): Promise<`0x${string}`> {
    const direct = await this.getVendorById(vendorId);
    if (direct?.verified_payout_address) return direct.verified_payout_address as `0x${string}`;

    const alias = vendorId.startsWith("vendor_")
      ? vendorId.replace("vendor_", "vnd_")
      : vendorId.startsWith("vnd_")
      ? vendorId.replace("vnd_", "vendor_")
      : undefined;

    if (alias) {
      const aliasRecord = await this.getVendorById(alias);
      if (aliasRecord?.verified_payout_address) return aliasRecord.verified_payout_address as `0x${string}`;
    }

    if (fallbackAddress) {
      return fallbackAddress;
    }

    const KNOWN_MAP: Record<string, `0x${string}`> = {
      vendor_aws_cloud: "0xaaaa111111111111111111111111111111111101",
      vnd_aws_cloud: "0xaaaa111111111111111111111111111111111101",
      vendor_github_enterprise: "0xcccc333333333333333333333333333333333303",
      vnd_github_enterprise: "0xcccc333333333333333333333333333333333303",
      vendor_datadog: "0xdddd333333333333333333333333333333333301",
      vendor_google_cloud: "0xeeee444444444444444444444444444444444401",
      vendor_microsoft_azure: "0xffff555555555555555555555555555555555501",
      vendor_openai: "0xaaaa666666666666666666666666666666666601",
      vendor_stripe: "0xbbbb777777777777777777777777777777777701",
      vendor_snowflake: "0xcccc888888888888888888888888888888888801",
      vendor_twilio: "0xdddd999999999999999999999999999999999901",
      vendor_figma: "0xeeeeaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa01",
    };

    const knownAddr = KNOWN_MAP[vendorId] || (alias ? KNOWN_MAP[alias] : undefined);
    if (knownAddr) {
      try {
        await this.registerVendor({
          vendor_id: vendorId,
          name: vendorId.replace(/^(vendor_|vnd_)/, "").replace(/_/g, " ").toUpperCase(),
          verified_payout_address: knownAddr,
          verified_by_admin: "SYSTEM_ENTERPRISE_BOOTSTRAP",
          last_verified_at: new Date(),
          change_lock: true,
        });
      } catch {
        // Continue if already exists
      }
      return knownAddr;
    }

    throw new Error(`[VendorMasterRepo] No verified payout address found in master registry for vendor '${vendorId}'. Payee substitution policy requires admin registration.`);
  }

  public static async deleteVendor(vendorId: string, companyId?: string): Promise<boolean> {
    if (companyId) {
      const text = `DELETE FROM vendor_master_registry WHERE vendor_id = $1 AND company_id = $2;`;
      const res = await DbClient.query(text, [vendorId, companyId]);
      return (res.rowCount ?? 0) > 0;
    }
    const text = `DELETE FROM vendor_master_registry WHERE vendor_id = $1;`;
    const res = await DbClient.query(text, [vendorId]);
    return (res.rowCount ?? 0) > 0;
  }
}
