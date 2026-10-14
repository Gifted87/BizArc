import { DbClient } from "../dbClient.js";

export interface TenantRecord {
  tenant_id: string;
  slug: string;
  name: string;
  legal_name?: string;
  country?: string;
  status: "PENDING_ONBOARDING" | "ACTIVE" | "SUSPENDED";
  settings: {
    baseCurrency?: string;
    requireMfa?: boolean;
    defaultReserveRatio?: number;
    [key: string]: any;
  };
  created_at?: Date;
  updated_at?: Date;
}

export class TenantRepo {
  public static async createTenant(tenant: {
    tenant_id?: string;
    slug: string;
    name: string;
    legal_name?: string;
    country?: string;
    status?: "PENDING_ONBOARDING" | "ACTIVE" | "SUSPENDED";
    settings?: Record<string, any>;
  }): Promise<TenantRecord> {
    const tenantId = tenant.tenant_id || `org_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const text = `
      INSERT INTO tenants (
        tenant_id, slug, name, legal_name, country, status, settings, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
      RETURNING *;
    `;
    const values = [
      tenantId,
      tenant.slug.toLowerCase().trim(),
      tenant.name.trim(),
      tenant.legal_name || tenant.name.trim(),
      tenant.country || "US",
      tenant.status || "ACTIVE",
      JSON.stringify(tenant.settings || { baseCurrency: "USDC", requireMfa: false, defaultReserveRatio: 1.2 }),
    ];
    const result = await DbClient.query<TenantRecord>(text, values);
    return result.rows[0];
  }

  public static async getTenantById(tenantId: string): Promise<TenantRecord | null> {
    const text = `SELECT * FROM tenants WHERE tenant_id = $1 LIMIT 1;`;
    const result = await DbClient.query<TenantRecord>(text, [tenantId]);
    return result.rows[0] || null;
  }

  public static async getTenantBySlug(slug: string): Promise<TenantRecord | null> {
    const text = `SELECT * FROM tenants WHERE LOWER(slug) = LOWER($1) LIMIT 1;`;
    const result = await DbClient.query<TenantRecord>(text, [slug.trim()]);
    return result.rows[0] || null;
  }

  public static async updateTenant(
    tenantId: string,
    updates: Partial<Omit<TenantRecord, "tenant_id" | "created_at">>
  ): Promise<TenantRecord | null> {
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (updates.name !== undefined) {
      fields.push(`name = $${idx++}`);
      values.push(updates.name.trim());
    }
    if (updates.legal_name !== undefined) {
      fields.push(`legal_name = $${idx++}`);
      values.push(updates.legal_name);
    }
    if (updates.country !== undefined) {
      fields.push(`country = $${idx++}`);
      values.push(updates.country);
    }
    if (updates.status !== undefined) {
      fields.push(`status = $${idx++}`);
      values.push(updates.status);
    }
    if (updates.settings !== undefined) {
      fields.push(`settings = $${idx++}`);
      values.push(JSON.stringify(updates.settings));
    }

    if (fields.length === 0) {
      return this.getTenantById(tenantId);
    }

    fields.push(`updated_at = NOW()`);
    values.push(tenantId);

    const text = `
      UPDATE tenants
      SET ${fields.join(", ")}
      WHERE tenant_id = $${idx}
      RETURNING *;
    `;
    const result = await DbClient.query<TenantRecord>(text, values);
    return result.rows[0] || null;
  }

  public static async listTenantsForUser(userId: string): Promise<Array<TenantRecord & { role: string }>> {
    const text = `
      SELECT t.*, m.role
      FROM tenants t
      JOIN tenant_memberships m ON t.tenant_id = m.tenant_id
      WHERE m.user_id = $1 AND m.status = 'ACTIVE' AND t.status != 'SUSPENDED'
      ORDER BY t.created_at ASC;
    `;
    const result = await DbClient.query<TenantRecord & { role: string }>(text, [userId]);
    return result.rows;
  }

  public static async deleteTenant(tenantId: string): Promise<boolean> {
    const text = `DELETE FROM tenants WHERE tenant_id = $1 RETURNING tenant_id;`;
    const result = await DbClient.query(text, [tenantId]);
    return (result.rowCount ?? 0) > 0;
  }
}
