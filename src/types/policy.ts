export type AccountRole =
  | "OPEX_DEV"
  | "OPEX_INFRA"
  | "OPEX_GROWTH"
  | "OPEX_MARKETING"
  | "OPEX_SALES"
  | "OPEX_SUPPORT"
  | "OPEX_RND"
  | "OPEX_PRODUCT"
  | "OPEX_DESIGN"
  | "PAYROLL"
  | "TREASURY_RESERVE"
  | "CAPEX"
  | string;

export type RedemptionLatencyTier =
  | "TIER_A_INSTANT"   // ~15 min / 300-900s instant onchain liquidity
  | "TIER_B_BATCH_T0"  // ~8 hours daily batch
  | "TIER_C_BATCH_T1"; // ~24 hours standard mutual fund queue

export interface LiabilityDisbursalRules {
  liability_id?: string;
  autoPayThresholdUsdc: number;
  requireThreeWayMatch: boolean;
  preFlightLeadTimeHours: number;
  stealthPriceCreepTolerancePct?: number;
  preferredPaymentRail: string;
  paymentRailConfig?: Record<string, any>;
}

export interface OperatingAccountPolicy {
  account_id: string;
  company_id?: string;
  name: string;
  role: AccountRole;
  min_floor_usdc: number;
  safety_multiplier: number;
  evaluation_window_days: number;
  authorized_categories: string[];
  max_autonomous_sweep_limit: number;
  exclude_from_waterfall_draws: boolean;
  per_tx_cap_usdc?: number;
  daily_cap_usdc?: number;
  weekly_cap_usdc?: number;
  monthly_cap_usdc?: number;
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

export interface DeclaredPolicyRule {
  rule_id: string;
  category: "COST_CENTER_INTEGRITY" | "ANOMALY_TOLERANCE" | "LIQUIDITY_URGENCY" | "TAX_HOLDBACK" | "GENERAL";
  description: string;
  instruction: string;
  is_active: boolean;
  defined_by: "HUMAN_OPERATOR" | "SUGGESTED_BY_AGENT";
  created_at: string;
}

export interface DeclaredPoliciesConfig {
  cost_center_rules?: string[];
  anomaly_tolerances?: {
    max_price_hike_percentage?: number; // e.g. 15 for 15%
    flag_unregistered_vendors?: boolean;
    require_three_way_match?: boolean;
  };
  liquidity_overrides?: string[];
  tax_holdback_percentage?: number; // e.g. 15 for 15%
  custom_rules?: DeclaredPolicyRule[];
}

export interface PolicyProfile {
  description: string;
  operating_accounts: OperatingAccountPolicy[];
  investment_rules: InvestmentRulesPolicy;
  spending_limits: SpendingLimitsPolicy;
  declared_policies?: DeclaredPoliciesConfig;
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
