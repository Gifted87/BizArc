import { MathRulesQaRepo, MathRuleQaResponseRecord } from "../database/repos/mathRulesQaRepo.js";

export type QuestionCategory = "GENERAL_MATH" | "ACCOUNT_MATH" | "LIABILITY_MATH" | "INVESTMENT_MATH";

export interface MathRuleQuestion {
  questionId: string;
  category: QuestionCategory;
  questionText: string;
  helpText?: string;
  responseType: "NUMBER" | "PERCENTAGE" | "SELECT" | "BOOLEAN";
  options?: Array<{ label: string; value: any; numericValue?: number }>;
  defaultValue?: any;
  derivedParameterName: string;
  formulaDescription: string;
  validate: (val: any) => { valid: boolean; error?: string };
}

export interface AnswerEvaluationResult {
  questionId: string;
  category: string;
  questionText: string;
  userAnswer: any;
  derivedParameterName: string;
  derivedValue: number;
  formattedUsdc: string;
}

export interface IMathRulesQAEngine {
  getQuestionsByCategory(category: QuestionCategory): MathRuleQuestion[];
  getAllQuestions(): MathRuleQuestion[];
  evaluateAnswers(answers: Array<{ questionId: string; answer: any }>): AnswerEvaluationResult[];
  persistQAResponses(
    companyId: string,
    results: AnswerEvaluationResult[],
    metadata?: { accountId?: string | null; liabilityId?: string | null }
  ): Promise<void>;
}

export class MathRulesQAEngine implements IMathRulesQAEngine {
  private static instance: MathRulesQAEngine | null = null;
  private readonly questions: MathRuleQuestion[] = [];

  public constructor() {
    this.initQuestions();
  }

  public static getInstance(): MathRulesQAEngine {
    if (!MathRulesQAEngine.instance) {
      MathRulesQAEngine.instance = new MathRulesQAEngine();
    }
    return MathRulesQAEngine.instance;
  }

  private initQuestions(): void {
    // ======================================================================================
    // 1. GENERAL_MATH Questions (Runway, Burn, Volatility, Base Reserve)
    // ======================================================================================
    this.questions.push({
      questionId: "GM_RUNWAY_MONTHS",
      category: "GENERAL_MATH",
      questionText: "How many months of liquid cash runway must your treasury maintain at all times?",
      helpText: "Determines the base operational reserve floor. Minimum 1 month, maximum 24 months.",
      responseType: "NUMBER",
      defaultValue: 3,
      derivedParameterName: "minRunwayMonths",
      formulaDescription: "M_runway: Target cash runway horizon in months",
      validate: (val) => {
        const num = Number(val);
        if (isNaN(num) || num < 1 || num > 24) {
          return { valid: false, error: "Runway months must be between 1 and 24." };
        }
        return { valid: true };
      },
    });

    this.questions.push({
      questionId: "GM_MONTHLY_BURN",
      category: "GENERAL_MATH",
      questionText: "What is your estimated 30-day net operating cash burn in USDC?",
      helpText: "Sum of monthly payroll, SaaS subscriptions, cloud infra, and rent obligations.",
      responseType: "NUMBER",
      defaultValue: 25000,
      derivedParameterName: "monthlyOperatingBurnUsdc",
      formulaDescription: "MonthlyBurn_30d: Incurred monthly cash burn rate",
      validate: (val) => {
        const num = Number(val);
        if (isNaN(num) || num < 0) {
          return { valid: false, error: "Monthly burn cannot be negative." };
        }
        return { valid: true };
      },
    });

    this.questions.push({
      questionId: "GM_REVENUE_VOLATILITY",
      category: "GENERAL_MATH",
      questionText: "What is your organization's revenue volatility risk level?",
      helpText: "Adjusts the liquidity buffer based on cash-inflow predictability.",
      responseType: "SELECT",
      options: [
        { label: "Low Volatility (Predictable Enterprise Subscriptions, 10% buffer)", value: "LOW", numericValue: 0.10 },
        { label: "Medium Volatility (Blended Contracts & Usage, 20% buffer)", value: "MEDIUM", numericValue: 0.20 },
        { label: "High Volatility (Transactional / Early Stage, 35% buffer)", value: "HIGH", numericValue: 0.35 },
      ],
      defaultValue: "MEDIUM",
      derivedParameterName: "revenueVolatilityBuffer",
      formulaDescription: "sigma_rev: Reserve expansion multiplier for revenue volatility",
      validate: (val) => {
        if (!["LOW", "MEDIUM", "HIGH"].includes(String(val))) {
          return { valid: false, error: "Must select LOW, MEDIUM, or HIGH volatility." };
        }
        return { valid: true };
      },
    });

    this.questions.push({
      questionId: "GM_BUFFER_MULTIPLIER",
      category: "GENERAL_MATH",
      questionText: "What cash safety buffer multiplier should be applied to account operating floors?",
      helpText: "Safety ratio held in operating accounts to absorb unplanned expenses.",
      responseType: "SELECT",
      options: [
        { label: "Conservative (1.50x multiplier)", value: "CONSERVATIVE", numericValue: 1.50 },
        { label: "Balanced (1.25x multiplier)", value: "BALANCED", numericValue: 1.25 },
        { label: "Lean (1.15x multiplier)", value: "LEAN", numericValue: 1.15 },
      ],
      defaultValue: "BALANCED",
      derivedParameterName: "cashSafetyBufferMultiplier",
      formulaDescription: "B_buffer: Account liquidity floor safety multiplier",
      validate: (val) => {
        if (!["CONSERVATIVE", "BALANCED", "LEAN"].includes(String(val))) {
          return { valid: false, error: "Must select CONSERVATIVE, BALANCED, or LEAN buffer." };
        }
        return { valid: true };
      },
    });

    // ======================================================================================
    // 2. ACCOUNT_MATH Questions (Floors, Daily Caps, Single Tx Limits)
    // ======================================================================================
    this.questions.push({
      questionId: "AM_OPERATING_FLOOR_USDC",
      category: "ACCOUNT_MATH",
      questionText: "What is the minimum operating cash floor for this account (USDC)?",
      helpText: "Funds below this threshold will trigger liquidity alerts and prevent outward sweeps.",
      responseType: "NUMBER",
      defaultValue: 500,
      derivedParameterName: "accountOperatingFloorUsdc",
      formulaDescription: "Floor_acc: Minimum required balance for operational solvency",
      validate: (val) => {
        const num = Number(val);
        if (isNaN(num) || num < 0) {
          return { valid: false, error: "Operating cash floor cannot be negative." };
        }
        return { valid: true };
      },
    });

    this.questions.push({
      questionId: "AM_DAILY_SPEND_CEILING",
      category: "ACCOUNT_MATH",
      questionText: "What is the maximum daily cumulative disbursal ceiling for this account (USDC)?",
      helpText: "Daily hard cap for autonomous agent actions before requiring human re-authorization.",
      responseType: "NUMBER",
      defaultValue: 5000,
      derivedParameterName: "dailyHardCapUsdc",
      formulaDescription: "Cap_daily: Cumulative daily spending ceiling",
      validate: (val) => {
        const num = Number(val);
        if (isNaN(num) || num <= 0) {
          return { valid: false, error: "Daily spend ceiling must be greater than zero." };
        }
        return { valid: true };
      },
    });

    this.questions.push({
      questionId: "AM_SINGLE_TX_CAP",
      category: "ACCOUNT_MATH",
      questionText: "What is the single-transaction approval ceiling for this account before requiring CFO authorization?",
      helpText: "Transactions exceeding this limit trigger an EIP-712 human signoff gate.",
      responseType: "NUMBER",
      defaultValue: 1000,
      derivedParameterName: "singleTxHumanGateThresholdUsdc",
      formulaDescription: "Gate_tx: Maximum single transaction amount allowed autonomously",
      validate: (val) => {
        const num = Number(val);
        if (isNaN(num) || num <= 0) {
          return { valid: false, error: "Single tx ceiling must be greater than zero." };
        }
        return { valid: true };
      },
    });

    this.questions.push({
      questionId: "AM_AUTONOMOUS_SWEEP_MAX",
      category: "ACCOUNT_MATH",
      questionText: "What is the maximum autonomous single-sweep amount to yield vaults for this account (USDC)?",
      helpText: "Maximum single batch size swept to USYC.",
      responseType: "NUMBER",
      defaultValue: 2500,
      derivedParameterName: "maxAutonomousSweepLimit",
      formulaDescription: "Sweep_max: Single-batch yield sweep limit",
      validate: (val) => {
        const num = Number(val);
        if (isNaN(num) || num <= 0) {
          return { valid: false, error: "Sweep limit must be greater than zero." };
        }
        return { valid: true };
      },
    });

    // ======================================================================================
    // 3. LIABILITY_MATH Questions (Invoice Averages, Stealth Creep, Lead Times)
    // ======================================================================================
    this.questions.push({
      questionId: "LM_HISTORICAL_INVOICE_AVG",
      category: "LIABILITY_MATH",
      questionText: "What is the expected or historical average monthly invoice amount for this vendor (USDC)?",
      helpText: "Used as baseline benchmark for automated settlement and anomaly detection.",
      responseType: "NUMBER",
      defaultValue: 1000,
      derivedParameterName: "historicalAverageInvoiceUsdc",
      formulaDescription: "mu_inv: Baseline expected invoice magnitude",
      validate: (val) => {
        const num = Number(val);
        if (isNaN(num) || num <= 0) {
          return { valid: false, error: "Historical invoice average must be greater than zero." };
        }
        return { valid: true };
      },
    });

    this.questions.push({
      questionId: "LM_STEALTH_CREEP_TOLERANCE_PCT",
      category: "LIABILITY_MATH",
      questionText: "What is the maximum percentage price variance tolerated before triggering a Stealth Price Creep freeze?",
      helpText: "If month-over-month unit cost rises by more than this percentage, agent escalates to CFO.",
      responseType: "SELECT",
      options: [
        { label: "Strict (3% maximum variance)", value: "STRICT_3_PCT", numericValue: 3.0 },
        { label: "Standard (5% maximum variance)", value: "STANDARD_5_PCT", numericValue: 5.0 },
        { label: "Permissive (10% maximum variance)", value: "PERMISSIVE_10_PCT", numericValue: 10.0 },
      ],
      defaultValue: "STANDARD_5_PCT",
      derivedParameterName: "stealthPriceCreepTolerancePct",
      formulaDescription: "tau_creep: Maximum allowed price hike percentage without contract amendment",
      validate: (val) => {
        if (!["STRICT_3_PCT", "STANDARD_5_PCT", "PERMISSIVE_10_PCT"].includes(String(val))) {
          return { valid: false, error: "Must select a valid stealth creep option." };
        }
        return { valid: true };
      },
    });

    this.questions.push({
      questionId: "LM_AUTOPAY_BUFFER_RATIO",
      category: "LIABILITY_MATH",
      questionText: "What auto-pay ceiling multiplier above the historical average is authorized for automated settlement?",
      helpText: "Multiplier applied to expected invoice for DisbursalVault / SessionKey execution limits.",
      responseType: "SELECT",
      options: [
        { label: "Exact Match Only (1.00x - zero overage)", value: "EXACT_1_00", numericValue: 1.00 },
        { label: "Low Variance Buffer (1.10x - up to 10% overage)", value: "LOW_1_10", numericValue: 1.10 },
        { label: "Medium Variance Buffer (1.25x - up to 25% overage)", value: "MEDIUM_1_25", numericValue: 1.25 },
      ],
      defaultValue: "LOW_1_10",
      derivedParameterName: "autoPayBufferRatio",
      formulaDescription: "K_buffer: Permitted headroom multiplier for auto-disbursals",
      validate: (val) => {
        if (!["EXACT_1_00", "LOW_1_10", "MEDIUM_1_25"].includes(String(val))) {
          return { valid: false, error: "Must select a valid auto-pay buffer option." };
        }
        return { valid: true };
      },
    });

    this.questions.push({
      questionId: "LM_PREFLIGHT_LEAD_HOURS",
      category: "LIABILITY_MATH",
      questionText: "How many hours before the invoice due date should the agent begin liquidity pre-flighting?",
      helpText: "Pre-verifies cash balance and un-stakes USYC if needed to ensure on-time settlement.",
      responseType: "NUMBER",
      defaultValue: 48,
      derivedParameterName: "preFlightLeadTimeHours",
      formulaDescription: "T_lead: Pre-flight runway evaluation window in hours",
      validate: (val) => {
        const num = Number(val);
        if (isNaN(num) || num < 12 || num > 168) {
          return { valid: false, error: "Pre-flight lead hours must be between 12 and 168 (1 week)." };
        }
        return { valid: true };
      },
    });

    // ======================================================================================
    // 4. INVESTMENT_MATH Questions (USYC Sweep Ratio, Batch Size, Emergency Recall)
    // ======================================================================================
    this.questions.push({
      questionId: "IM_USYC_SWEEP_RATIO",
      category: "INVESTMENT_MATH",
      questionText: "What percentage of surplus liquid cash above operational floors should be swept into USYC yield vaults?",
      helpText: "Allocates surplus treasury capital to 5.1% yield-bearing tokenized US Treasuries.",
      responseType: "PERCENTAGE",
      defaultValue: 80,
      derivedParameterName: "usycYieldSweepRatio",
      formulaDescription: "R_usyc: Fraction of surplus liquid cash swept into yield assets",
      validate: (val) => {
        const num = Number(val);
        if (isNaN(num) || num < 10 || num > 95) {
          return { valid: false, error: "USYC sweep percentage must be between 10% and 95%." };
        }
        return { valid: true };
      },
    });

    this.questions.push({
      questionId: "IM_MIN_SWEEP_BATCH_USDC",
      category: "INVESTMENT_MATH",
      questionText: "What is the minimum sweep batch size to avoid micro-transaction friction (USDC)?",
      helpText: "Prevents dusting transactions and ensures capital efficiency.",
      responseType: "NUMBER",
      defaultValue: 50,
      derivedParameterName: "minSweepBatchUsdc",
      formulaDescription: "Min_sweep: Smallest allowed autonomous sweep batch",
      validate: (val) => {
        const num = Number(val);
        if (isNaN(num) || num < 1) {
          return { valid: false, error: "Minimum sweep batch must be at least 1 USDC." };
        }
        return { valid: true };
      },
    });

    this.questions.push({
      questionId: "IM_EMERGENCY_RECALL_BUFFER_PCT",
      category: "INVESTMENT_MATH",
      questionText: "What percentage liquidity buffer should trigger an automated emergency recall from yield vaults?",
      helpText: "If operational liquid cash drops below (Floor * this buffer), instant USYC recall is triggered.",
      responseType: "PERCENTAGE",
      defaultValue: 15,
      derivedParameterName: "emergencyRecallBufferPct",
      formulaDescription: "B_recall: Critical threshold percentage triggering automated USYC liquidation",
      validate: (val) => {
        const num = Number(val);
        if (isNaN(num) || num < 5 || num > 50) {
          return { valid: false, error: "Emergency recall buffer must be between 5% and 50%." };
        }
        return { valid: true };
      },
    });

    // ======================================================================================
    // 5. Section 8.1 Complete Q&A Catalog Canonical IDs (complete-analysis.md)
    // ======================================================================================
    this.questions.push({
      questionId: "gen_highest_single_bill",
      category: "GENERAL_MATH",
      questionText: "What is the largest single vendor bill your company typically pays in a normal month?",
      helpText: "Used to compute your baseline corporate reserve floor and human sign-off gate.",
      responseType: "NUMBER",
      defaultValue: 5000,
      derivedParameterName: "single_tx_human_gate_threshold_usdc",
      formulaDescription: "Single transaction human gate threshold",
      validate: (val) => {
        const num = Number(val);
        if (isNaN(num) || num <= 0) return { valid: false, error: "Must be greater than zero." };
        return { valid: true };
      },
    });

    this.questions.push({
      questionId: "gen_daily_spend_limit",
      category: "GENERAL_MATH",
      questionText: "What is the maximum total dollar amount the entire company should spend in any 24-hour period without executive board escalation?",
      helpText: "Establishes the hard daily aggregate circuit-breaker across all accounts.",
      responseType: "NUMBER",
      defaultValue: 25000,
      derivedParameterName: "aggregate_company_daily_cap_usdc",
      formulaDescription: "Aggregate daily expenditure limit",
      validate: (val) => {
        const num = Number(val);
        if (isNaN(num) || num <= 0) return { valid: false, error: "Must be greater than zero." };
        return { valid: true };
      },
    });

    this.questions.push({
      questionId: "gen_price_variance_tolerance",
      category: "GENERAL_MATH",
      questionText: "What percentage variance between an incoming invoice and its agreed purchase order is acceptable before pausing payment for review?",
      helpText: "Invoices exceeding this percentage increase are flagged for human review.",
      responseType: "PERCENTAGE",
      defaultValue: 10,
      derivedParameterName: "max_price_variance_percent",
      formulaDescription: "Maximum price variance percentage tolerance",
      validate: (val) => {
        const num = Number(val);
        if (isNaN(num) || num < 0 || num > 100) return { valid: false, error: "Must be between 0% and 100%." };
        return { valid: true };
      },
    });

    this.questions.push({
      questionId: "acc_monthly_expense_budget",
      category: "ACCOUNT_MATH",
      questionText: "What is the monthly budgeted spend for this specific account?",
      helpText: "Calculates the account minimum operating floor as 25% of monthly budget.",
      responseType: "NUMBER",
      defaultValue: 10000,
      derivedParameterName: "min_operating_floor_usdc",
      formulaDescription: "Calculated floor = budget * 0.25",
      validate: (val) => {
        const num = Number(val);
        if (isNaN(num) || num <= 0) return { valid: false, error: "Must be greater than zero." };
        return { valid: true };
      },
    });

    this.questions.push({
      questionId: "acc_safety_buffer_margin",
      category: "ACCOUNT_MATH",
      questionText: "What safety buffer margin should be maintained above scheduled liabilities for this account?",
      helpText: "e.g., 20% buffer means maintaining 1.20x upcoming liabilities.",
      responseType: "PERCENTAGE",
      defaultValue: 20,
      derivedParameterName: "safety_buffer_ratio",
      formulaDescription: "Ratio = 1.0 + (margin / 100)",
      validate: (val) => {
        const num = Number(val);
        if (isNaN(num) || num < 0) return { valid: false, error: "Buffer cannot be negative." };
        return { valid: true };
      },
    });

    this.questions.push({
      questionId: "acc_per_tx_cap",
      category: "ACCOUNT_MATH",
      questionText: "What is the maximum single payment allowed out of this specific account?",
      helpText: "Payments exceeding this require human authorization.",
      responseType: "NUMBER",
      defaultValue: 2500,
      derivedParameterName: "per_tx_cap_usdc",
      formulaDescription: "Per transaction cap",
      validate: (val) => {
        const num = Number(val);
        if (isNaN(num) || num <= 0) return { valid: false, error: "Must be greater than zero." };
        return { valid: true };
      },
    });

    this.questions.push({
      questionId: "liab_auto_pay_ceiling",
      category: "LIABILITY_MATH",
      questionText: "Up to what amount should this recurring invoice be paid automatically without manual sign-off?",
      helpText: "Amounts above this threshold generate an SPRS permission request.",
      responseType: "NUMBER",
      defaultValue: 1000,
      derivedParameterName: "auto_pay_ceiling_usdc",
      formulaDescription: "Auto pay ceiling",
      validate: (val) => {
        const num = Number(val);
        if (isNaN(num) || num <= 0) return { valid: false, error: "Must be greater than zero." };
        return { valid: true };
      },
    });

    this.questions.push({
      questionId: "liab_staging_lead_hours",
      category: "LIABILITY_MATH",
      questionText: "How many hours before the due date should liquidity be recalled and staged in the vault?",
      helpText: "Default is 48 hours to account for banking/yield redemption clearing windows.",
      responseType: "NUMBER",
      defaultValue: 48,
      derivedParameterName: "pre_flight_staging_lead_hours",
      formulaDescription: "Pre flight lead staging hours",
      validate: (val) => {
        const num = Number(val);
        if (isNaN(num) || num < 1) return { valid: false, error: "Must be at least 1 hour." };
        return { valid: true };
      },
    });

    this.questions.push({
      questionId: "inv_idle_cash_allocation_ratio",
      category: "INVESTMENT_MATH",
      questionText: "What percentage of idle cash above your Target Reserve are you comfortable auto-investing in USYC yield?",
      helpText: "e.g., 80% deploys surplus into yield while retaining 20% liquid cash.",
      responseType: "PERCENTAGE",
      defaultValue: 80,
      derivedParameterName: "target_yield_allocation_ratio",
      formulaDescription: "Yield allocation ratio",
      validate: (val) => {
        const num = Number(val);
        if (isNaN(num) || num < 0 || num > 100) return { valid: false, error: "Must be between 0% and 100%." };
        return { valid: true };
      },
    });

    this.questions.push({
      questionId: "inv_min_sweep_threshold",
      category: "INVESTMENT_MATH",
      questionText: "What is the minimum surplus dollar amount required before triggering a yield sweep transaction?",
      helpText: "Prevents micro-transactions from incurring unnecessary gas/protocol fees.",
      responseType: "NUMBER",
      defaultValue: 50,
      derivedParameterName: "min_sweep_threshold_usdc",
      formulaDescription: "Minimum sweep batch threshold",
      validate: (val) => {
        const num = Number(val);
        if (isNaN(num) || num <= 0) return { valid: false, error: "Must be greater than zero." };
        return { valid: true };
      },
    });

    this.questions.push({
      questionId: "inv_hysteresis_band",
      category: "INVESTMENT_MATH",
      questionText: "What dollar buffer band should prevent rapid alternating between sweep and recall?",
      helpText: "Ensures balances must move outside this band before initiating new transactions.",
      responseType: "NUMBER",
      defaultValue: 25,
      derivedParameterName: "hysteresis_band_usdc",
      formulaDescription: "Hysteresis band buffer",
      validate: (val) => {
        const num = Number(val);
        if (isNaN(num) || num <= 0) return { valid: false, error: "Must be greater than zero." };
        return { valid: true };
      },
    });
  }

  public getQuestionsByCategory(category: QuestionCategory): MathRuleQuestion[] {
    return this.questions.filter((q) => q.category === category);
  }

  public getAllQuestions(): MathRuleQuestion[] {
    return [...this.questions];
  }

  /**
   * Deterministically evaluates answers, validating constraints, and calculating exact 6-decimal parameters.
   */
  public evaluateAnswers(answers: Array<{ questionId: string; answer: any }>): AnswerEvaluationResult[] {
    const results: AnswerEvaluationResult[] = [];
    const answerMap = new Map<string, any>();

    for (const a of answers) {
      answerMap.set(a.questionId, a.answer);
    }

    for (const q of this.questions) {
      if (!answerMap.has(q.questionId)) {
        continue; // Optional answer or question from a different step
      }

      const rawAnswer = answerMap.get(q.questionId);
      const valResult = q.validate(rawAnswer);
      if (!valResult.valid) {
        throw new Error(`[MathRulesQAEngine] Validation error for question '${q.questionId}': ${valResult.error}`);
      }

      let derivedValue = 0;
      if (q.responseType === "SELECT" && q.options) {
        const selectedOpt = q.options.find((opt) => opt.value === rawAnswer);
        derivedValue = selectedOpt?.numericValue !== undefined ? selectedOpt.numericValue : 0;
      } else if (q.responseType === "PERCENTAGE") {
        derivedValue = Number(rawAnswer) / 100.0;
      } else {
        derivedValue = Number(rawAnswer);
      }

      // Exact 6-decimal USDC deterministic precision
      derivedValue = Math.round(derivedValue * 1_000_000) / 1_000_000;

      results.push({
        questionId: q.questionId,
        category: q.category,
        questionText: q.questionText,
        userAnswer: rawAnswer,
        derivedParameterName: q.derivedParameterName,
        derivedValue,
        formattedUsdc: `${derivedValue.toFixed(6)} USDC`,
      });
    }

    // Evaluate Composite Rules (e.g. general operating cash floor, auto-pay threshold)
    this.evaluateCompositeRules(answerMap, results);

    return results;
  }

  /**
   * Persists evaluated Q&A results into the audit ledger math_rules_qa_responses.
   */
  public async persistQAResponses(
    companyId: string,
    results: AnswerEvaluationResult[],
    metadata?: { accountId?: string | null; liabilityId?: string | null }
  ): Promise<void> {
    const records: MathRuleQaResponseRecord[] = results.map((r) => ({
      company_id: companyId,
      account_id: metadata?.accountId || null,
      liability_id: metadata?.liabilityId || null,
      category: r.category,
      question_id: r.questionId,
      question_text: r.questionText,
      user_answer: String(r.userAnswer),
      derived_parameter_name: r.derivedParameterName,
      derived_value: r.derivedValue,
    }));

    await MathRulesQaRepo.recordBatch(records);
  }

  /**
   * Derives composite parameters when coupled question answers are present.
   */
  private evaluateCompositeRules(
    answerMap: Map<string, any>,
    results: AnswerEvaluationResult[]
  ): void {
    // Composite 1: Dynamic Operating Reserve Floor = Burn * Runway * (1 + Volatility)
    if (answerMap.has("GM_MONTHLY_BURN") && answerMap.has("GM_RUNWAY_MONTHS")) {
      const burn = Number(answerMap.get("GM_MONTHLY_BURN"));
      const runway = Number(answerMap.get("GM_RUNWAY_MONTHS"));
      let vol = 0.20;
      if (answerMap.has("GM_REVENUE_VOLATILITY")) {
        const v = answerMap.get("GM_REVENUE_VOLATILITY");
        if (v === "LOW") vol = 0.10;
        else if (v === "HIGH") vol = 0.35;
      }
      const totalReserveFloor = Math.round(burn * runway * (1 + vol) * 1_000_000) / 1_000_000;
      results.push({
        questionId: "GM_COMPOSITE_RESERVE_FLOOR",
        category: "GENERAL_MATH",
        questionText: "Total Calculated Liquid Operational Reserve Floor",
        userAnswer: "COMPOSITE_CALCULATION",
        derivedParameterName: "totalOperatingReserveFloorUsdc",
        derivedValue: totalReserveFloor,
        formattedUsdc: `${totalReserveFloor.toFixed(6)} USDC`,
      });
    }

    // Composite 2: Dynamic Auto-Disbursal Ceiling = HistoricalAvg * BufferRatio * (1 + Creep / 100)
    if (answerMap.has("LM_HISTORICAL_INVOICE_AVG") && answerMap.has("LM_AUTOPAY_BUFFER_RATIO")) {
      const avg = Number(answerMap.get("LM_HISTORICAL_INVOICE_AVG"));
      let buffer = 1.10;
      const bChoice = answerMap.get("LM_AUTOPAY_BUFFER_RATIO");
      if (bChoice === "EXACT_1_00") buffer = 1.00;
      else if (bChoice === "MEDIUM_1_25") buffer = 1.25;

      let creep = 5.0;
      if (answerMap.has("LM_STEALTH_CREEP_TOLERANCE_PCT")) {
        const cChoice = answerMap.get("LM_STEALTH_CREEP_TOLERANCE_PCT");
        if (cChoice === "STRICT_3_PCT") creep = 3.0;
        else if (cChoice === "PERMISSIVE_10_PCT") creep = 10.0;
      }

      const autoPayThreshold = Math.round(avg * buffer * (1 + creep / 100) * 1_000_000) / 1_000_000;
      results.push({
        questionId: "LM_COMPOSITE_AUTOPAY_CEILING",
        category: "LIABILITY_MATH",
        questionText: "Dynamic Auto-Pay Approval Ceiling",
        userAnswer: "COMPOSITE_CALCULATION",
        derivedParameterName: "autoPayThresholdUsdc",
        derivedValue: autoPayThreshold,
        formattedUsdc: `${autoPayThreshold.toFixed(6)} USDC`,
      });
    }
  }
}
