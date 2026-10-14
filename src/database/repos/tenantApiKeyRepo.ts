import { DbClient } from "../dbClient.js";
import { TenantRecord } from "./tenantRepo.js";

export interface TenantApiKeyRecord {
  key_id: string;
  tenant_id: string;
  name: string;
  key_prefix: string;
  key_hash: string;
  scopes: string[];
  created_by_user_id?: string;
  is_active: boolean;
  expires_at?: Date;
  last_used_at?: Date;
  created_at?: Date;
}

export type SafeApiKeyRecord = Omit<TenantApiKeyRecord, "key_hash">;

export class TenantApiKeyRepo {
  public static async createKey(data: {
    tenant_id: string;
    name: string;
    key_prefix: string;
    key_hash: string;
    scopes?: string[];
    created_by_user_id?: string;
    expires_at?: Date;
  }): Promise<SafeApiKeyRecord> {
    const keyId = `key_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const text = `
      INSERT INTO tenant_api_keys (
        key_id, tenant_id, name, key_prefix, key_hash, scopes,
        created_by_user_id, is_active, expires_at, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, NOW())
      RETURNING key_id, tenant_id, name, key_prefix, scopes, created_by_user_id, is_active, expires_at, last_used_at, created_at;
    `;
    const values = [
      keyId,
      data.tenant_id,
      data.name.trim(),
      data.key_prefix,
      data.key_hash,
      JSON.stringify(data.scopes || ["read:treasury", "write:liabilities", "read:journal"]),
      data.created_by_user_id || null,
      data.expires_at || null,
    ];
    const result = await DbClient.query<SafeApiKeyRecord>(text, values);
    return result.rows[0];
  }

  public static async verifyKeyByHash(keyHash: string): Promise<{
    apiKey: SafeApiKeyRecord;
    tenant: TenantRecord;
  } | null> {
    const text = `
      SELECT 
        k.key_id, k.tenant_id, k.name, k.key_prefix, k.scopes,
        k.created_by_user_id, k.is_active, k.expires_at, k.last_used_at, k.created_at,
        t.name as t_name, t.slug as t_slug, t.legal_name as t_legal_name,
        t.country as t_country, t.status as t_status, t.settings as t_settings,
        t.created_at as t_created_at
      FROM tenant_api_keys k
      JOIN tenants t ON k.tenant_id = t.tenant_id
      WHERE k.key_hash = $1
        AND k.is_active = true
        AND (k.expires_at IS NULL OR k.expires_at > NOW())
        AND t.status != 'SUSPENDED'
      LIMIT 1;
    `;
    const result = await DbClient.query<any>(text, [keyHash]);
    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    const apiKey: SafeApiKeyRecord = {
      key_id: row.key_id,
      tenant_id: row.tenant_id,
      name: row.name,
      key_prefix: row.key_prefix,
      scopes: typeof row.scopes === "string" ? JSON.parse(row.scopes) : row.scopes,
      created_by_user_id: row.created_by_user_id,
      is_active: row.is_active,
      expires_at: row.expires_at,
      last_used_at: row.last_used_at,
      created_at: row.created_at,
    };

    const tenant: TenantRecord = {
      tenant_id: row.tenant_id,
      slug: row.t_slug,
      name: row.t_name,
      legal_name: row.t_legal_name,
      country: row.t_country,
      status: row.t_status,
      settings: typeof row.t_settings === "string" ? JSON.parse(row.t_settings) : row.t_settings,
      created_at: row.t_created_at,
    };

    // Asynchronously touch last_used_at
    DbClient.query(`UPDATE tenant_api_keys SET last_used_at = NOW() WHERE key_id = $1`, [apiKey.key_id]).catch(() => {});

    return { apiKey, tenant };
  }

  public static async listKeysForTenant(tenantId: string): Promise<SafeApiKeyRecord[]> {
    const text = `
      SELECT key_id, tenant_id, name, key_prefix, scopes, created_by_user_id, is_active, expires_at, last_used_at, created_at
      FROM tenant_api_keys
      WHERE tenant_id = $1
      ORDER BY created_at DESC;
    `;
    const result = await DbClient.query<SafeApiKeyRecord>(text, [tenantId]);
    return result.rows;
  }

  public static async revokeKey(keyId: string, tenantId: string): Promise<boolean> {
    const text = `
      UPDATE tenant_api_keys
      SET is_active = false
      WHERE key_id = $1 AND tenant_id = $2
      RETURNING key_id;
    `;
    const result = await DbClient.query(text, [keyId, tenantId]);
    return (result.rowCount ?? 0) > 0;
  }
}
