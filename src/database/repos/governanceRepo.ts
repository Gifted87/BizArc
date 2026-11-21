import { DbClient } from "../dbClient.js";

export interface GovernanceRecord {
  id: string;
  circuit_breaker_active: boolean;
  emergency_reason: string | null;
  emergency_triggered_at: Date | null;
  active_vault_override: string | null;
  is_vault_allowlisted: boolean;
  dynamic_policy: { profileName: string; profile: any } | null;
  updated_at: Date;
}

export class GovernanceRepo {
  public static async getGovernanceState(): Promise<GovernanceRecord> {
    const text = `
      SELECT id, circuit_breaker_active, emergency_reason, emergency_triggered_at,
             active_vault_override, is_vault_allowlisted, dynamic_policy, updated_at
      FROM system_governance_state
      WHERE id = 'default'
      LIMIT 1;
    `;
    const res = await DbClient.query(text);
    if (res.rows.length === 0) {
      await DbClient.query(`
        INSERT INTO system_governance_state (id, circuit_breaker_active, is_vault_allowlisted)
        VALUES ('default', FALSE, FALSE)
        ON CONFLICT (id) DO NOTHING;
      `);
      return {
        id: "default",
        circuit_breaker_active: false,
        emergency_reason: null,
        emergency_triggered_at: null,
        active_vault_override: null,
        is_vault_allowlisted: false,
        dynamic_policy: null,
        updated_at: new Date(),
      };
    }
    return res.rows[0];
  }

  public static async setCircuitBreaker(active: boolean, reason: string | null = null): Promise<void> {
    const text = `
      INSERT INTO system_governance_state (
        id, circuit_breaker_active, emergency_reason, emergency_triggered_at, updated_at
      ) VALUES ('default', $1, $2, CASE WHEN $1 = TRUE THEN NOW() ELSE NULL END, NOW())
      ON CONFLICT (id) DO UPDATE SET
        circuit_breaker_active = EXCLUDED.circuit_breaker_active,
        emergency_reason = EXCLUDED.emergency_reason,
        emergency_triggered_at = EXCLUDED.emergency_triggered_at,
        updated_at = NOW();
    `;
    await DbClient.query(text, [active, reason]);
  }

  public static async setVaultOverride(vaultAddress: string | null, isAllowlisted: boolean): Promise<void> {
    const text = `
      INSERT INTO system_governance_state (
        id, active_vault_override, is_vault_allowlisted, updated_at
      ) VALUES ('default', $1, $2, NOW())
      ON CONFLICT (id) DO UPDATE SET
        active_vault_override = EXCLUDED.active_vault_override,
        is_vault_allowlisted = EXCLUDED.is_vault_allowlisted,
        updated_at = NOW();
    `;
    await DbClient.query(text, [vaultAddress, isAllowlisted]);
  }

  public static async setDynamicPolicy(profileName: string, profile: any): Promise<void> {
    const text = `
      INSERT INTO system_governance_state (
        id, dynamic_policy, updated_at
      ) VALUES ('default', $1, NOW())
      ON CONFLICT (id) DO UPDATE SET
        dynamic_policy = EXCLUDED.dynamic_policy,
        updated_at = NOW();
    `;
    await DbClient.query(text, [JSON.stringify({ profileName, profile })]);
  }

  public static async getDynamicPolicy(): Promise<{ profileName: string; profile: any } | null> {
    const text = `
      SELECT dynamic_policy
      FROM system_governance_state
      WHERE id = 'default'
      LIMIT 1;
    `;
    const res = await DbClient.query(text);
    if (res.rows.length > 0 && res.rows[0].dynamic_policy) {
      const dp = res.rows[0].dynamic_policy;
      return typeof dp === "string" ? JSON.parse(dp) : dp;
    }
    return null;
  }

  public static async clearDynamicPolicy(): Promise<void> {
    const text = `
      UPDATE system_governance_state
      SET dynamic_policy = NULL, updated_at = NOW()
      WHERE id = 'default';
    `;
    await DbClient.query(text);
  }
}
