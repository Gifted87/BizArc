export * from "./types/policy.js";
export * from "./types/accounts.js";
export * from "./types/sprs.js";
export * from "./types/agents.js";
export * from "./config/policyLoader.js";
export * from "./config/tenantPolicyManager.js";
export * from "./foundation/index.js";
export { LoudRoundingError, BalanceMutationEvent } from "./foundation/index.js";
export type { LiabilityStatus } from "./types/accounts.js";
export * from "./contracts/index.js";
export * from "./database/index.js";
export * from "./services/index.js";
export * from "./services/accountRegistrationService.js";
export * from "./services/vendorMasterService.js";
export * from "./services/yieldOptimizerService.js";
export * from "./services/accountIntelligenceService.js";
export { LedgerWitnessService } from "./services/ledgerWitnessService.js";
export { LiabilityRadarService } from "./services/liabilityRadarService.js";
export { TreasurySentinelService } from "./services/treasurySentinelService.js";
export { EnterpriseOnboardingService } from "./services/enterpriseOnboardingService.js";
export * from "./services/unifiedOperationalStateService.js";
export * from "./connectors/index.js";
export * from "./payments/index.js";
export * from "./llm/index.js";
export * from "./memory/index.js";
export * from "./context/index.js";
export * from "./records/index.js";
export * from "./tools/index.js";
export * from "./agents/core/BaseLlmAgent.js";
export * from "./agents/liabilityRadarLlmAgent.js";
export * from "./agents/treasurySentinelLlmAgent.js";
export * from "./agents/disbursalRouterLlmAgent.js";
export * from "./agents/policyComplianceLlmAgent.js";
export * from "./agents/ledgerWitnessLlmAgent.js";
export * from "./agents/onboardingLlmAgent.js";
export * from "./agents/swarmCoordinator.js";

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
export * from "./orchestration/stateMachines/types.js";
export * from "./orchestration/stateMachines/OnboardingStateMachine.js";
export * from "./orchestration/stateMachines/LiabilityDiscoveryStateMachine.js";
export * from "./orchestration/stateMachines/YieldRebalancingStateMachine.js";
export * from "./orchestration/stateMachines/LiabilityDisbursalStateMachine.js";
export * from "./orchestration/stateMachines/AdHocPaymentStateMachine.js";
export * from "./orchestration/treasuryStateMachineOrchestrator.js";
export * from "./ingress/systemHttpServer.js";
export * from "./daemon/treasuryDaemon.js";