import { DbClient } from "../dbClient.js";

export interface Erc3009Record {
  nonce: string;
  from_address: string;
  to_address: string;
  amount_raw: string;
  valid_after: number;
  valid_before: number;
  intent_id: string | null;
  tx_hash: string | null;
  executed_at: Date;
}

export class Erc3009Repo {
  public static async isNonceExecuted(nonce: string): Promise<boolean> {
    const res = await DbClient.query(
      `SELECT 1 FROM erc3009_authorizations WHERE LOWER(nonce) = LOWER($1);`,
      [nonce]
    );
    return res.rows.length > 0;
  }

  public static async recordExecution(params: {
    nonce: string;
    fromAddress: string;
    toAddress: string;
    amountRaw: bigint;
    validAfter: number;
    validBefore: number;
    intentId?: string;
    txHash?: string;
  }): Promise<void> {
    await DbClient.query(
      `INSERT INTO erc3009_authorizations 
        (nonce, from_address, to_address, amount_raw, valid_after, valid_before, intent_id, tx_hash, executed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (nonce) DO NOTHING;`,
      [
        params.nonce.toLowerCase(),
        params.fromAddress.toLowerCase(),
        params.toAddress.toLowerCase(),
        params.amountRaw.toString(),
        params.validAfter,
        params.validBefore,
        params.intentId || null,
        params.txHash || null,
      ]
    );
  }

  public static async getAuthorizationByNonce(nonce: string): Promise<Erc3009Record | null> {
    const res = await DbClient.query(
      `SELECT nonce, from_address, to_address, amount_raw, valid_after, valid_before, intent_id, tx_hash, executed_at
       FROM erc3009_authorizations
       WHERE LOWER(nonce) = LOWER($1);`,
      [nonce]
    );
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      nonce: r.nonce,
      from_address: r.from_address,
      to_address: r.to_address,
      amount_raw: r.amount_raw,
      valid_after: Number(r.valid_after),
      valid_before: Number(r.valid_before),
      intent_id: r.intent_id,
      tx_hash: r.tx_hash,
      executed_at: new Date(r.executed_at),
    };
  }
}
