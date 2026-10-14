import { DbClient } from "../dbClient.js";

export interface UserRecord {
  user_id: string;
  email: string;
  password_hash: string;
  full_name: string;
  avatar_url?: string;
  phone_number?: string;
  is_system_admin: boolean;
  mfa_enabled: boolean;
  mfa_secret?: string;
  status: "ACTIVE" | "LOCKED" | "DEACTIVATED";
  created_at?: Date;
  updated_at?: Date;
}

export type SafeUserRecord = Omit<UserRecord, "password_hash" | "mfa_secret">;

export class UserRepo {
  public static toSafeUser(user: UserRecord): SafeUserRecord {
    const { password_hash, mfa_secret, ...safe } = user;
    return safe;
  }

  public static async createUser(data: {
    user_id?: string;
    email: string;
    password_hash: string;
    full_name: string;
    avatar_url?: string;
    phone_number?: string;
    is_system_admin?: boolean;
    mfa_enabled?: boolean;
    mfa_secret?: string;
    status?: "ACTIVE" | "LOCKED" | "DEACTIVATED";
  }): Promise<UserRecord> {
    const userId = data.user_id || `usr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const text = `
      INSERT INTO users (
        user_id, email, password_hash, full_name, avatar_url, phone_number,
        is_system_admin, mfa_enabled, mfa_secret, status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
      RETURNING *;
    `;
    const values = [
      userId,
      data.email.toLowerCase().trim(),
      data.password_hash,
      data.full_name.trim(),
      data.avatar_url || null,
      data.phone_number || null,
      data.is_system_admin || false,
      data.mfa_enabled || false,
      data.mfa_secret || null,
      data.status || "ACTIVE",
    ];

    const result = await DbClient.query<UserRecord>(text, values);
    return result.rows[0];
  }

  public static async getUserById(userId: string): Promise<UserRecord | null> {
    const text = `SELECT * FROM users WHERE user_id = $1 LIMIT 1;`;
    const result = await DbClient.query<UserRecord>(text, [userId]);
    return result.rows[0] || null;
  }

  public static async getUserByEmail(email: string): Promise<UserRecord | null> {
    const text = `SELECT * FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1;`;
    const result = await DbClient.query<UserRecord>(text, [email.trim()]);
    return result.rows[0] || null;
  }

  public static async updatePassword(userId: string, newPasswordHash: string): Promise<boolean> {
    const text = `
      UPDATE users
      SET password_hash = $1, updated_at = NOW()
      WHERE user_id = $2
      RETURNING user_id;
    `;
    const result = await DbClient.query(text, [newPasswordHash, userId]);
    return (result.rowCount ?? 0) > 0;
  }

  public static async updateProfile(
    userId: string,
    updates: { full_name?: string; avatar_url?: string; phone_number?: string }
  ): Promise<UserRecord | null> {
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (updates.full_name !== undefined) {
      fields.push(`full_name = $${idx++}`);
      values.push(updates.full_name.trim());
    }
    if (updates.avatar_url !== undefined) {
      fields.push(`avatar_url = $${idx++}`);
      values.push(updates.avatar_url);
    }
    if (updates.phone_number !== undefined) {
      fields.push(`phone_number = $${idx++}`);
      values.push(updates.phone_number);
    }

    if (fields.length === 0) return this.getUserById(userId);

    fields.push(`updated_at = NOW()`);
    values.push(userId);

    const text = `
      UPDATE users
      SET ${fields.join(", ")}
      WHERE user_id = $${idx}
      RETURNING *;
    `;
    const result = await DbClient.query<UserRecord>(text, values);
    return result.rows[0] || null;
  }

  public static async updateStatus(
    userId: string,
    status: "ACTIVE" | "LOCKED" | "DEACTIVATED"
  ): Promise<boolean> {
    const text = `UPDATE users SET status = $1, updated_at = NOW() WHERE user_id = $2;`;
    const result = await DbClient.query(text, [status, userId]);
    return (result.rowCount ?? 0) > 0;
  }

  public static async setMfa(userId: string, enabled: boolean, secret?: string): Promise<boolean> {
    const text = `
      UPDATE users
      SET mfa_enabled = $1, mfa_secret = $2, updated_at = NOW()
      WHERE user_id = $3;
    `;
    const result = await DbClient.query(text, [enabled, secret || null, userId]);
    return (result.rowCount ?? 0) > 0;
  }
}
