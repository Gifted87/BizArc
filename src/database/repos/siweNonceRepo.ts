import { DbClient } from "../dbClient.js";

export interface SiweNonceRecord {
  address: string;
  nonce: string;
  message: string;
  issued_at: Date;
  expires_at: Date;
}

export class SiweNonceRepo {
  public static async saveNonce(address: string, nonce: string, message: string, ttlMs: number = 300000): Promise<void> {
    const expiresAt = new Date(Date.now() + ttlMs);
    const text = `
      INSERT INTO siwe_nonces (address, nonce, message, issued_at, expires_at)
      VALUES ($1, $2, $3, NOW(), $4)
      ON CONFLICT (address) DO UPDATE SET
        nonce = EXCLUDED.nonce,
        message = EXCLUDED.message,
        issued_at = NOW(),
        expires_at = EXCLUDED.expires_at;
    `;
    await DbClient.query(text, [address.toLowerCase(), nonce, message, expiresAt]);
  }

  public static async getNonce(address: string): Promise<SiweNonceRecord | null> {
    const text = `
      SELECT address, nonce, message, issued_at, expires_at
      FROM siwe_nonces
      WHERE address = $1 AND expires_at > NOW()
      LIMIT 1;
    `;
    const res = await DbClient.query(text, [address.toLowerCase()]);
    return res.rows.length > 0 ? res.rows[0] : null;
  }

  public static async consumeNonce(address: string): Promise<void> {
    const text = `
      DELETE FROM siwe_nonces
      WHERE address = $1;
    `;
    await DbClient.query(text, [address.toLowerCase()]);
  }
}
