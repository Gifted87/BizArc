export type AccountRole =
  | "OPEX_DEV"
  | "OPEX_GROWTH"
  | "PAYROLL"
  | "TREASURY_RESERVE"
  | "CAPEX";

export type RedemptionLatencyTier =
  | "TIER_A_INSTANT"   // ~15 min / 300-900s instant onchain liquidity
  | "TIER_B_BATCH_T0"  // ~8 hours daily batch
  | "TIER_C_BATCH_T1"; // ~24 hours standard mutual fund queue

export interface OperatingAccountPolicy {
  account_id: string;
  name: string;
  role: AccountRole;
  min_floor_usdc: number;
  safety_multiplier: number;
  evaluation_window_days: number;
  authorized_categories: string[];
  max_autonomous_sweep_limit: number;
  exclude_from_waterfall_draws: boolean;
}

export interface InvestmentRulesPolicy {
  target_vault: string;
  max_company_allocation_ratio: number;
  min_sweep_amount_usdc: number;
  auto_sweep_enabled: boolean;
  auto_recall_enabled: boolean;
  invest_hysteresis_band_usdc: number;
  recall_hysteresis_band_usdc: number;
  debounce_window_ms: number;
  min_action_cooldown_seconds: number;
  tag_internal_settlement_events: boolean;
  redemption_lead_time_seconds: number;
  redemption_latency_tier: RedemptionLatencyTier;
}

export interface SpendingLimitsPolicy {
  daily_hard_cap_usdc: number;
  single_tx_human_gate_threshold_usdc: number;
}

export interface PolicyProfile {
  description: string;
  operating_accounts: OperatingAccountPolicy[];
  investment_rules: InvestmentRulesPolicy;
  spending_limits: SpendingLimitsPolicy;
}

export interface BusinessPolicyConfig {
  version: string;
  active_profile: "PRODUCTION_TESTNET" | "PRODUCTION" | "HACKATHON_DEMO";
  profiles: {
    PRODUCTION_TESTNET?: PolicyProfile;
    PRODUCTION: PolicyProfile;
    HACKATHON_DEMO: PolicyProfile;
  };
}
