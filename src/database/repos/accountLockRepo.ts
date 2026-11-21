import { DbClient } from "../dbClient.js";

export interface AccountLockRecord {
  account_id: string;
  locked_at: Date;
  expires_at: Date;
  reason: string | null;
}

export class AccountLockRepo {
  public static async acquireLock(accountId: string, reason: string, timeoutMs: number = 60000): Promise<boolean> {
    const expiresAt = new Date(Date.now() + timeoutMs);
    const deleteExpiredText = `
      DELETE FROM account_locks
      WHERE account_id = $1 AND expires_at <= NOW();
    `;
    await DbClient.query(deleteExpiredText, [accountId]);

    const insertText = `
      INSERT INTO account_locks (account_id, locked_at, expires_at, reason)
      VALUES ($1, NOW(), $2, $3)
      ON CONFLICT (account_id) DO NOTHING
      RETURNING *;
    `;
    const res = await DbClient.query(insertText, [accountId, expiresAt, reason]);
    return res.rows.length > 0;
  }

  public static async releaseLock(accountId: string): Promise<void> {
    const text = `
      DELETE FROM account_locks
      WHERE account_id = $1;
    `;
    await DbClient.query(text, [accountId]);
  }

  public static async isLocked(accountId: string): Promise<boolean> {
    const text = `
      SELECT 1 FROM account_locks
      WHERE account_id = $1 AND expires_at > NOW()
      LIMIT 1;
    `;
    const res = await DbClient.query(text, [accountId]);
    return res.rows.length > 0;
  }

  public static async clearAll(): Promise<void> {
    await DbClient.query(`DELETE FROM account_locks;`);
  }
}
