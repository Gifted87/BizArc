/**
 * Shared Canonical Math Rules and Parameter Mappings
 * Unifies MathRulesQAEngine (both uppercase and lowercase IDs) with TenantPolicyManager.
 */

export interface CanonicalParamConfig {
  primary: string;
  aliases: string[];
  defaultValue: number;
}

export const CANONICAL_PARAM_MAPPINGS: Record<string, CanonicalParamConfig> = {
  investHysteresisBandUsdc: {
    primary: "investHysteresisBandUsdc",
    aliases: ["invest_hysteresis_band_usdc", "hysteresis_band_usdc", "inv_hysteresis_band"],
    defaultValue: 50.0,
  },
  recallHysteresisBandUsdc: {
    primary: "recallHysteresisBandUsdc",
    aliases: ["recall_hysteresis_band_usdc", "hysteresis_band_usdc", "inv_hysteresis_band"],
    defaultValue: 50.0,
  },
  taxHoldbackPercentage: {
    primary: "taxHoldbackPercentage",
    aliases: ["tax_holdback_percentage", "taxHoldbackPct", "gen_tax_holdback_percent"],
    defaultValue: 15.0,
  },
  usycYieldSweepRatio: {
    primary: "usycYieldSweepRatio",
    aliases: ["target_yield_allocation_ratio", "usyc_yield_sweep_ratio", "inv_idle_cash_allocation_ratio"],
    defaultValue: 0.85,
  },
  minSweepBatchUsdc: {
    primary: "minSweepBatchUsdc",
    aliases: ["min_sweep_threshold_usdc", "min_sweep_batch_usdc", "minSweepAmountUsdc", "inv_min_sweep_threshold"],
    defaultValue: 10.0,
  },
  dailyHardCapUsdc: {
    primary: "dailyHardCapUsdc",
    aliases: ["daily_hard_cap_usdc", "aggregate_company_daily_cap_usdc", "daily_cap_usdc", "gen_daily_spend_limit"],
    defaultValue: 5000.0,
  },
  singleTxHumanGateThresholdUsdc: {
    primary: "singleTxHumanGateThresholdUsdc",
    aliases: [
      "single_tx_human_gate_threshold_usdc",
      "singleTxCapUsdc",
      "per_tx_cap_usdc",
      "gen_highest_single_bill",
      "acc_per_tx_cap",
    ],
    defaultValue: 1000.0,
  },
  stealthPriceCreepTolerancePct: {
    primary: "stealthPriceCreepTolerancePct",
    aliases: ["max_price_variance_percent", "stealth_price_creep_tolerance_pct", "gen_price_variance_tolerance"],
    defaultValue: 5.0,
  },
  accountOperatingFloorUsdc: {
    primary: "accountOperatingFloorUsdc",
    aliases: ["min_operating_floor_usdc", "acc_monthly_expense_budget"],
    defaultValue: 500.0,
  },
  safetyBufferRatio: {
    primary: "safetyBufferRatio",
    aliases: ["safety_buffer_ratio", "acc_safety_buffer_margin"],
    defaultValue: 1.20,
  },
  maxAutonomousSweepLimit: {
    primary: "maxAutonomousSweepLimit",
    aliases: ["max_autonomous_sweep_usdc", "max_autonomous_sweep_limit"],
    defaultValue: 2500.0,
  },
  historicalAverageInvoiceUsdc: {
    primary: "historicalAverageInvoiceUsdc",
    aliases: ["historical_average_invoice_usdc"],
    defaultValue: 1000.0,
  },
  autoPayBufferRatio: {
    primary: "autoPayBufferRatio",
    aliases: ["auto_pay_buffer_ratio", "auto_pay_ceiling_usdc", "liab_auto_pay_ceiling"],
    defaultValue: 1.10,
  },
  preFlightLeadTimeHours: {
    primary: "preFlightLeadTimeHours",
    aliases: ["pre_flight_staging_lead_hours", "liab_staging_lead_hours"],
    defaultValue: 48.0,
  },
  emergencyRecallBufferPct: {
    primary: "emergencyRecallBufferPct",
    aliases: ["emergency_recall_buffer_pct"],
    defaultValue: 15.0,
  },
};

/**
 * Question ID Aliases: Bidirectional mapping between uppercase (GM_*, AM_*, LM_*, IM_*)
 * and lowercase legacy / Section 8.1 IDs (gen_*, acc_*, liab_*, inv_*).
 */
export const QUESTION_ID_ALIASES: Record<string, string> = {
  // Lowercase -> Uppercase
  gen_highest_single_bill: "AM_SINGLE_TX_CAP",
  gen_daily_spend_limit: "AM_DAILY_SPEND_CEILING",
  gen_price_variance_tolerance: "LM_STEALTH_CREEP_TOLERANCE_PCT",
  acc_monthly_expense_budget: "AM_OPERATING_FLOOR_USDC",
  acc_safety_buffer_margin: "GM_BUFFER_MULTIPLIER",
  acc_per_tx_cap: "AM_SINGLE_TX_CAP",
  liab_auto_pay_ceiling: "LM_AUTOPAY_BUFFER_RATIO",
  liab_staging_lead_hours: "LM_PREFLIGHT_LEAD_HOURS",
  inv_idle_cash_allocation_ratio: "IM_USYC_SWEEP_RATIO",
  inv_min_sweep_threshold: "IM_MIN_SWEEP_BATCH_USDC",
  inv_hysteresis_band: "IM_HYSTERESIS_BAND",
  gen_tax_holdback_percent: "GM_TAX_HOLDBACK_PERCENTAGE",

  // Uppercase -> Lowercase
  AM_SINGLE_TX_CAP: "gen_highest_single_bill",
  AM_DAILY_SPEND_CEILING: "gen_daily_spend_limit",
  LM_STEALTH_CREEP_TOLERANCE_PCT: "gen_price_variance_tolerance",
  AM_OPERATING_FLOOR_USDC: "acc_monthly_expense_budget",
  GM_BUFFER_MULTIPLIER: "acc_safety_buffer_margin",
  LM_AUTOPAY_BUFFER_RATIO: "liab_auto_pay_ceiling",
  LM_PREFLIGHT_LEAD_HOURS: "liab_staging_lead_hours",
  IM_USYC_SWEEP_RATIO: "inv_idle_cash_allocation_ratio",
  IM_MIN_SWEEP_BATCH_USDC: "inv_min_sweep_threshold",
  IM_HYSTERESIS_BAND: "inv_hysteresis_band",
  GM_TAX_HOLDBACK_PERCENTAGE: "gen_tax_holdback_percent",
};

/**
 * Resolves a parameter value from the qaMap by checking canonical name and all known aliases.
 */
export function resolveParameterValue(
  qaMap: Map<string, number>,
  canonicalParamName: string,
  fallbackDefault?: number
): number {
  const config = CANONICAL_PARAM_MAPPINGS[canonicalParamName];
  const defaultVal = fallbackDefault ?? config?.defaultValue ?? 0;

  if (qaMap.has(canonicalParamName)) {
    return qaMap.get(canonicalParamName)!;
  }

  if (config) {
    if (qaMap.has(config.primary)) {
      return qaMap.get(config.primary)!;
    }
    for (const alias of config.aliases) {
      if (qaMap.has(alias)) {
        return qaMap.get(alias)!;
      }
    }
  }

  return defaultVal;
}
