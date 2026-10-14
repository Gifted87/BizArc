import { DbClient } from "../dbClient.js";

export interface TokenSwapRecord {
  swap_id: string;
  account_id: string;
  company_id?: string;
  from_chain: string;
  from_token: string;
  to_chain: string;
  to_token: string;
  from_amount: number;
  to_amount: number;
  realized_rate: number;
  slippage_bps: number;
  tx_hash?: string | null;
  status: "COMPLETED" | "PENDING" | "REJECTED_BY_POLICY" | "FAILED";
  route_aggregator: string;
  created_at: Date;
}

export class TokenSwapRepo {
  public static async recordSwap(params: {
    swap_id: string;
    account_id: string;
    company_id?: string;
    from_chain: string;
    from_token: string;
    to_chain: string;
    to_token: string;
    from_amount: number;
    to_amount: number;
    realized_rate: number;
    slippage_bps?: number;
    tx_hash?: string | null;
    status?: "COMPLETED" | "PENDING" | "REJECTED_BY_POLICY" | "FAILED";
    route_aggregator?: string;
  }): Promise<TokenSwapRecord> {
    const companyId = params.company_id || "default_org";
    const query = `
      INSERT INTO token_swap_records (
        swap_id, account_id, company_id, from_chain, from_token, to_chain, to_token,
        from_amount, to_amount, realized_rate, slippage_bps, tx_hash,
        status, route_aggregator
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *;
    `;

    const values = [
      params.swap_id,
      params.account_id,
      companyId,
      params.from_chain,
      params.from_token,
      params.to_chain,
      params.to_token,
      params.from_amount,
      params.to_amount,
      params.realized_rate,
      params.slippage_bps ?? 50,
      params.tx_hash || null,
      params.status || "COMPLETED",
      params.route_aggregator || "LiFi",
    ];

    const res = await DbClient.query(query, values);
    return res.rows[0];
  }

  public static async getSwapById(swapId: string): Promise<TokenSwapRecord | null> {
    const res = await DbClient.query(`SELECT * FROM token_swap_records WHERE swap_id = $1;`, [swapId]);
    return res.rows[0] || null;
  }

  public static async getSwapsByAccount(accountId: string): Promise<TokenSwapRecord[]> {
    const res = await DbClient.query(
      `SELECT * FROM token_swap_records WHERE account_id = $1 ORDER BY created_at DESC;`,
      [accountId]
    );
    return res.rows;
  }

  public static async getSwapsByCompany(companyId: string, limit = 50): Promise<TokenSwapRecord[]> {
    const res = await DbClient.query(
      `SELECT * FROM token_swap_records WHERE company_id = $1 ORDER BY created_at DESC LIMIT $2;`,
      [companyId, limit]
    );
    return res.rows;
  }
}
