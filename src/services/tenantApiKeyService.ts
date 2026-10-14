import { TenantApiKeyRepo, SafeApiKeyRecord } from "../database/repos/tenantApiKeyRepo.js";
import { TenantRecord } from "../database/repos/tenantRepo.js";
import { TenantRole } from "../database/repos/tenantMembershipRepo.js";
import { PasswordHasher } from "../security/passwordHasher.js";

export class TenantApiKeyService {
  /**
   * Generates a new scoped API key for a tenant.
   * Returns the raw key string EXACTLY ONCE to the caller.
   */
  public static async generateApiKey(params: {
    tenantId: string;
    name: string;
    scopes?: string[];
    createdByUserId?: string;
    expiresInDays?: number;
    actorRole: TenantRole;
  }): Promise<{ apiKey: SafeApiKeyRecord; rawKey: string }> {
    if (params.actorRole !== "OWNER" && params.actorRole !== "CFO") {
      throw new Error("FORBIDDEN: Only Owners and CFOs can generate tenant API keys.");
    }

    if (!params.name || params.name.trim().length === 0) {
      throw new Error("NAME_REQUIRED: A descriptive name is required for the API key.");
    }

    const { rawKey, keyPrefix, keyHash } = PasswordHasher.generateApiKey("live");
    const expiresAt = params.expiresInDays
      ? new Date(Date.now() + params.expiresInDays * 86400 * 1000)
      : undefined;

    const apiKey = await TenantApiKeyRepo.createKey({
      tenant_id: params.tenantId,
      name: params.name.trim(),
      key_prefix: keyPrefix,
      key_hash: keyHash,
      scopes: params.scopes || ["read:treasury", "write:liabilities", "read:journal"],
      created_by_user_id: params.createdByUserId,
      expires_at: expiresAt,
    });

    return { apiKey, rawKey };
  }

  /**
   * Validates a raw API key (e.g. from x-api-key or Bearer header).
   */
  public static async verifyApiKey(rawKey: string): Promise<{
    apiKey: SafeApiKeyRecord;
    tenant: TenantRecord;
  } | null> {
    if (!rawKey || !rawKey.startsWith("biz_")) return null;
    const keyHash = PasswordHasher.hashToken(rawKey);
    return TenantApiKeyRepo.verifyKeyByHash(keyHash);
  }

  /**
   * Lists all API keys for a tenant.
   */
  public static async listApiKeys(tenantId: string): Promise<SafeApiKeyRecord[]> {
    return TenantApiKeyRepo.listKeysForTenant(tenantId);
  }

  /**
   * Revokes an API key immediately.
   */
  public static async revokeApiKey(
    keyId: string,
    tenantId: string,
    actorRole: TenantRole
  ): Promise<boolean> {
    if (actorRole !== "OWNER" && actorRole !== "CFO") {
      throw new Error("FORBIDDEN: Only Owners and CFOs can revoke API keys.");
    }
    return TenantApiKeyRepo.revokeKey(keyId, tenantId);
  }
}
