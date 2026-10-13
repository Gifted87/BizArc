import { DbClient } from "../dbClient.js";

export interface CompanyProfileRecord {
  company_id: string;
  company_name: string;
  business_description?: string;
  connected_apps: string[];
  discovered_cost_centers: Array<{
    accountId: string;
    name: string;
    role: string;
    allocatedMonthlySpendUsdc?: number;
  }>;
  inferred_policies: {
    mathematicalRules?: Record<string, any>;
    declaredPolicies?: Record<string, any>;
  };
  activation_status: "PENDING_ACTIVATION" | "ACTIVATED" | "SUSPENDED";
  created_at?: Date;
  updated_at?: Date;
}

export class CompanyProfileRepo {
  public static async upsertProfile(
    profile: CompanyProfileRecord
  ): Promise<CompanyProfileRecord> {
    const text = `
      INSERT INTO company_profiles (
        company_id, company_name, business_description,
        connected_apps, discovered_cost_centers, inferred_policies,
        activation_status, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      ON CONFLICT (company_id) DO UPDATE SET
        company_name = EXCLUDED.company_name,
        business_description = EXCLUDED.business_description,
        connected_apps = EXCLUDED.connected_apps,
        discovered_cost_centers = EXCLUDED.discovered_cost_centers,
        inferred_policies = EXCLUDED.inferred_policies,
        activation_status = EXCLUDED.activation_status,
        updated_at = NOW()
      RETURNING *;
    `;
    const values = [
      profile.company_id,
      profile.company_name,
      profile.business_description || null,
      JSON.stringify(profile.connected_apps || []),
      JSON.stringify(profile.discovered_cost_centers || []),
      JSON.stringify(profile.inferred_policies || {}),
      profile.activation_status,
    ];

    const result = await DbClient.query<CompanyProfileRecord>(text, values);
    return result.rows[0];
  }

  public static async getProfileById(
    companyId: string
  ): Promise<CompanyProfileRecord | null> {
    const text = `SELECT * FROM company_profiles WHERE company_id = $1 LIMIT 1;`;
    const result = await DbClient.query<CompanyProfileRecord>(text, [companyId]);
    if (result.rows.length === 0) return null;
    return result.rows[0];
  }

  public static async updateActivationStatus(
    companyId: string,
    status: "PENDING_ACTIVATION" | "ACTIVATED" | "SUSPENDED"
  ): Promise<CompanyProfileRecord | null> {
    const text = `
      UPDATE company_profiles
      SET activation_status = $2, updated_at = NOW()
      WHERE company_id = $1
      RETURNING *;
    `;
    const result = await DbClient.query<CompanyProfileRecord>(text, [companyId, status]);
    if (result.rows.length === 0) return null;
    return result.rows[0];
  }

  /**
   * Human Policy Edit: Updates both Mathematical Rules and Declared Policies at runtime.
   * Policies remain living and fully editable by authorized human treasury administrators.
   */
  public static async updatePolicies(
    companyId: string,
    updatedPolicies: {
      mathematicalRules?: Record<string, any>;
      declaredPolicies?: Record<string, any>;
    }
  ): Promise<CompanyProfileRecord | null> {
    const current = await this.getProfileById(companyId);
    if (!current) return null;

    const mergedPolicies = {
      mathematicalRules: {
        ...(current.inferred_policies?.mathematicalRules || {}),
        ...(updatedPolicies.mathematicalRules || {}),
      },
      declaredPolicies: {
        ...(current.inferred_policies?.declaredPolicies || {}),
        ...(updatedPolicies.declaredPolicies || {}),
      },
    };

    const text = `
      UPDATE company_profiles
      SET inferred_policies = $2, updated_at = NOW()
      WHERE company_id = $1
      RETURNING *;
    `;
    const result = await DbClient.query<CompanyProfileRecord>(text, [
      companyId,
      JSON.stringify(mergedPolicies),
    ]);
    if (result.rows.length === 0) return null;
    return result.rows[0];
  }
}
