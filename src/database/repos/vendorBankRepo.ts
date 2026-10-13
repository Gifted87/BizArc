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
  payment_sub_method?: "FEDWIRE" | "ACH" | "PUSH_TO_CARD" | "SEPA" | "SWIFT" | string;
  card_last4?: string | null;
  card_token?: string | null;
  card_network?: string | null;
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
    payment_sub_method?: string;
    card_last4?: string | null;
    card_token?: string | null;
    card_network?: string | null;
  }): Promise<VendorBankAccountRecord> {
    const query = `
      INSERT INTO vendor_bank_accounts (
        vendor_id, account_holder_name, iban_account_number, routing_swift,
        bank_name, bank_country, is_verified, verified_by_admin,
        payment_sub_method, card_last4, card_token, card_network
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (vendor_id, iban_account_number)
      DO UPDATE SET
        account_holder_name = EXCLUDED.account_holder_name,
        routing_swift = EXCLUDED.routing_swift,
        bank_name = COALESCE(EXCLUDED.bank_name, vendor_bank_accounts.bank_name),
        bank_country = EXCLUDED.bank_country,
        payment_sub_method = COALESCE(EXCLUDED.payment_sub_method, vendor_bank_accounts.payment_sub_method),
        card_last4 = COALESCE(EXCLUDED.card_last4, vendor_bank_accounts.card_last4),
        card_token = COALESCE(EXCLUDED.card_token, vendor_bank_accounts.card_token),
        card_network = COALESCE(EXCLUDED.card_network, vendor_bank_accounts.card_network),
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
      params.payment_sub_method || "FEDWIRE",
      params.card_last4 || null,
      params.card_token || null,
      params.card_network || null,
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
