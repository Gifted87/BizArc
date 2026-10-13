import { DbClient } from "../dbClient.js";

export type PaymentRailType =
  | "DISBURSAL_VAULT"
  | "MODULAR_SESSION_KEY"
  | "ERC3009_AUTHORIZATION"
  | "GATEWAY_X402"
  | "FIAT_PAYOUT";

export type FiatSubMethodType =
  | "FEDWIRE"
  | "ACH"
  | "PUSH_TO_CARD"
  | "SEPA"
  | "SWIFT";

export interface VendorPaymentPreferenceRecord {
  preference_id: string;
  vendor_id: string;
  preferred_rail: PaymentRailType;
  preferred_sub_method?: FiatSubMethodType | string | null;
  crypto_wallet_address?: string | null;
  crypto_chain_id?: number | null;
  crypto_token_symbol?: string | null;
  bank_account_id?: string | null;
  service_endpoint_url?: string | null;
  session_key_id?: string | null;
  configuration_payload?: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export class VendorPaymentPreferenceRepo {
  public static async setPreference(params: {
    vendor_id: string;
    preferred_rail: PaymentRailType;
    preferred_sub_method?: FiatSubMethodType | string | null;
    crypto_wallet_address?: string | null;
    crypto_chain_id?: number | null;
    crypto_token_symbol?: string | null;
    bank_account_id?: string | null;
    service_endpoint_url?: string | null;
    session_key_id?: string | null;
    configuration_payload?: Record<string, any>;
  }): Promise<VendorPaymentPreferenceRecord> {
    const query = `
      INSERT INTO vendor_payment_preferences (
        vendor_id, preferred_rail, preferred_sub_method,
        crypto_wallet_address, crypto_chain_id, crypto_token_symbol,
        bank_account_id, service_endpoint_url, session_key_id,
        configuration_payload
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (vendor_id)
      DO UPDATE SET
        preferred_rail = EXCLUDED.preferred_rail,
        preferred_sub_method = EXCLUDED.preferred_sub_method,
        crypto_wallet_address = EXCLUDED.crypto_wallet_address,
        crypto_chain_id = EXCLUDED.crypto_chain_id,
        crypto_token_symbol = EXCLUDED.crypto_token_symbol,
        bank_account_id = EXCLUDED.bank_account_id,
        service_endpoint_url = EXCLUDED.service_endpoint_url,
        session_key_id = EXCLUDED.session_key_id,
        configuration_payload = EXCLUDED.configuration_payload,
        updated_at = NOW()
      RETURNING *;
    `;

    const values = [
      params.vendor_id,
      params.preferred_rail,
      params.preferred_sub_method || null,
      params.crypto_wallet_address || null,
      params.crypto_chain_id ?? 5042,
      params.crypto_token_symbol || "USDC",
      params.bank_account_id || null,
      params.service_endpoint_url || null,
      params.session_key_id || null,
      JSON.stringify(params.configuration_payload || {}),
    ];

    const res = await DbClient.query(query, values);
    return res.rows[0];
  }

  public static async getPreference(vendorId: string): Promise<VendorPaymentPreferenceRecord | null> {
    const res = await DbClient.query(
      `SELECT * FROM vendor_payment_preferences WHERE vendor_id = $1 LIMIT 1;`,
      [vendorId]
    );
    return res.rows[0] || null;
  }

  public static async deletePreference(vendorId: string): Promise<boolean> {
    const res = await DbClient.query(
      `DELETE FROM vendor_payment_preferences WHERE vendor_id = $1;`,
      [vendorId]
    );
    return (res.rowCount ?? 0) > 0;
  }
}
