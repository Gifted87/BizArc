import fs from "fs";
import path from "path";
import yaml from "yaml";
import { BusinessPolicyConfig, PolicyProfile } from "../types/policy.js";

export class PolicyValidationError extends Error {
  constructor(message: string) {
    super(`[PolicyValidationError] ${message}`);
    this.name = "PolicyValidationError";
  }
}

export class PolicyLoader {
  private static cachedConfig: BusinessPolicyConfig | null = null;

  public static loadConfig(filePath?: string): BusinessPolicyConfig {
    if (this.cachedConfig && !filePath) {
      return this.cachedConfig;
    }

    const resolvedPath = filePath
      ? path.resolve(filePath)
      : path.resolve(process.cwd(), "config/business_policy.yaml");

    if (!fs.existsSync(resolvedPath)) {
      throw new PolicyValidationError(`Business policy file not found at: ${resolvedPath}`);
    }

    const rawContent = fs.readFileSync(resolvedPath, "utf-8");
    const parsed = yaml.parse(rawContent) as BusinessPolicyConfig;

    this.validateConfig(parsed);
    this.cachedConfig = parsed;
    return parsed;
  }

  public static getActiveProfile(filePath?: string): {
    profileName: "PRODUCTION_TESTNET" | "PRODUCTION" | "HACKATHON_DEMO";
    profile: PolicyProfile;
  } {
    const config = this.loadConfig(filePath);
    const profileName = config.active_profile;
    const profile = config.profiles[profileName];

    if (!profile) {
      throw new PolicyValidationError(
        `Active profile '${profileName}' not found in policy profiles.`
      );
    }

    return { profileName, profile };
  }

  public static validateConfig(config: BusinessPolicyConfig): void {
    if (!config || typeof config !== "object") {
      throw new PolicyValidationError("Invalid policy file structure.");
    }

    if (!config.version) {
      throw new PolicyValidationError("Missing 'version' in policy configuration.");
    }

    if (!["PRODUCTION_TESTNET", "PRODUCTION", "HACKATHON_DEMO"].includes(config.active_profile)) {
      throw new PolicyValidationError(
        `Invalid active_profile '${config.active_profile}'. Must be 'PRODUCTION_TESTNET', 'PRODUCTION', or 'HACKATHON_DEMO'.`
      );
    }

    if (!config.profiles || !config.profiles.PRODUCTION || !config.profiles.HACKATHON_DEMO) {
      throw new PolicyValidationError(
        "Profiles must include both 'PRODUCTION' and 'HACKATHON_DEMO'."
      );
    }

    // Validate each profile present
    if (config.profiles.PRODUCTION_TESTNET) {
      this.validateProfile("PRODUCTION_TESTNET", config.profiles.PRODUCTION_TESTNET);
    }
    this.validateProfile("PRODUCTION", config.profiles.PRODUCTION);
    this.validateProfile("HACKATHON_DEMO", config.profiles.HACKATHON_DEMO);
  }

  private static validateProfile(name: string, profile: PolicyProfile): void {
    if (!profile.operating_accounts || !Array.isArray(profile.operating_accounts)) {
      throw new PolicyValidationError(`Profile '${name}' must have an 'operating_accounts' array.`);
    }

    if (profile.operating_accounts.length === 0) {
      throw new PolicyValidationError(`Profile '${name}' has zero operating accounts configured.`);
    }

    for (const acc of profile.operating_accounts) {
      if (!acc.account_id || !acc.role) {
        throw new PolicyValidationError(
          `Profile '${name}': Account missing required fields 'account_id' or 'role'.`
        );
      }
      if (acc.min_floor_usdc < 0) {
        throw new PolicyValidationError(
          `Profile '${name}': Account '${acc.account_id}' has negative min_floor_usdc.`
        );
      }
      if (acc.safety_multiplier < 1.0) {
        throw new PolicyValidationError(
          `Profile '${name}': Account '${acc.account_id}' safety_multiplier must be >= 1.0.`
        );
      }
    }

    // Investment Rules validation
    const inv = profile.investment_rules;
    if (!inv) {
      throw new PolicyValidationError(`Profile '${name}' missing 'investment_rules'.`);
    }
    if (inv.max_company_allocation_ratio <= 0 || inv.max_company_allocation_ratio > 1.0) {
      throw new PolicyValidationError(
        `Profile '${name}': max_company_allocation_ratio must be in range (0, 1.0].`
      );
    }
    if (inv.min_sweep_amount_usdc <= 0) {
      throw new PolicyValidationError(
        `Profile '${name}': min_sweep_amount_usdc must be positive.`
      );
    }
    if (inv.invest_hysteresis_band_usdc <= 0 || inv.recall_hysteresis_band_usdc <= 0) {
      throw new PolicyValidationError(
        `Profile '${name}': Hysteresis bands must be positive numbers.`
      );
    }

    // Spending limits monotonic validation (Rule 2 from circle-agent-stack & agent-wallet-policy)
    const sp = profile.spending_limits;
    if (!sp) {
      throw new PolicyValidationError(`Profile '${name}' missing 'spending_limits'.`);
    }
    if (sp.single_tx_human_gate_threshold_usdc <= 0 || sp.daily_hard_cap_usdc <= 0) {
      throw new PolicyValidationError(
        `Profile '${name}': Spending limits must be strictly positive.`
      );
    }
    if (sp.single_tx_human_gate_threshold_usdc > sp.daily_hard_cap_usdc) {
      throw new PolicyValidationError(
        `Profile '${name}': single_tx_human_gate_threshold_usdc (${sp.single_tx_human_gate_threshold_usdc}) cannot exceed daily_hard_cap_usdc (${sp.daily_hard_cap_usdc}).`
      );
    }

    // Declared Policies validation (Rule: Human defined directives)
    if (profile.declared_policies) {
      const dp = profile.declared_policies;
      if (dp.tax_holdback_percentage !== undefined) {
        if (dp.tax_holdback_percentage < 0 || dp.tax_holdback_percentage > 100) {
          throw new PolicyValidationError(
            `Profile '${name}': tax_holdback_percentage must be between 0 and 100.`
          );
        }
      }
      if (dp.anomaly_tolerances?.max_price_hike_percentage !== undefined) {
        if (dp.anomaly_tolerances.max_price_hike_percentage < 0) {
          throw new PolicyValidationError(
            `Profile '${name}': max_price_hike_percentage cannot be negative.`
          );
        }
      }
    }
  }

  public static clearCache(): void {
    this.cachedConfig = null;
  }
}
