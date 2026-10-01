import { DbClient } from "../dbClient.js";
import { AccountRole } from "../../types/policy.js";

export interface TreasuryAccountRecord {
  account_id: string;
  name: string;
  role: AccountRole;
  wallet_address: `0x${string}`;
  chain_id: number;
  min_operating_floor_usdc: number;
  safety_buffer_ratio: number;
  is_active: boolean;
  created_at?: Date;
}

export class TreasuryAccountsRepo {
  public static async upsertAccount(
    account: TreasuryAccountRecord
  ): Promise<TreasuryAccountRecord> {
    const text = `
      INSERT INTO treasury_accounts (
        account_id, name, role, wallet_address, chain_id,
        min_operating_floor_usdc, safety_buffer_ratio, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (account_id) DO UPDATE SET
        name = EXCLUDED.name,
        role = EXCLUDED.role,
        wallet_address = EXCLUDED.wallet_address,
        chain_id = EXCLUDED.chain_id,
        min_operating_floor_usdc = EXCLUDED.min_operating_floor_usdc,
        safety_buffer_ratio = EXCLUDED.safety_buffer_ratio,
        is_active = EXCLUDED.is_active
      RETURNING *;
    `;
    const values = [
      account.account_id,
      account.name,
      account.role,
      account.wallet_address.toLowerCase(),
      account.chain_id,
      account.min_operating_floor_usdc,
      account.safety_buffer_ratio,
      account.is_active,
    ];

    const result = await DbClient.query<TreasuryAccountRecord>(text, values);
    const row = result.rows[0];
    return {
      ...row,
      min_operating_floor_usdc: Number(row.min_operating_floor_usdc),
      safety_buffer_ratio: Number(row.safety_buffer_ratio),
    };
  }

  public static async getAccountById(
    accountId: string
  ): Promise<TreasuryAccountRecord | null> {
    const text = `SELECT * FROM treasury_accounts WHERE account_id = $1 LIMIT 1;`;
    const result = await DbClient.query<TreasuryAccountRecord>(text, [accountId]);
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      ...row,
      min_operating_floor_usdc: Number(row.min_operating_floor_usdc),
      safety_buffer_ratio: Number(row.safety_buffer_ratio),
    };
  }

  public static async getAccountByWallet(
    walletAddress: string
  ): Promise<TreasuryAccountRecord | null> {
    const text = `SELECT * FROM treasury_accounts WHERE LOWER(wallet_address) = LOWER($1) LIMIT 1;`;
    const result = await DbClient.query<TreasuryAccountRecord>(text, [walletAddress]);
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      ...row,
      min_operating_floor_usdc: Number(row.min_operating_floor_usdc),
      safety_buffer_ratio: Number(row.safety_buffer_ratio),
    };
  }

  public static async getAllAccounts(): Promise<TreasuryAccountRecord[]> {
    const text = `SELECT * FROM treasury_accounts ORDER BY account_id ASC;`;
    const result = await DbClient.query<TreasuryAccountRecord>(text);
    return result.rows.map((row) => ({
      ...row,
      min_operating_floor_usdc: Number(row.min_operating_floor_usdc),
      safety_buffer_ratio: Number(row.safety_buffer_ratio),
    }));
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
