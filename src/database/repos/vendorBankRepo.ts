import { DbClient } from "../dbClient.js";

export interface VendorBankAccountRecord {
  bank_account_id: string;
  vendor_id: string;
  account_holder_name: string;
  iban_account_number: string;
  routing_swift: string;
  bank_name?: string;
  bank_country: string;
  is_verified: boolean;
  verified_by_admin: string;
  created_at: Date;
  updated_at: Date;
}

export class VendorBankRepo {
  public static async createBankAccount(params: {
    vendor_id: string;
    account_holder_name: string;
    iban_account_number: string;
    routing_swift: string;
    bank_name?: string;
    bank_country?: string;
    is_verified?: boolean;
    verified_by_admin?: string;
  }): Promise<VendorBankAccountRecord> {
    const query = `
      INSERT INTO vendor_bank_accounts (
        vendor_id, account_holder_name, iban_account_number, routing_swift,
        bank_name, bank_country, is_verified, verified_by_admin
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (vendor_id, iban_account_number)
      DO UPDATE SET
        account_holder_name = EXCLUDED.account_holder_name,
        routing_swift = EXCLUDED.routing_swift,
        bank_name = COALESCE(EXCLUDED.bank_name, vendor_bank_accounts.bank_name),
        bank_country = EXCLUDED.bank_country,
        updated_at = NOW()
      RETURNING *;
    `;

    const values = [
      params.vendor_id,
      params.account_holder_name,
      params.iban_account_number,
      params.routing_swift,
      params.bank_name || null,
      params.bank_country || "US",
      params.is_verified ?? true,
      params.verified_by_admin || "SYSTEM",
    ];

    const res = await DbClient.query(query, values);
    return res.rows[0];
  }

  public static async getBankAccountsByVendor(vendorId: string): Promise<VendorBankAccountRecord[]> {
    const res = await DbClient.query(
      `SELECT * FROM vendor_bank_accounts WHERE vendor_id = $1 ORDER BY created_at DESC;`,
      [vendorId]
    );
    return res.rows;
  }

  public static async getVerifiedBankAccount(
    vendorId: string,
    ibanOrAccountNumber?: string
  ): Promise<VendorBankAccountRecord | null> {
    if (ibanOrAccountNumber) {
      const res = await DbClient.query(
        `SELECT * FROM vendor_bank_accounts 
         WHERE vendor_id = $1 AND iban_account_number = $2 AND is_verified = TRUE LIMIT 1;`,
        [vendorId, ibanOrAccountNumber]
      );
      return res.rows[0] || null;
    }

    const res = await DbClient.query(
      `SELECT * FROM vendor_bank_accounts 
       WHERE vendor_id = $1 AND is_verified = TRUE 
       ORDER BY created_at DESC LIMIT 1;`,
      [vendorId]
    );
    return res.rows[0] || null;
  }

  public static async verifyBankAccount(bankAccountId: string, adminId: string): Promise<VendorBankAccountRecord | null> {
    const res = await DbClient.query(
      `UPDATE vendor_bank_accounts 
       SET is_verified = TRUE, verified_by_admin = $2, updated_at = NOW() 
       WHERE bank_account_id = $1 
       RETURNING *;`,
      [bankAccountId, adminId]
    );
    return res.rows[0] || null;
  }
}
