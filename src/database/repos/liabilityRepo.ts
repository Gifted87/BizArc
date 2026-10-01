import { DbClient } from "../dbClient.js";
import { LiabilityCategory, LiabilityStatus } from "../../types/accounts.js";

export interface LiabilityDbRecord {
  liability_id?: string;
  account_id: string;
  vendor_id: string;
  title: string;
  category: LiabilityCategory;
  amount_usdc: number;
  due_date: Date;
  frequency_cron?: string | null;
  payout_address: `0x${string}`;
  source_po_hash?: string | null;
  source_invoice_hash?: string | null;
  status: LiabilityStatus;
  created_at?: Date;
  updated_at?: Date;
}

export class LiabilityRepo {
  public static async createLiability(
    liability: LiabilityDbRecord
  ): Promise<LiabilityDbRecord> {
    const text = `
      INSERT INTO account_liabilities (
        account_id, vendor_id, title, category, amount_usdc,
        due_date, frequency_cron, payout_address, source_po_hash,
        source_invoice_hash, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *;
    `;
    const values = [
      liability.account_id,
      liability.vendor_id,
      liability.title,
      liability.category,
      liability.amount_usdc,
      liability.due_date,
      liability.frequency_cron || null,
      liability.payout_address.toLowerCase(),
      liability.source_po_hash || null,
      liability.source_invoice_hash || null,
      liability.status || "SCHEDULED",
    ];

    const result = await DbClient.query(text, values);
    const row = result.rows[0];
    return {
      ...row,
      amount_usdc: Number(row.amount_usdc),
    };
  }

  public static async getLiabilityById(
    liabilityId: string
  ): Promise<LiabilityDbRecord | null> {
    const text = `SELECT * FROM account_liabilities WHERE liability_id = $1 LIMIT 1;`;
    const result = await DbClient.query<LiabilityDbRecord>(text, [liabilityId]);
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      ...row,
      amount_usdc: Number(row.amount_usdc),
    };
  }

  public static async getLiabilitiesByAccount(
    accountId: string,
    status?: LiabilityStatus
  ): Promise<LiabilityDbRecord[]> {
    let text = `SELECT * FROM account_liabilities WHERE account_id = $1`;
    const values: any[] = [accountId];
    if (status) {
      text += ` AND status = $2`;
      values.push(status);
    }
    text += ` ORDER BY due_date ASC;`;

    const result = await DbClient.query<LiabilityDbRecord>(text, values);
    return result.rows.map((row) => ({
      ...row,
      amount_usdc: Number(row.amount_usdc),
    }));
  }

  public static async getUpcomingLiabilities(
    windowDays: number,
    accountId?: string
  ): Promise<LiabilityDbRecord[]> {
    let text = `
      SELECT * FROM account_liabilities
      WHERE due_date <= NOW() + ($1 || ' days')::INTERVAL
        AND status IN ('SCHEDULED', 'AWAITING_APPROVAL')
    `;
    const values: any[] = [windowDays];
    if (accountId) {
      text += ` AND account_id = $2`;
      values.push(accountId);
    }
    text += ` ORDER BY due_date ASC;`;

    const result = await DbClient.query<LiabilityDbRecord>(text, values);
    return result.rows.map((row) => ({
      ...row,
      amount_usdc: Number(row.amount_usdc),
    }));
  }

  public static async getLiabilityByInvoiceHash(
    invoiceHash: string
  ): Promise<LiabilityDbRecord | null> {
    const text = `SELECT * FROM account_liabilities WHERE source_invoice_hash = $1 LIMIT 1;`;
    const result = await DbClient.query<LiabilityDbRecord>(text, [invoiceHash]);
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      ...row,
      amount_usdc: Number(row.amount_usdc),
    };
  }

  public static async updateLiabilityStatus(
    liabilityId: string,
    status: LiabilityStatus
  ): Promise<void> {
    const text = `
      UPDATE account_liabilities
      SET status = $1, updated_at = NOW()
      WHERE liability_id = $2;
    `;
    await DbClient.query(text, [status, liabilityId]);
  }
}
