import { DbClient } from "../dbClient.js";

export interface FiatDepositSessionRecord {
  session_id: string;
  account_id: string;
  company_id?: string;
  method: "CARD_ONRAMP" | "FEDWIRE" | "ACH" | "SWIFT";
  amount_usdc: number;
  tracking_memo: string;
  checkout_url?: string | null;
  cli_command?: string | null;
  status: "PENDING" | "CONFIRMED" | "EXPIRED";
  created_at: Date;
  confirmed_at?: Date | null;
}

export class FiatDepositSessionRepo {
  public static async createSession(params: {
    session_id: string;
    account_id: string;
    company_id?: string;
    method: "CARD_ONRAMP" | "FEDWIRE" | "ACH" | "SWIFT";
    amount_usdc: number;
    tracking_memo: string;
    checkout_url?: string | null;
    cli_command?: string | null;
    status?: "PENDING" | "CONFIRMED" | "EXPIRED";
  }): Promise<FiatDepositSessionRecord> {
    const companyId = params.company_id || "default_org";
    const query = `
      INSERT INTO fiat_deposit_sessions (
        session_id, account_id, company_id, method, amount_usdc,
        tracking_memo, checkout_url, cli_command, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *;
    `;

    const values = [
      params.session_id,
      params.account_id,
      companyId,
      params.method,
      params.amount_usdc,
      params.tracking_memo,
      params.checkout_url || null,
      params.cli_command || null,
      params.status || "PENDING",
    ];

    const res = await DbClient.query(query, values);
    return res.rows[0];
  }

  public static async getSessionById(sessionId: string): Promise<FiatDepositSessionRecord | null> {
    const res = await DbClient.query(`SELECT * FROM fiat_deposit_sessions WHERE session_id = $1;`, [sessionId]);
    return res.rows[0] || null;
  }

  public static async getSessionByMemo(trackingMemo: string): Promise<FiatDepositSessionRecord | null> {
    const res = await DbClient.query(
      `SELECT * FROM fiat_deposit_sessions WHERE tracking_memo = $1 AND status = 'PENDING' ORDER BY created_at DESC LIMIT 1;`,
      [trackingMemo]
    );
    return res.rows[0] || null;
  }

  public static async getSessionsByAccount(accountId: string): Promise<FiatDepositSessionRecord[]> {
    const res = await DbClient.query(
      `SELECT * FROM fiat_deposit_sessions WHERE account_id = $1 ORDER BY created_at DESC;`,
      [accountId]
    );
    return res.rows;
  }

  public static async getSessionsByCompany(companyId: string, limit = 50): Promise<FiatDepositSessionRecord[]> {
    const res = await DbClient.query(
      `SELECT * FROM fiat_deposit_sessions WHERE company_id = $1 ORDER BY created_at DESC LIMIT $2;`,
      [companyId, limit]
    );
    return res.rows;
  }

  public static async confirmSession(
    sessionId: string,
    confirmedAt = new Date()
  ): Promise<FiatDepositSessionRecord | null> {
    const res = await DbClient.query(
      `UPDATE fiat_deposit_sessions
       SET status = 'CONFIRMED', confirmed_at = $2
       WHERE session_id = $1
       RETURNING *;`,
      [sessionId, confirmedAt]
    );
    return res.rows[0] || null;
  }
}
