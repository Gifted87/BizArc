import { DbClient } from "../dbClient.js";

export interface AccountAuditLogRecord {
  log_id?: string;
  account_id: string;
  company_id?: string;
  timestamp?: Date;
  action_type: string;
  amount_usdc: number;
  is_autonomous: boolean;
  permission_request_id?: string | null;
  tx_hash?: string | null;
  counterparty_address?: string | null;
  reason: string;
  pre_state_snapshot: Record<string, any>;
  post_state_snapshot: Record<string, any>;
  actor_agent: string;
}

export class AuditLogRepo {
  public static async appendAuditLog(
    entry: AccountAuditLogRecord
  ): Promise<AccountAuditLogRecord> {
    const companyId = entry.company_id || "default_org";
    const text = `
      INSERT INTO account_agent_audit_log (
        account_id, company_id, action_type, amount_usdc, is_autonomous,
        permission_request_id, tx_hash, counterparty_address,
        reason, pre_state_snapshot, post_state_snapshot, actor_agent
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *;
    `;
    const values = [
      entry.account_id,
      companyId,
      entry.action_type,
      entry.amount_usdc,
      entry.is_autonomous,
      entry.permission_request_id || null,
      entry.tx_hash || null,
      entry.counterparty_address ? entry.counterparty_address.toLowerCase() : null,
      entry.reason,
      JSON.stringify(entry.pre_state_snapshot || {}),
      JSON.stringify(entry.post_state_snapshot || {}),
      entry.actor_agent,
    ];

    const result = await DbClient.query(text, values);
    const row = result.rows[0];
    return {
      ...row,
      amount_usdc: Number(row.amount_usdc),
    };
  }

  public static async getAuditLogsByAccount(
    accountId: string,
    limit = 50
  ): Promise<AccountAuditLogRecord[]> {
    const text = `
      SELECT * FROM account_agent_audit_log
      WHERE account_id = $1
      ORDER BY timestamp DESC
      LIMIT $2;
    `;
    const result = await DbClient.query(text, [accountId, limit]);
    return result.rows.map((row) => ({
      ...row,
      amount_usdc: Number(row.amount_usdc),
    }));
  }

  public static async getAuditLogsByCompany(
    companyId: string,
    limit = 50
  ): Promise<AccountAuditLogRecord[]> {
    const text = `
      SELECT * FROM account_agent_audit_log
      WHERE company_id = $1
      ORDER BY timestamp DESC
      LIMIT $2;
    `;
    const result = await DbClient.query(text, [companyId, limit]);
    return result.rows.map((row) => ({
      ...row,
      amount_usdc: Number(row.amount_usdc),
    }));
  }

  public static async getAllAuditLogs(limit = 100): Promise<AccountAuditLogRecord[]> {
    const text = `
      SELECT * FROM account_agent_audit_log
      ORDER BY timestamp DESC
      LIMIT $1;
    `;
    const result = await DbClient.query(text, [limit]);
    return result.rows.map((row) => ({
      ...row,
      amount_usdc: Number(row.amount_usdc),
    }));
  }
}
