import { DbClient } from "../dbClient.js";
import { UserRecord, SafeUserRecord, UserRepo } from "./userRepo.js";
import { TenantRecord } from "./tenantRepo.js";
import { TenantRole, TenantMembershipRepo } from "./tenantMembershipRepo.js";

export interface UserSessionRecord {
  session_id: string;
  user_id: string;
  active_tenant_id: string;
  token_hash: string;
  user_agent?: string;
  ip_address?: string;
  expires_at: Date;
  last_active_at?: Date;
  created_at?: Date;
}

export interface PopulatedSession {
  session: UserSessionRecord;
  user: SafeUserRecord;
  tenant: TenantRecord;
  role: TenantRole;
  permissions: string[];
}

export class UserSessionRepo {
  public static async createSession(data: {
    user_id: string;
    active_tenant_id: string;
    token_hash: string;
    user_agent?: string;
    ip_address?: string;
    expires_at: Date;
  }): Promise<UserSessionRecord> {
    const sessionId = `ses_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const text = `
      INSERT INTO user_sessions (
        session_id, user_id, active_tenant_id, token_hash,
        user_agent, ip_address, expires_at, last_active_at, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      RETURNING *;
    `;
    const values = [
      sessionId,
      data.user_id,
      data.active_tenant_id,
      data.token_hash,
      data.user_agent || null,
      data.ip_address || null,
      data.expires_at,
    ];
    const result = await DbClient.query<UserSessionRecord>(text, values);
    return result.rows[0];
  }

  public static async getPopulatedSessionByTokenHash(
    tokenHash: string
  ): Promise<PopulatedSession | null> {
    const text = `
      SELECT 
        s.*,
        u.email as u_email, u.password_hash as u_password_hash, u.full_name as u_full_name,
        u.avatar_url as u_avatar_url, u.phone_number as u_phone_number,
        u.is_system_admin as u_is_system_admin, u.mfa_enabled as u_mfa_enabled,
        u.status as u_status, u.created_at as u_created_at,
        t.name as t_name, t.slug as t_slug, t.legal_name as t_legal_name,
        t.country as t_country, t.status as t_status, t.settings as t_settings,
        t.created_at as t_created_at,
        m.role as m_role, m.status as m_status
      FROM user_sessions s
      JOIN users u ON s.user_id = u.user_id
      JOIN tenants t ON s.active_tenant_id = t.tenant_id
      JOIN tenant_memberships m ON (m.tenant_id = t.tenant_id AND m.user_id = u.user_id)
      WHERE s.token_hash = $1
        AND s.expires_at > NOW()
        AND u.status = 'ACTIVE'
        AND t.status != 'SUSPENDED'
        AND m.status = 'ACTIVE'
      LIMIT 1;
    `;

    const result = await DbClient.query<any>(text, [tokenHash]);
    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    const session: UserSessionRecord = {
      session_id: row.session_id,
      user_id: row.user_id,
      active_tenant_id: row.active_tenant_id,
      token_hash: row.token_hash,
      user_agent: row.user_agent,
      ip_address: row.ip_address,
      expires_at: row.expires_at,
      last_active_at: row.last_active_at,
      created_at: row.created_at,
    };

    const user: SafeUserRecord = {
      user_id: row.user_id,
      email: row.u_email,
      full_name: row.u_full_name,
      avatar_url: row.u_avatar_url,
      phone_number: row.u_phone_number,
      is_system_admin: row.u_is_system_admin,
      mfa_enabled: row.u_mfa_enabled,
      status: row.u_status,
      created_at: row.u_created_at,
    };

    const tenant: TenantRecord = {
      tenant_id: row.active_tenant_id,
      slug: row.t_slug,
      name: row.t_name,
      legal_name: row.t_legal_name,
      country: row.t_country,
      status: row.t_status,
      settings: typeof row.t_settings === "string" ? JSON.parse(row.t_settings) : row.t_settings,
      created_at: row.t_created_at,
    };

    const role: TenantRole = row.m_role;
    const permissions = TenantMembershipRepo.getPermissionsForRole(role);

    return {
      session,
      user,
      tenant,
      role,
      permissions,
    };
  }

  public static async updateActiveTenant(
    sessionId: string,
    newTenantId: string
  ): Promise<boolean> {
    const text = `
      UPDATE user_sessions
      SET active_tenant_id = $1, last_active_at = NOW()
      WHERE session_id = $2;
    `;
    const result = await DbClient.query(text, [newTenantId, sessionId]);
    return (result.rowCount ?? 0) > 0;
  }

  public static async touchSession(sessionId: string): Promise<void> {
    const text = `UPDATE user_sessions SET last_active_at = NOW() WHERE session_id = $1;`;
    await DbClient.query(text, [sessionId]).catch(() => {});
  }

  public static async revokeSession(tokenHash: string): Promise<boolean> {
    const text = `DELETE FROM user_sessions WHERE token_hash = $1 RETURNING session_id;`;
    const result = await DbClient.query(text, [tokenHash]);
    return (result.rowCount ?? 0) > 0;
  }

  public static async revokeAllUserSessions(userId: string): Promise<number> {
    const text = `DELETE FROM user_sessions WHERE user_id = $1;`;
    const result = await DbClient.query(text, [userId]);
    return result.rowCount ?? 0;
  }
}
