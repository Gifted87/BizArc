export * from "./types/policy.js";
export * from "./types/accounts.js";
export * from "./types/sprs.js";
export * from "./types/agents.js";
export * from "./config/policyLoader.js";
export * from "./foundation/index.js";
export * from "./contracts/index.js";

// Convenience bootstrap function
import { PolicyLoader } from "./config/policyLoader.js";

export function initializeBizArcEnvironment(policyPath?: string) {
  const { profileName, profile } = PolicyLoader.getActiveProfile(policyPath);
  return {
    profileName,
    profile,
    operatingAccountsCount: profile.operating_accounts.length,
    investmentRules: profile.investment_rules,
    spendingLimits: profile.spending_limits,
  };
}
