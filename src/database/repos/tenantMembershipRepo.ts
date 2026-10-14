import { DbClient } from "../dbClient.js";

export type TenantRole =
  | "OWNER"
  | "CFO"
  | "TREASURY_OFFICER"
  | "AP_SPECIALIST"
  | "AUDITOR_VIEWER";

export interface TenantMembershipRecord {
  membership_id: string;
  tenant_id: string;
  user_id: string;
  role: TenantRole;
  status: "ACTIVE" | "SUSPENDED";
  joined_at?: Date;
}

export interface TenantMemberDetail extends TenantMembershipRecord {
  email: string;
  full_name: string;
  avatar_url?: string;
}

export class TenantMembershipRepo {
  public static readonly ROLE_PERMISSIONS: Record<TenantRole, string[]> = {
    OWNER: [
      "TENANT_MANAGE",
      "TEAM_MANAGE",
      "API_KEYS_MANAGE",
      "SPRS_DECIDE",
      "SPRS_SIGN",
      "POLICY_MANAGE",
      "TREASURY_MUTATE",
      "ACCOUNTS_MANAGE",
      "YIELD_SWEEP",
      "LIABILITIES_MUTATE",
      "VENDORS_MUTATE",
      "LEDGER_READ",
      "AUDIT_READ",
    ],
    CFO: [
      "SPRS_DECIDE",
      "SPRS_SIGN",
      "POLICY_MANAGE",
      "TREASURY_MUTATE",
      "ACCOUNTS_MANAGE",
      "YIELD_SWEEP",
      "LIABILITIES_MUTATE",
      "VENDORS_MUTATE",
      "LEDGER_READ",
      "AUDIT_READ",
    ],
    TREASURY_OFFICER: [
      "TREASURY_MUTATE",
      "ACCOUNTS_MANAGE",
      "YIELD_SWEEP",
      "LIABILITIES_MUTATE",
      "VENDORS_MUTATE",
      "LEDGER_READ",
      "AUDIT_READ",
    ],
    AP_SPECIALIST: [
      "LIABILITIES_MUTATE",
      "VENDORS_MUTATE",
      "LEDGER_READ",
      "AUDIT_READ",
    ],
    AUDITOR_VIEWER: [
      "LEDGER_READ",
      "AUDIT_READ",
    ],
  };

  public static getPermissionsForRole(role: TenantRole): string[] {
    return this.ROLE_PERMISSIONS[role] || ["LEDGER_READ", "AUDIT_READ"];
  }

  public static async addMember(params: {
    tenant_id: string;
    user_id: string;
    role: TenantRole;
    status?: "ACTIVE" | "SUSPENDED";
  }): Promise<TenantMembershipRecord> {
    const membershipId = `mem_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const text = `
      INSERT INTO tenant_memberships (
        membership_id, tenant_id, user_id, role, status, joined_at
      ) VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (tenant_id, user_id) DO UPDATE SET
        role = EXCLUDED.role,
        status = EXCLUDED.status
      RETURNING *;
    `;
    const values = [
      membershipId,
      params.tenant_id,
      params.user_id,
      params.role,
      params.status || "ACTIVE",
    ];
    const result = await DbClient.query<TenantMembershipRecord>(text, values);
    return result.rows[0];
  }

  public static async getMembership(
    tenantId: string,
    userId: string
  ): Promise<TenantMembershipRecord | null> {
    const text = `
      SELECT * FROM tenant_memberships
      WHERE tenant_id = $1 AND user_id = $2
      LIMIT 1;
    `;
    const result = await DbClient.query<TenantMembershipRecord>(text, [tenantId, userId]);
    return result.rows[0] || null;
  }

  public static async listMembers(tenantId: string): Promise<TenantMemberDetail[]> {
    const text = `
      SELECT m.*, u.email, u.full_name, u.avatar_url
      FROM tenant_memberships m
      JOIN users u ON m.user_id = u.user_id
      WHERE m.tenant_id = $1
      ORDER BY 
        CASE m.role 
          WHEN 'OWNER' THEN 1 
          WHEN 'CFO' THEN 2 
          WHEN 'TREASURY_OFFICER' THEN 3 
          WHEN 'AP_SPECIALIST' THEN 4 
          ELSE 5 
        END,
        m.joined_at ASC;
    `;
    const result = await DbClient.query<TenantMemberDetail>(text, [tenantId]);
    return result.rows;
  }

  public static async updateRole(
    tenantId: string,
    userId: string,
    role: TenantRole
  ): Promise<TenantMembershipRecord | null> {
    const text = `
      UPDATE tenant_memberships
      SET role = $1
      WHERE tenant_id = $2 AND user_id = $3
      RETURNING *;
    `;
    const result = await DbClient.query<TenantMembershipRecord>(text, [role, tenantId, userId]);
    return result.rows[0] || null;
  }

  public static async removeMember(tenantId: string, userId: string): Promise<boolean> {
    const text = `
      DELETE FROM tenant_memberships
      WHERE tenant_id = $1 AND user_id = $2
      RETURNING membership_id;
    `;
    const result = await DbClient.query(text, [tenantId, userId]);
    return (result.rowCount ?? 0) > 0;
  }

  public static async countOwners(tenantId: string): Promise<number> {
    const text = `
      SELECT COUNT(*)::int as count
      FROM tenant_memberships
      WHERE tenant_id = $1 AND role = 'OWNER' AND status = 'ACTIVE';
    `;
    const result = await DbClient.query<{ count: number }>(text, [tenantId]);
    return result.rows[0]?.count ?? 0;
  }
}
