import { DbClient } from "../dbClient.js";

export interface SessionKeyRecord {
  session_key_id: string;
  account_id: string;
  allowed_recipient: string;
  max_amount_per_cycle_usdc: number;
  cycle_duration_seconds: number;
  current_cycle_spent_usdc: number;
  valid_until_timestamp: number;
  last_executed_timestamp?: number | null;
  public_key_hex: string;
  is_active: boolean;
  created_at?: Date;
  updated_at?: Date;
}

export class SessionKeyRepo {
  public static async upsertSessionKey(key: SessionKeyRecord): Promise<SessionKeyRecord> {
    const text = `
      INSERT INTO session_key_registry (
        session_key_id, account_id, allowed_recipient, max_amount_per_cycle_usdc,
        cycle_duration_seconds, current_cycle_spent_usdc, valid_until_timestamp,
        last_executed_timestamp, public_key_hex, is_active, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      ON CONFLICT (session_key_id) DO UPDATE SET
        max_amount_per_cycle_usdc = EXCLUDED.max_amount_per_cycle_usdc,
        current_cycle_spent_usdc = EXCLUDED.current_cycle_spent_usdc,
        valid_until_timestamp = EXCLUDED.valid_until_timestamp,
        last_executed_timestamp = EXCLUDED.last_executed_timestamp,
        is_active = EXCLUDED.is_active,
        updated_at = NOW()
      RETURNING *;
    `;
    const values = [
      key.session_key_id,
      key.account_id,
      key.allowed_recipient.toLowerCase(),
      key.max_amount_per_cycle_usdc,
      key.cycle_duration_seconds,
      key.current_cycle_spent_usdc || 0,
      key.valid_until_timestamp,
      key.last_executed_timestamp || null,
      key.public_key_hex,
      key.is_active ?? true,
    ];

    const res = await DbClient.query<SessionKeyRecord>(text, values);
    const row = res.rows[0];
    return {
      ...row,
      max_amount_per_cycle_usdc: Number(row.max_amount_per_cycle_usdc),
      current_cycle_spent_usdc: Number(row.current_cycle_spent_usdc),
      valid_until_timestamp: Number(row.valid_until_timestamp),
      last_executed_timestamp: row.last_executed_timestamp ? Number(row.last_executed_timestamp) : null,
    };
  }

  public static async getSessionKeyById(keyId: string): Promise<SessionKeyRecord | null> {
    const text = `SELECT * FROM session_key_registry WHERE session_key_id = $1 LIMIT 1;`;
    const res = await DbClient.query<SessionKeyRecord>(text, [keyId]);
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      ...row,
      max_amount_per_cycle_usdc: Number(row.max_amount_per_cycle_usdc),
      current_cycle_spent_usdc: Number(row.current_cycle_spent_usdc),
      valid_until_timestamp: Number(row.valid_until_timestamp),
      last_executed_timestamp: row.last_executed_timestamp ? Number(row.last_executed_timestamp) : null,
    };
  }

  public static async recordExecution(
    keyId: string,
    amountUsdc: number,
    timestampSec: number
  ): Promise<void> {
    const text = `
      UPDATE session_key_registry
      SET current_cycle_spent_usdc = current_cycle_spent_usdc + $2,
          last_executed_timestamp = $3,
          updated_at = NOW()
      WHERE session_key_id = $1;
    `;
    await DbClient.query(text, [keyId, amountUsdc, timestampSec]);
  }
}
