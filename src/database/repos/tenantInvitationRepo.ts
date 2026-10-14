import { DbClient } from "../dbClient.js";
import { TenantRole } from "./tenantMembershipRepo.js";

export interface TenantInvitationRecord {
  invitation_id: string;
  tenant_id: string;
  email: string;
  role: TenantRole;
  invite_token_hash: string;
  invited_by_user_id?: string;
  expires_at: Date;
  status: "PENDING" | "ACCEPTED" | "EXPIRED" | "REVOKED";
  created_at?: Date;
  accepted_at?: Date;
}

export class TenantInvitationRepo {
  public static async createInvitation(data: {
    tenant_id: string;
    email: string;
    role: TenantRole;
    invite_token_hash: string;
    invited_by_user_id?: string;
    expires_at: Date;
  }): Promise<TenantInvitationRecord> {
    const invitationId = `inv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const text = `
      INSERT INTO tenant_invitations (
        invitation_id, tenant_id, email, role, invite_token_hash,
        invited_by_user_id, expires_at, status, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', NOW())
      RETURNING *;
    `;
    const values = [
      invitationId,
      data.tenant_id,
      data.email.toLowerCase().trim(),
      data.role,
      data.invite_token_hash,
      data.invited_by_user_id || null,
      data.expires_at,
    ];
    const result = await DbClient.query<TenantInvitationRecord>(text, values);
    return result.rows[0];
  }

  public static async getByTokenHash(tokenHash: string): Promise<TenantInvitationRecord | null> {
    const text = `
      SELECT * FROM tenant_invitations
      WHERE invite_token_hash = $1
      LIMIT 1;
    `;
    const result = await DbClient.query<TenantInvitationRecord>(text, [tokenHash]);
    return result.rows[0] || null;
  }

  public static async getById(invitationId: string): Promise<TenantInvitationRecord | null> {
    const text = `SELECT * FROM tenant_invitations WHERE invitation_id = $1 LIMIT 1;`;
    const result = await DbClient.query<TenantInvitationRecord>(text, [invitationId]);
    return result.rows[0] || null;
  }

  public static async listPendingForTenant(tenantId: string): Promise<TenantInvitationRecord[]> {
    const text = `
      SELECT * FROM tenant_invitations
      WHERE tenant_id = $1 AND status = 'PENDING' AND expires_at > NOW()
      ORDER BY created_at DESC;
    `;
    const result = await DbClient.query<TenantInvitationRecord>(text, [tenantId]);
    return result.rows;
  }

  public static async acceptInvitation(invitationId: string): Promise<boolean> {
    const text = `
      UPDATE tenant_invitations
      SET status = 'ACCEPTED', accepted_at = NOW()
      WHERE invitation_id = $1 AND status = 'PENDING'
      RETURNING invitation_id;
    `;
    const result = await DbClient.query(text, [invitationId]);
    return (result.rowCount ?? 0) > 0;
  }

  public static async revokeInvitation(invitationId: string, tenantId: string): Promise<boolean> {
    const text = `
      UPDATE tenant_invitations
      SET status = 'REVOKED'
      WHERE invitation_id = $1 AND tenant_id = $2 AND status = 'PENDING'
      RETURNING invitation_id;
    `;
    const result = await DbClient.query(text, [invitationId, tenantId]);
    return (result.rowCount ?? 0) > 0;
  }
}
