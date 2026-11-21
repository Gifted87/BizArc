import { DbClient } from "../dbClient.js";

export interface IdempotencyRecord {
  idempotency_key: string;
  rail: string | null;
  actor_agent: string | null;
  status: string;
  response_payload: any;
  created_at: Date;
  expires_at: Date | null;
}

export class IdempotencyRepo {
  public static async isKeyExecuted(key: string): Promise<boolean> {
    const text = `
      SELECT 1 FROM idempotency_records
      WHERE idempotency_key = $1
      LIMIT 1;
    `;
    const res = await DbClient.query(text, [key]);
    return res.rows.length > 0;
  }

  public static async recordExecution(params: {
    key: string;
    rail?: string;
    actorAgent?: string;
    status?: string;
    responsePayload?: any;
    ttlSeconds?: number;
  }): Promise<boolean> {
    const { key, rail, actorAgent, status = "CONFIRMED", responsePayload, ttlSeconds } = params;
    const expiresAt = ttlSeconds ? new Date(Date.now() + ttlSeconds * 1000) : null;

    const text = `
      INSERT INTO idempotency_records (
        idempotency_key, rail, actor_agent, status, response_payload, created_at, expires_at
      ) VALUES ($1, $2, $3, $4, $5, NOW(), $6)
      ON CONFLICT (idempotency_key) DO UPDATE SET
        status = EXCLUDED.status,
        response_payload = EXCLUDED.response_payload
      RETURNING *;
    `;
    const res = await DbClient.query(text, [
      key,
      rail || null,
      actorAgent || null,
      status,
      responsePayload ? JSON.stringify(responsePayload) : null,
      expiresAt,
    ]);
    return res.rows.length > 0;
  }

  public static async getRecord(key: string): Promise<IdempotencyRecord | null> {
    const text = `
      SELECT * FROM idempotency_records
      WHERE idempotency_key = $1
      LIMIT 1;
    `;
    const res = await DbClient.query(text, [key]);
    return res.rows.length > 0 ? res.rows[0] : null;
  }
}
