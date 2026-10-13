import { DbClient } from "../dbClient.js";
import { LiabilityCategory, LiabilityStatus } from "../../types/accounts.js";

export interface LiabilityDbRecord {
  liability_id?: string;
  company_id?: string;
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
  preferred_payment_rail?: "DISBURSAL_VAULT" | "MODULAR_SESSION_KEY" | "ERC3009_AUTHORIZATION" | "GATEWAY_X402" | string;
  payment_rail_config?: Record<string, any>;
  disbursal_rules?: Record<string, any>;
  waterfall_override?: Record<string, any> | null;
  created_at?: Date;
  updated_at?: Date;
}

function mapLiabilityRow(row: any): LiabilityDbRecord {
  return {
    ...row,
    company_id: row.company_id || "default_org",
    amount_usdc: Number(row.amount_usdc),
    preferred_payment_rail: row.preferred_payment_rail || "DISBURSAL_VAULT",
    payment_rail_config: typeof row.payment_rail_config === "object" ? row.payment_rail_config : {},
    disbursal_rules: typeof row.disbursal_rules === "object" ? row.disbursal_rules : {
      autoPayThresholdUsdc: 500,
      requireThreeWayMatch: true,
      preFlightLeadTimeHours: 48,
    },
    waterfall_override: row.waterfall_override || null,
  };
}

export class LiabilityRepo {
  public static async createLiability(
    liability: LiabilityDbRecord
  ): Promise<LiabilityDbRecord> {
    const text = `
      INSERT INTO account_liabilities (
        company_id, account_id, vendor_id, title, category, amount_usdc,
        due_date, frequency_cron, payout_address, source_po_hash,
        source_invoice_hash, status, preferred_payment_rail, payment_rail_config,
        disbursal_rules, waterfall_override
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *;
    `;
    const values = [
      liability.company_id || "default_org",
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
      liability.preferred_payment_rail || "DISBURSAL_VAULT",
      JSON.stringify(liability.payment_rail_config || {}),
      JSON.stringify(liability.disbursal_rules || {
        autoPayThresholdUsdc: 500,
        requireThreeWayMatch: true,
        preFlightLeadTimeHours: 48,
      }),
      liability.waterfall_override ? JSON.stringify(liability.waterfall_override) : null,
    ];

    const result = await DbClient.query(text, values);
    return mapLiabilityRow(result.rows[0]);
  }

  public static async getLiabilityById(
    liabilityId: string
  ): Promise<LiabilityDbRecord | null> {
    const text = `SELECT * FROM account_liabilities WHERE liability_id = $1 LIMIT 1;`;
    const result = await DbClient.query(text, [liabilityId]);
    if (result.rows.length === 0) return null;
    return mapLiabilityRow(result.rows[0]);
  }

  public static async getLiabilityByIdAndCompany(
    liabilityId: string,
    companyId: string
  ): Promise<LiabilityDbRecord | null> {
    const text = `SELECT * FROM account_liabilities WHERE liability_id = $1 AND company_id = $2 LIMIT 1;`;
    const result = await DbClient.query(text, [liabilityId, companyId]);
    if (result.rows.length === 0) return null;
    return mapLiabilityRow(result.rows[0]);
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

    const result = await DbClient.query(text, values);
    return result.rows.map(mapLiabilityRow);
  }

  public static async getLiabilitiesByCompany(
    companyId: string,
    filter?: { accountId?: string; status?: LiabilityStatus }
  ): Promise<LiabilityDbRecord[]> {
    let text = `SELECT * FROM account_liabilities WHERE company_id = $1`;
    const values: any[] = [companyId];
    if (filter?.accountId) {
      values.push(filter.accountId);
      text += ` AND account_id = $${values.length}`;
    }
    if (filter?.status) {
      values.push(filter.status);
      text += ` AND status = $${values.length}`;
    }
    text += ` ORDER BY due_date ASC;`;

    const result = await DbClient.query(text, values);
    return result.rows.map(mapLiabilityRow);
  }

  public static async getUpcomingLiabilities(
    windowDays: number,
    accountId?: string,
    companyId?: string
  ): Promise<LiabilityDbRecord[]> {
    let text = `
      SELECT * FROM account_liabilities
      WHERE due_date <= NOW() + ($1 || ' days')::INTERVAL
        AND status IN ('SCHEDULED', 'AWAITING_APPROVAL')
    `;
    const values: any[] = [windowDays];
    if (accountId) {
      values.push(accountId);
      text += ` AND account_id = $${values.length}`;
    }
    if (companyId) {
      values.push(companyId);
      text += ` AND company_id = $${values.length}`;
    }
    text += ` ORDER BY due_date ASC;`;

    const result = await DbClient.query(text, values);
    return result.rows.map(mapLiabilityRow);
  }

  public static async getLiabilityByInvoiceHash(
    invoiceHash: string
  ): Promise<LiabilityDbRecord | null> {
    const text = `SELECT * FROM account_liabilities WHERE source_invoice_hash = $1 LIMIT 1;`;
    const result = await DbClient.query(text, [invoiceHash]);
    if (result.rows.length === 0) return null;
    return mapLiabilityRow(result.rows[0]);
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

  public static async updateLiability(
    liabilityId: string,
    companyId: string,
    updates: Partial<LiabilityDbRecord>
  ): Promise<LiabilityDbRecord | null> {
    const fields: string[] = [];
    const values: any[] = [liabilityId, companyId];

    if (updates.account_id !== undefined) {
      values.push(updates.account_id);
      fields.push(`account_id = $${values.length}`);
    }
    if (updates.vendor_id !== undefined) {
      values.push(updates.vendor_id);
      fields.push(`vendor_id = $${values.length}`);
    }
    if (updates.title !== undefined) {
      values.push(updates.title);
      fields.push(`title = $${values.length}`);
    }
    if (updates.category !== undefined) {
      values.push(updates.category);
      fields.push(`category = $${values.length}`);
    }
    if (updates.amount_usdc !== undefined) {
      values.push(updates.amount_usdc);
      fields.push(`amount_usdc = $${values.length}`);
    }
    if (updates.due_date !== undefined) {
      values.push(updates.due_date);
      fields.push(`due_date = $${values.length}`);
    }
    if (updates.frequency_cron !== undefined) {
      values.push(updates.frequency_cron);
      fields.push(`frequency_cron = $${values.length}`);
    }
    if (updates.payout_address !== undefined) {
      values.push(updates.payout_address.toLowerCase());
      fields.push(`payout_address = $${values.length}`);
    }
    if (updates.status !== undefined) {
      values.push(updates.status);
      fields.push(`status = $${values.length}`);
    }
    if (updates.preferred_payment_rail !== undefined) {
      values.push(updates.preferred_payment_rail);
      fields.push(`preferred_payment_rail = $${values.length}`);
    }
    if (updates.payment_rail_config !== undefined) {
      values.push(JSON.stringify(updates.payment_rail_config));
      fields.push(`payment_rail_config = $${values.length}`);
    }
    if (updates.disbursal_rules !== undefined) {
      values.push(JSON.stringify(updates.disbursal_rules));
      fields.push(`disbursal_rules = $${values.length}`);
    }
    if (updates.waterfall_override !== undefined) {
      values.push(updates.waterfall_override ? JSON.stringify(updates.waterfall_override) : null);
      fields.push(`waterfall_override = $${values.length}`);
    }

    if (fields.length === 0) {
      return this.getLiabilityByIdAndCompany(liabilityId, companyId);
    }

    fields.push("updated_at = NOW()");

    const text = `
      UPDATE account_liabilities
      SET ${fields.join(", ")}
      WHERE liability_id = $1 AND company_id = $2
      RETURNING *;
    `;

    const result = await DbClient.query(text, values);
    if (result.rows.length === 0) return null;
    return mapLiabilityRow(result.rows[0]);
  }
}
