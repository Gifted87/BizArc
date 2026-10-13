import { DbClient } from "../dbClient.js";

export interface TenantOAuthRecord {
  token_id?: string;
  tokenId?: string;
  company_id?: string;
  companyId?: string;
  provider: "GOOGLE_WORKSPACE" | "MICROSOFT_365" | "ODOO_SESSION" | "ERPNEXT_KEY" | string;
  access_token_encrypted?: string;
  accessTokenEncrypted?: string;
  refresh_token_encrypted?: string | null;
  refreshTokenEncrypted?: string | null;
  token_scope?: string | null;
  tokenScope?: string | null;
  expires_at?: Date | null;
  expiresAt?: Date | null;
  session_metadata?: Record<string, any>;
  sessionMetadata?: Record<string, any>;
  created_at?: Date;
  updated_at?: Date;
}

export class TenantOAuthRepo {
  public static async storeToken(params: TenantOAuthRecord): Promise<TenantOAuthRecord> {
    const companyId = params.company_id || params.companyId;
    if (!companyId) {
      throw new Error("[TenantOAuthRepo] company_id is required.");
    }
    const accessToken = params.access_token_encrypted || params.accessTokenEncrypted;
    if (!accessToken) {
      throw new Error("[TenantOAuthRepo] access_token_encrypted is required.");
    }
    const refreshToken = params.refresh_token_encrypted !== undefined 
      ? params.refresh_token_encrypted 
      : params.refreshTokenEncrypted;
    const tokenScope = params.token_scope !== undefined ? params.token_scope : params.tokenScope;
    const expiresAt = params.expires_at !== undefined ? params.expires_at : params.expiresAt;
    const sessionMeta = params.session_metadata !== undefined 
      ? params.session_metadata 
      : params.sessionMetadata;

    const text = `
      INSERT INTO tenant_oauth_tokens (
        company_id, provider, access_token_encrypted, refresh_token_encrypted,
        token_scope, expires_at, session_metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (company_id, provider) DO UPDATE SET
        access_token_encrypted = EXCLUDED.access_token_encrypted,
        refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
        token_scope = EXCLUDED.token_scope,
        expires_at = EXCLUDED.expires_at,
        session_metadata = EXCLUDED.session_metadata,
        updated_at = NOW()
      RETURNING *;
    `;
    const values = [
      companyId,
      params.provider,
      accessToken,
      refreshToken || null,
      tokenScope || null,
      expiresAt || null,
      JSON.stringify(sessionMeta || {}),
    ];

    const res = await DbClient.query<TenantOAuthRecord>(text, values);
    return res.rows[0];
  }

  public static async getToken(companyId: string, provider: string): Promise<TenantOAuthRecord | null> {
    const text = `
      SELECT * FROM tenant_oauth_tokens
      WHERE company_id = $1 AND provider = $2
      LIMIT 1;
    `;
    const res = await DbClient.query<TenantOAuthRecord>(text, [companyId, provider]);
    return res.rows.length > 0 ? res.rows[0] : null;
  }

  public static async listTokensByCompany(companyId: string): Promise<TenantOAuthRecord[]> {
    const text = `
      SELECT * FROM tenant_oauth_tokens
      WHERE company_id = $1
      ORDER BY updated_at DESC;
    `;
    const res = await DbClient.query<TenantOAuthRecord>(text, [companyId]);
    return res.rows;
  }

  public static async deleteToken(companyId: string, provider: string): Promise<boolean> {
    const text = `
      DELETE FROM tenant_oauth_tokens
      WHERE company_id = $1 AND provider = $2;
    `;
    const res = await DbClient.query(text, [companyId, provider]);
    return (res.rowCount ?? 0) > 0;
  }
}
