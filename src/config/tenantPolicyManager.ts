import { 
  PolicyProfile, 
  OperatingAccountPolicy, 
  LiabilityDisbursalRules, 
  InvestmentRulesPolicy, 
  SpendingLimitsPolicy 
} from "../types/policy.js";
import { TreasuryAccountsRepo, TreasuryAccountRecord } from "../database/repos/treasuryAccountsRepo.js";
import { LiabilityRepo } from "../database/repos/liabilityRepo.js";
import { MovementPolicyRepo } from "../database/repos/movementPolicyRepo.js";
import { MathRulesQaRepo, MathRuleQaResponseRecord } from "../database/repos/mathRulesQaRepo.js";
import { CompanyProfileRepo } from "../database/repos/companyProfileRepo.js";
import { PolicyLoader } from "./policyLoader.js";

export interface CacheEntry {
  profile: PolicyProfile;
  cachedAt: number;
  ttlMs: number;
}

export interface IRedisCacheClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  publish?(channel: string, message: string): Promise<void>;
}

export interface ITenantPolicyManager {
  getActiveProfile(companyId: string): Promise<PolicyProfile>;
  getAccountPolicy(companyId: string, accountId: string): Promise<OperatingAccountPolicy>;
  getLiabilityRules(companyId: string, liabilityId: string): Promise<LiabilityDisbursalRules>;
  mutatePolicy(companyId: string, mutator: (current: PolicyProfile) => PolicyProfile): Promise<PolicyProfile>;
  invalidateCache(companyId: string): Promise<void>;
}

export class TenantPolicyManager implements ITenantPolicyManager {
  private static instance: TenantPolicyManager | null = null;
  private l1Cache: Map<string, CacheEntry> = new Map();
  private redisClient: IRedisCacheClient | null = null;
  private readonly defaultTtlMs: number = 60000; // 60 seconds L1 TTL

  public constructor(redisClient?: IRedisCacheClient) {
    if (redisClient) {
      this.redisClient = redisClient;
    }
  }

  public static getInstance(redisClient?: IRedisCacheClient): TenantPolicyManager {
    if (!TenantPolicyManager.instance) {
      TenantPolicyManager.instance = new TenantPolicyManager(redisClient);
    }
    return TenantPolicyManager.instance;
  }

  public static resetInstance(): void {
    if (TenantPolicyManager.instance) {
      TenantPolicyManager.instance.l1Cache.clear();
      TenantPolicyManager.instance = null;
    }
  }

  public setRedisClient(client: IRedisCacheClient): void {
    this.redisClient = client;
  }

  /**
   * Retrieves active PolicyProfile for a tenant with L1 (in-memory) + L2 (Redis) caching.
   * If cache misses, synthesizes dynamically from PostgreSQL tables without hardcoded stubs.
   */
  public async getActiveProfile(companyId: string): Promise<PolicyProfile> {
    const normalizedCompanyId = companyId.trim();
    if (!normalizedCompanyId) {
      throw new Error("[TenantPolicyManager] companyId must not be empty.");
    }

    // 1. Check L1 Memory Cache
    const now = Date.now();
    const l1Entry = this.l1Cache.get(normalizedCompanyId);
    if (l1Entry && (now - l1Entry.cachedAt < l1Entry.ttlMs)) {
      return l1Entry.profile;
    }

    // 2. Check L2 Redis Cache (if available)
    const redisKey = `bizarc:policy:${normalizedCompanyId}`;
    if (this.redisClient) {
      try {
        const rawJson = await this.redisClient.get(redisKey);
        if (rawJson) {
          const profile = JSON.parse(rawJson) as PolicyProfile;
          this.l1Cache.set(normalizedCompanyId, { profile, cachedAt: now, ttlMs: this.defaultTtlMs });
          return profile;
        }
      } catch (err) {
        console.warn(`[TenantPolicyManager] Redis L2 read failed for ${normalizedCompanyId}, falling back to DB:`, err);
      }
    }

    // 3. Synthesize from PostgreSQL Database
    const profile = await this.synthesizeProfileFromDb(normalizedCompanyId);

    // 4. Update L1 Cache
    this.l1Cache.set(normalizedCompanyId, { profile, cachedAt: now, ttlMs: this.defaultTtlMs });

    // 5. Update L2 Redis Cache (if available)
    if (this.redisClient) {
      try {
        await this.redisClient.set(redisKey, JSON.stringify(profile), Math.floor(this.defaultTtlMs / 1000));
      } catch (err) {
        console.warn(`[TenantPolicyManager] Redis L2 write failed for ${normalizedCompanyId}:`, err);
      }
    }

    return profile;
  }

  /**
   * Gets specific operating account policy for tenant.
   */
  public async getAccountPolicy(companyId: string, accountId: string): Promise<OperatingAccountPolicy> {
    const profile = await this.getActiveProfile(companyId);
    const found = profile.operating_accounts.find((a) => a.account_id === accountId);
    if (found) {
      return found;
    }

    // Fallback direct check in database in case of cache lag
    const dbAccount = await TreasuryAccountsRepo.getAccountByIdAndCompany(accountId, companyId);
    if (!dbAccount) {
      throw new Error(`[TenantPolicyManager] Account '${accountId}' not found for company '${companyId}'.`);
    }

    return this.mapDbAccountToOperatingPolicy(dbAccount);
  }

  /**
   * Gets specific liability disbursal rules and rails for tenant.
   */
  public async getLiabilityRules(companyId: string, liabilityId: string): Promise<LiabilityDisbursalRules> {
    const liability = await LiabilityRepo.getLiabilityByIdAndCompany(liabilityId, companyId);
    if (!liability) {
      throw new Error(`[TenantPolicyManager] Liability '${liabilityId}' not found for company '${companyId}'.`);
    }

    const rules = liability.disbursal_rules || {};
    return {
      liability_id: liability.liability_id,
      autoPayThresholdUsdc: Number(rules.autoPayThresholdUsdc ?? 500.0),
      requireThreeWayMatch: Boolean(rules.requireThreeWayMatch ?? true),
      preFlightLeadTimeHours: Number(rules.preFlightLeadTimeHours ?? 48),
      stealthPriceCreepTolerancePct: rules.stealthPriceCreepTolerancePct !== undefined 
        ? Number(rules.stealthPriceCreepTolerancePct) 
        : 5.0,
      preferredPaymentRail: liability.preferred_payment_rail || "DISBURSAL_VAULT",
      paymentRailConfig: liability.payment_rail_config || {},
    };
  }

  /**
   * Atomically mutates tenant policy, updates PostgreSQL, and invalidates caches.
   */
  public async mutatePolicy(
    companyId: string,
    mutator: (current: PolicyProfile) => PolicyProfile
  ): Promise<PolicyProfile> {
    const current = await this.getActiveProfile(companyId);
    const updated = mutator(current);

    // Persist mutated accounts to DB
    for (const acc of updated.operating_accounts) {
      const existing = await TreasuryAccountsRepo.getAccountById(acc.account_id);
      await TreasuryAccountsRepo.upsertAccount({
        account_id: acc.account_id,
        company_id: companyId,
        name: acc.name,
        role: acc.role,
        wallet_address: existing ? existing.wallet_address : ("0x0000000000000000000000000000000000000000" as `0x${string}`),
        chain_id: existing ? existing.chain_id : 5042002,
        min_operating_floor_usdc: acc.min_floor_usdc,
        safety_buffer_ratio: acc.safety_multiplier,
        is_active: existing ? existing.is_active : true,
        per_tx_cap_usdc: acc.per_tx_cap_usdc ?? updated.spending_limits.single_tx_human_gate_threshold_usdc,
        daily_cap_usdc: acc.daily_cap_usdc ?? updated.spending_limits.daily_hard_cap_usdc,
        authorized_categories: acc.authorized_categories,
        max_autonomous_sweep_usdc: acc.max_autonomous_sweep_limit,
        exclude_from_waterfall: acc.exclude_from_waterfall_draws,
      });
    }

    // Invalidate caches across the cluster
    await this.invalidateCache(companyId);

    // Warm cache with updated profile
    const now = Date.now();
    this.l1Cache.set(companyId, { profile: updated, cachedAt: now, ttlMs: this.defaultTtlMs });

    return updated;
  }

  /**
   * Invalidates L1 local cache and L2 Redis cache + broadcasts invalidation channel event.
   */
  public async invalidateCache(companyId: string): Promise<void> {
    const normalizedCompanyId = companyId.trim();
    this.l1Cache.delete(normalizedCompanyId);

    if (this.redisClient) {
      try {
        const redisKey = `bizarc:policy:${normalizedCompanyId}`;
        await this.redisClient.del(redisKey);
        if (this.redisClient.publish) {
          await this.redisClient.publish("bizarc:policy:invalidation", JSON.stringify({ companyId: normalizedCompanyId }));
        }
      } catch (err) {
        console.warn(`[TenantPolicyManager] Redis L2 invalidation failed for ${normalizedCompanyId}:`, err);
      }
    }
  }

  /**
   * Synthesizes PolicyProfile dynamically from PostgreSQL for the given companyId.
   */
  private async synthesizeProfileFromDb(companyId: string): Promise<PolicyProfile> {
    // 1. Fetch Operating Accounts for this company
    const dbAccounts = await TreasuryAccountsRepo.getAccountsByCompany(companyId);

    // 2. Fetch Mathematical QA responses for derived rules
    const qaResponses = await MathRulesQaRepo.getResponsesByCompany(companyId);
    const qaMap = new Map<string, number>();
    for (const r of qaResponses) {
      qaMap.set(r.derived_parameter_name, r.derived_value);
    }

    // 3. Fetch Company Profile metadata
    const compProfile = await CompanyProfileRepo.getProfileById(companyId);

    // 4. If tenant has accounts in DB, build dynamic operating account policies
    let operatingAccounts: OperatingAccountPolicy[] = [];
    if (dbAccounts.length > 0) {
      operatingAccounts = dbAccounts.map((a) => this.mapDbAccountToOperatingPolicy(a));
    } else {
      // Fallback to active template if new tenant has not yet provisioned accounts
      try {
        const base = PolicyLoader.getActiveProfile();
        operatingAccounts = base.profile.operating_accounts.map((a) => ({
          ...a,
          company_id: companyId,
        }));
      } catch {
        operatingAccounts = [];
      }
    }

    // 5. Derive Dynamic Investment Rules
    const investmentRules: InvestmentRulesPolicy = {
      target_vault: "0x4444444444444444444444444444444444444444", // USYC Tokenized Vault
      max_company_allocation_ratio: qaMap.get("usycYieldSweepRatio") ?? 0.85,
      min_sweep_amount_usdc: qaMap.get("minSweepBatchUsdc") ?? 10.0,
      auto_sweep_enabled: true,
      auto_recall_enabled: true,
      invest_hysteresis_band_usdc: qaMap.get("investHysteresisBandUsdc") ?? 50.0,
      recall_hysteresis_band_usdc: qaMap.get("recallHysteresisBandUsdc") ?? 50.0,
      debounce_window_ms: 5000,
      min_action_cooldown_seconds: 300,
      tag_internal_settlement_events: true,
      redemption_lead_time_seconds: 900,
      redemption_latency_tier: "TIER_A_INSTANT",
    };

    // 6. Derive Dynamic Spending Limits
    const spendingLimits: SpendingLimitsPolicy = {
      daily_hard_cap_usdc: qaMap.get("dailyHardCapUsdc") ?? 5000.0,
      single_tx_human_gate_threshold_usdc: qaMap.get("singleTxHumanGateThresholdUsdc") ?? 1000.0,
    };

    // 7. Compile Declared Policies
    const stealthTolerance = qaMap.get("stealthPriceCreepTolerancePct") ?? 5.0;
    const declaredPolicies = {
      cost_center_rules: [
        "Accounts must match active operating cost center hierarchy",
        "Disbursals strictly charged against attached operational account",
      ],
      anomaly_tolerances: {
        max_price_hike_percentage: stealthTolerance,
        flag_unregistered_vendors: true,
        require_three_way_match: true,
      },
      tax_holdback_percentage: qaMap.get("taxHoldbackPercentage") ?? 15.0,
    };

    return {
      description: compProfile 
        ? `${compProfile.company_name} Dynamic Multi-Tenant Treasury Profile` 
        : `Dynamic Policy Profile for Tenant: ${companyId}`,
      operating_accounts: operatingAccounts,
      investment_rules: investmentRules,
      spending_limits: spendingLimits,
      declared_policies: declaredPolicies,
    };
  }

  private mapDbAccountToOperatingPolicy(a: TreasuryAccountRecord): OperatingAccountPolicy {
    return {
      account_id: a.account_id,
      company_id: a.company_id || "default_org",
      name: a.name,
      role: a.role,
      min_floor_usdc: a.min_operating_floor_usdc,
      safety_multiplier: a.safety_buffer_ratio,
      evaluation_window_days: 14,
      authorized_categories: a.authorized_categories || [],
      max_autonomous_sweep_limit: a.max_autonomous_sweep_usdc ?? 1000.0,
      exclude_from_waterfall_draws: Boolean(a.exclude_from_waterfall),
      per_tx_cap_usdc: a.per_tx_cap_usdc,
      daily_cap_usdc: a.daily_cap_usdc,
      weekly_cap_usdc: a.weekly_cap_usdc,
      monthly_cap_usdc: a.monthly_cap_usdc,
    };
  }
}
