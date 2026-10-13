import { DbClient } from "../dbClient.js";
import { AccountRole } from "../../types/policy.js";

export interface TreasuryAccountRecord {
  account_id: string;
  company_id?: string;
  name: string;
  role: AccountRole;
  wallet_address: `0x${string}`;
  chain_id: number;
  min_operating_floor_usdc: number;
  safety_buffer_ratio: number;
  is_active: boolean;
  per_tx_cap_usdc?: number;
  daily_cap_usdc?: number;
  weekly_cap_usdc?: number;
  monthly_cap_usdc?: number;
  authorized_categories?: string[];
  max_autonomous_sweep_usdc?: number;
  exclude_from_waterfall?: boolean;
  account_declared_policies?: Record<string, any>;
  created_at?: Date;
}

function mapRow(row: any): TreasuryAccountRecord {
  return {
    ...row,
    company_id: row.company_id || "default_org",
    min_operating_floor_usdc: Number(row.min_operating_floor_usdc),
    safety_buffer_ratio: Number(row.safety_buffer_ratio),
    per_tx_cap_usdc: row.per_tx_cap_usdc !== undefined ? Number(row.per_tx_cap_usdc) : 500.0,
    daily_cap_usdc: row.daily_cap_usdc !== undefined ? Number(row.daily_cap_usdc) : 5000.0,
    weekly_cap_usdc: row.weekly_cap_usdc !== undefined ? Number(row.weekly_cap_usdc) : 25000.0,
    monthly_cap_usdc: row.monthly_cap_usdc !== undefined ? Number(row.monthly_cap_usdc) : 100000.0,
    max_autonomous_sweep_usdc:
      row.max_autonomous_sweep_usdc !== undefined && row.max_autonomous_sweep_usdc !== null
        ? Number(row.max_autonomous_sweep_usdc)
        : (row.role === "PAYROLL" ? 0.0 : 1000.0),
    exclude_from_waterfall:
      row.exclude_from_waterfall !== undefined && row.exclude_from_waterfall !== null
        ? Boolean(row.exclude_from_waterfall)
        : (row.role === "PAYROLL" ? true : false),
    authorized_categories: Array.isArray(row.authorized_categories) ? row.authorized_categories : [],
    account_declared_policies: typeof row.account_declared_policies === "object" ? row.account_declared_policies : {},
  };
}

export class TreasuryAccountsRepo {
  public static async upsertAccount(
    account: TreasuryAccountRecord
  ): Promise<TreasuryAccountRecord> {
    const text = `
      INSERT INTO treasury_accounts (
        account_id, company_id, name, role, wallet_address, chain_id,
        min_operating_floor_usdc, safety_buffer_ratio, is_active,
        per_tx_cap_usdc, daily_cap_usdc, weekly_cap_usdc, monthly_cap_usdc,
        authorized_categories, max_autonomous_sweep_usdc, exclude_from_waterfall,
        account_declared_policies
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      ON CONFLICT (account_id) DO UPDATE SET
        company_id = EXCLUDED.company_id,
        name = EXCLUDED.name,
        role = EXCLUDED.role,
        wallet_address = EXCLUDED.wallet_address,
        chain_id = EXCLUDED.chain_id,
        min_operating_floor_usdc = EXCLUDED.min_operating_floor_usdc,
        safety_buffer_ratio = EXCLUDED.safety_buffer_ratio,
        is_active = EXCLUDED.is_active,
        per_tx_cap_usdc = EXCLUDED.per_tx_cap_usdc,
        daily_cap_usdc = EXCLUDED.daily_cap_usdc,
        weekly_cap_usdc = EXCLUDED.weekly_cap_usdc,
        monthly_cap_usdc = EXCLUDED.monthly_cap_usdc,
        authorized_categories = EXCLUDED.authorized_categories,
        max_autonomous_sweep_usdc = EXCLUDED.max_autonomous_sweep_usdc,
        exclude_from_waterfall = EXCLUDED.exclude_from_waterfall,
        account_declared_policies = EXCLUDED.account_declared_policies
      RETURNING *;
    `;
    const values = [
      account.account_id,
      account.company_id || "default_org",
      account.name,
      account.role,
      account.wallet_address.toLowerCase(),
      account.chain_id,
      account.min_operating_floor_usdc,
      account.safety_buffer_ratio,
      account.is_active,
      account.per_tx_cap_usdc ?? 500.0,
      account.daily_cap_usdc ?? 5000.0,
      account.weekly_cap_usdc ?? 25000.0,
      account.monthly_cap_usdc ?? 100000.0,
      JSON.stringify(account.authorized_categories || []),
      account.max_autonomous_sweep_usdc ?? (account.role === "PAYROLL" ? 0.0 : 1000.0),
      account.exclude_from_waterfall ?? (account.role === "PAYROLL" ? true : false),
      JSON.stringify(account.account_declared_policies || {}),
    ];

    const result = await DbClient.query(text, values);
    return mapRow(result.rows[0]);
  }

  public static async getAccountById(
    accountId: string
  ): Promise<TreasuryAccountRecord | null> {
    const text = `SELECT * FROM treasury_accounts WHERE account_id = $1 LIMIT 1;`;
    const result = await DbClient.query(text, [accountId]);
    if (result.rows.length === 0) return null;
    return mapRow(result.rows[0]);
  }

  public static async getAccountByIdAndCompany(
    accountId: string,
    companyId: string
  ): Promise<TreasuryAccountRecord | null> {
    const text = `SELECT * FROM treasury_accounts WHERE account_id = $1 AND company_id = $2 LIMIT 1;`;
    const result = await DbClient.query(text, [accountId, companyId]);
    if (result.rows.length === 0) return null;
    return mapRow(result.rows[0]);
  }

  public static async getAccountByWallet(
    walletAddress: string
  ): Promise<TreasuryAccountRecord | null> {
    const text = `SELECT * FROM treasury_accounts WHERE LOWER(wallet_address) = LOWER($1) LIMIT 1;`;
    const result = await DbClient.query(text, [walletAddress]);
    if (result.rows.length === 0) return null;
    return mapRow(result.rows[0]);
  }

  public static async getAllAccounts(): Promise<TreasuryAccountRecord[]> {
    const text = `SELECT * FROM treasury_accounts ORDER BY account_id ASC;`;
    const result = await DbClient.query(text);
    return result.rows.map(mapRow);
  }

  public static async getAccountsByCompany(companyId: string): Promise<TreasuryAccountRecord[]> {
    const text = `SELECT * FROM treasury_accounts WHERE company_id = $1 ORDER BY account_id ASC;`;
    const result = await DbClient.query(text, [companyId]);
    return result.rows.map(mapRow);
  }

  public static async updateAccountFloor(
    accountId: string,
    minOperatingFloorUsdc: number,
    safetyBufferRatio: number
  ): Promise<void> {
    const text = `
      UPDATE treasury_accounts
      SET min_operating_floor_usdc = $1, safety_buffer_ratio = $2
      WHERE account_id = $3;
    `;
    await DbClient.query(text, [minOperatingFloorUsdc, safetyBufferRatio, accountId]);
  }

  public static async setAccountActive(
    accountId: string,
    isActive: boolean
  ): Promise<void> {
    const text = `
      UPDATE treasury_accounts
      SET is_active = $1
      WHERE account_id = $2;
    `;
    await DbClient.query(text, [isActive, accountId]);
  }
}
