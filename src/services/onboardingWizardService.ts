import crypto from "crypto";
import { keccak256, stringToHex } from "viem";
import { DbClient } from "../database/dbClient.js";
import { WizardSessionRepo, WizardSessionRecord } from "../database/repos/wizardSessionRepo.js";
import { TreasuryAccountsRepo, TreasuryAccountRecord } from "../database/repos/treasuryAccountsRepo.js";
import { LiabilityRepo, LiabilityDbRecord } from "../database/repos/liabilityRepo.js";
import { VendorMasterRepo } from "../database/repos/vendorMasterRepo.js";
import { CompanyProfileRepo, CompanyProfileRecord } from "../database/repos/companyProfileRepo.js";
import { MasterJournalRepo } from "../database/repos/masterJournalRepo.js";
import { AuditLogRepo } from "../database/repos/auditLogRepo.js";
import { MovementPolicyRepo } from "../database/repos/movementPolicyRepo.js";
import { MathRulesQAEngine } from "./mathRulesQAEngine.js";
import { SessionKeyRepo } from "../database/repos/sessionKeyRepo.js";
import { VendorBankRepo } from "../database/repos/vendorBankRepo.js";
import { VendorPaymentPreferenceRepo } from "../database/repos/vendorPaymentPreferenceRepo.js";
import { TenantPolicyManager } from "../config/tenantPolicyManager.js";
import { AccountRole } from "../types/policy.js";
import { LiabilityCategory } from "../types/accounts.js";

export interface WizardSession {
  sessionId: string;
  companyId: string;
  currentStep: number;
  totalSteps: number;
  entryPath: "MANUAL" | "GOOGLE_WORKSPACE" | "MICROSOFT_365" | "ODOO" | "ERPNEXT";
  draftPayload: Record<string, any>;
  completedSteps: number[];
  status: "IN_PROGRESS" | "DRAFT_READY" | "COMPLETED" | "ABANDONED";
}

export interface IOnboardingWizardService {
  createSession(params: { companyId: string; entryPath: string; initialDraft?: Record<string, any> }): Promise<WizardSession>;
  getSession(sessionId: string): Promise<WizardSession | null>;
  saveStepDraft(sessionId: string, step: number, stepPayload: Record<string, any>): Promise<WizardSession>;
  prefillDraftFromConnectedSource(sessionId: string, discoveredData: Record<string, any>): Promise<WizardSession>;
  updateDraft(sessionId: string, updatedDraft: Record<string, any>): Promise<WizardSession>;
  activateOrganization(sessionId: string): Promise<{ success: boolean; companyId: string; dashboardUrl: string }>;
}

export class OnboardingWizardService implements IOnboardingWizardService {
  private mathEngine: MathRulesQAEngine;
  private tenantPolicyManager: TenantPolicyManager;

  constructor(options?: {
    mathEngine?: MathRulesQAEngine;
    tenantPolicyManager?: TenantPolicyManager;
  }) {
    this.mathEngine = options?.mathEngine ?? new MathRulesQAEngine();
    this.tenantPolicyManager = options?.tenantPolicyManager ?? TenantPolicyManager.getInstance();
  }

  /**
   * Initializes a new Onboarding Wizard session for an organization.
   */
  public async createSession(params: {
    companyId: string;
    entryPath: string;
    initialDraft?: Record<string, any>;
  }): Promise<WizardSession> {
    if (!params.companyId || params.companyId.trim().length === 0) {
      throw new Error("WIZARD_VALIDATION_ERROR: companyId is required to start onboarding.");
    }

    const validPaths = ["MANUAL", "GOOGLE_WORKSPACE", "MICROSOFT_365", "ODOO", "ERPNEXT"];
    const normalizedPath = params.entryPath.toUpperCase();
    if (!validPaths.includes(normalizedPath)) {
      throw new Error(`WIZARD_VALIDATION_ERROR: Invalid entry path '${params.entryPath}'. Must be one of: ${validPaths.join(", ")}`);
    }

    const sessionId = `wiz_${params.companyId}_${Date.now()}`;
    const record = await WizardSessionRepo.createSession({
      sessionId,
      companyId: params.companyId,
      entryPath: normalizedPath as any,
      totalSteps: 6,
      initialDraft: params.initialDraft || {},
    });

    return this.mapRecord(record);
  }

  /**
   * Retrieves an existing session by ID.
   */
  public async getSession(sessionId: string): Promise<WizardSession | null> {
    const record = await WizardSessionRepo.getSession(sessionId);
    return record ? this.mapRecord(record) : null;
  }

  /**
   * Saves and validates step-by-step progress for an active wizard session.
   * Enforces core business invariants per step.
   */
  public async saveStepDraft(
    sessionId: string,
    step: number,
    stepPayload: Record<string, any>
  ): Promise<WizardSession> {
    if (step < 1 || step > 6) {
      throw new Error(`WIZARD_VALIDATION_ERROR: Step must be between 1 and 6, received ${step}.`);
    }

    const session = await WizardSessionRepo.getSession(sessionId);
    if (!session) {
      throw new Error(`WIZARD_NOT_FOUND: Session '${sessionId}' does not exist.`);
    }

    if (session.status === "COMPLETED") {
      throw new Error(`WIZARD_ALREADY_COMPLETED: Session '${sessionId}' is already activated and cannot be edited.`);
    }

    const currentDraft = { ...session.draft_payload };

    // ─────────────────────────────────────────────────────────────────────────────
    // STEP-SPECIFIC VALIDATION AND ENFORCEMENT
    // ─────────────────────────────────────────────────────────────────────────────
    switch (step) {
      case 1: {
        // Step 1: Company Profile
        if (!stepPayload.companyName || stepPayload.companyName.trim().length === 0) {
          throw new Error("STEP_1_VALIDATION: 'companyName' is required.");
        }
        currentDraft.step1_profile = {
          companyName: stepPayload.companyName,
          taxId: stepPayload.taxId || null,
          jurisdiction: stepPayload.jurisdiction || "US",
          reportingCurrency: stepPayload.reportingCurrency || "USD",
          businessDescription: stepPayload.businessDescription || "Autonomous treasury operations on Arc L1",
        };
        break;
      }

      case 2: {
        // Step 2: Mathematical Rules Q&A
        if (Array.isArray(stepPayload.answers) && stepPayload.answers.length > 0) {
          const evalResults = this.mathEngine.evaluateAnswers(stepPayload.answers);
          await this.mathEngine.persistQAResponses(session.company_id, evalResults);
          currentDraft.step2_math_rules = {
            rawAnswers: stepPayload.answers,
            derivedParameters: evalResults.reduce((acc, r) => {
              acc[r.derivedParameterName] = r.derivedValue;
              return acc;
            }, {} as Record<string, number>),
          };
        } else if (stepPayload.derivedParameters) {
          currentDraft.step2_math_rules = stepPayload;
        }
        break;
      }

      case 3: {
        // Step 3: Declared Policies for all Agent Actions
        currentDraft.step3_declared_policies = {
          costCenterRules: Array.isArray(stepPayload.costCenterRules) ? stepPayload.costCenterRules : [],
          anomalyTolerances: stepPayload.anomalyTolerances || {
            maxPriceHikePercentage: 15.0,
            flagUnregisteredVendors: true,
            requireThreeWayMatch: true,
          },
          reviewTriggers: Array.isArray(stepPayload.reviewTriggers) ? stepPayload.reviewTriggers : [],
          investmentPolicies: stepPayload.investmentPolicies || {
            targetAllocationRatio: 0.80,
            minSweepThresholdUsdc: 50.0,
            hysteresisBandUsdc: 25.0,
          },
        };
        break;
      }

      case 4: {
        // Step 4: Operating Accounts & Per-Account Policies
        if (!Array.isArray(stepPayload.accounts) || stepPayload.accounts.length === 0) {
          throw new Error("STEP_4_VALIDATION: At least one operating account must be configured in Step 4.");
        }

        const validRoles: AccountRole[] = ["TREASURY_RESERVE", "PAYROLL", "OPEX_DEV", "OPEX_GROWTH", "OPEX_LEGAL", "TAX_ESCROW", "DEFI_DISPATCH"];
        const seenIds = new Set<string>();

        const validatedAccounts = stepPayload.accounts.map((acc: any) => {
          if (!acc.accountId || !acc.name || !acc.role) {
            throw new Error(`STEP_4_VALIDATION: Account requires 'accountId', 'name', and 'role'. Received: ${JSON.stringify(acc)}`);
          }
          if (seenIds.has(acc.accountId)) {
            throw new Error(`STEP_4_VALIDATION: Duplicate accountId '${acc.accountId}' detected.`);
          }
          seenIds.add(acc.accountId);

          if (!validRoles.includes(acc.role)) {
            throw new Error(`STEP_4_VALIDATION: Invalid role '${acc.role}' for account '${acc.accountId}'. Valid roles: ${validRoles.join(", ")}`);
          }

          return {
            accountId: acc.accountId,
            name: acc.name,
            role: acc.role,
            minOperatingFloorUsdc: Number(acc.minOperatingFloorUsdc ?? (acc.role === "PAYROLL" ? 100.0 : 50.0)),
            safetyBufferRatio: Number(acc.safetyBufferRatio ?? (acc.role === "PAYROLL" ? 1.25 : 1.20)),
            perTxCapUsdc: Number(acc.perTxCapUsdc ?? 500.0),
            dailyCapUsdc: Number(acc.dailyCapUsdc ?? 5000.0),
            weeklyCapUsdc: Number(acc.weeklyCapUsdc ?? 25000.0),
            monthlyCapUsdc: Number(acc.monthlyCapUsdc ?? 100000.0),
            authorizedCategories: Array.isArray(acc.authorizedCategories) ? acc.authorizedCategories : ["GENERAL_OPEX"],
            maxAutonomousSweepUsdc: Number(acc.maxAutonomousSweepUsdc ?? (acc.role === "PAYROLL" ? 0.0 : 1000.0)),
            excludeFromWaterfall: acc.role === "PAYROLL" ? true : Boolean(acc.excludeFromWaterfall),
            walletAddress: acc.walletAddress || null,
          };
        });

        currentDraft.step4_accounts = validatedAccounts;
        break;
      }

      case 5: {
        // Step 5: Recurring Liabilities (Strictly user-attached to Step 4 accounts)
        if (!currentDraft.step4_accounts || currentDraft.step4_accounts.length === 0) {
          throw new Error("STEP_5_VALIDATION_ERROR: Cannot configure liabilities before configuring accounts in Step 4.");
        }

        const validAccountIds = new Set<string>(currentDraft.step4_accounts.map((a: any) => a.accountId));
        const liabilitiesList = Array.isArray(stepPayload.liabilities) ? stepPayload.liabilities : [];

        const validatedLiabilities = liabilitiesList.map((liab: any) => {
          if (!liab.title || !liab.accountId || !liab.vendorId || liab.amountUsdc === undefined) {
            throw new Error(`STEP_5_VALIDATION_ERROR: Liability requires 'title', 'accountId', 'vendorId', and 'amountUsdc'.`);
          }

          // Strict Invariant 2: User must attach each liability to an account finalized in Step 4
          if (!validAccountIds.has(liab.accountId)) {
            throw new Error(
              `LIABILITY_ATTACHMENT_ERROR (Invariant 2): Liability '${liab.title}' references account '${liab.accountId}', which was not declared in Step 4. Available accounts: [${Array.from(validAccountIds).join(", ")}]`
            );
          }

          const amountNum = Number(liab.amountUsdc);
          if (isNaN(amountNum) || amountNum <= 0) {
            throw new Error(`STEP_5_VALIDATION_ERROR: Liability amount must be positive. Received: ${liab.amountUsdc}`);
          }

          const validRails = [
            "DISBURSAL_VAULT",
            "MODULAR_SESSION_KEY",
            "MODULAR_SESSION_KEYS",
            "ERC3009_AUTHORIZATION",
            "GATEWAY_X402",
            "FIAT_PAYOUT",
          ];
          const rawRail = liab.preferredPaymentRail || (liab.fiatDetails ? "FIAT_PAYOUT" : "DISBURSAL_VAULT");
          const rail = rawRail === "MODULAR_SESSION_KEYS" ? "MODULAR_SESSION_KEY" : rawRail;
          if (!validRails.includes(rawRail)) {
            throw new Error(`STEP_5_VALIDATION_ERROR: Invalid payment rail '${rawRail}'. Must be one of: ${validRails.join(", ")}`);
          }

          const fiatDetails = liab.fiatDetails || (liab.paymentRailConfig?.beneficiaryBank ? liab.paymentRailConfig.beneficiaryBank : undefined);
          const subMethod = liab.preferredSubMethod || fiatDetails?.paymentSubMethod || (fiatDetails?.cardToken ? "PUSH_TO_CARD" : (rail === "FIAT_PAYOUT" ? "FEDWIRE" : undefined));

          return {
            title: liab.title,
            accountId: liab.accountId,
            vendorId: liab.vendorId,
            vendorName: liab.vendorName || liab.vendorId,
            category: (liab.category as LiabilityCategory) || "SAAS",
            amountUsdc: amountNum,
            dueDate: liab.dueDate ? new Date(liab.dueDate).toISOString() : new Date(Date.now() + 14 * 86400 * 1000).toISOString(),
            frequencyCron: liab.frequencyCron || "0 0 1 * *",
            payoutAddress: liab.payoutAddress || null,
            serviceUrl: liab.serviceUrl || liab.cryptoDetails?.serviceEndpointUrl || null,
            poReference: liab.poReference || null,
            preferredPaymentRail: rail,
            preferredSubMethod: subMethod,
            fiatDetails: fiatDetails || null,
            cryptoDetails: liab.cryptoDetails || null,
            paymentRailConfig: {
              ...(liab.paymentRailConfig || {}),
              subMethod,
              beneficiaryBank: fiatDetails,
            },
            disbursalRules: liab.disbursalRules || {
              autoPayThresholdUsdc: 500,
              requireThreeWayMatch: true,
              preFlightLeadTimeHours: 48,
            },
            waterfallOverride: liab.waterfallOverride || null,
          };
        });

        currentDraft.step5_liabilities = validatedLiabilities;
        break;
      }

      case 6: {
        // Step 6: Review, Disbursal Rules, Waterfall & Finalization
        currentDraft.step6_review = {
          waterfallConditions: stepPayload.waterfallConditions || {
            requireHumanApprovalForNonOperational: true,
            strictPayrollExclusion: true,
          },
          disbursalSettings: stepPayload.disbursalSettings || {
            defaultAutoPayCeilingUsdc: 500.0,
            requireThreeWayMatch: true,
            preFlightStagingHours: 48,
          },
          cfoConfirmation: Boolean(stepPayload.cfoConfirmation),
        };
        break;
      }
    }

    const nextStep = Math.min(step + 1, 6);
    const newStatus = step === 6 || (currentDraft.step4_accounts && currentDraft.step5_liabilities)
      ? "DRAFT_READY"
      : "IN_PROGRESS";

    const updated = await WizardSessionRepo.updateStepDraft({
      sessionId,
      currentStep: nextStep,
      draftPayload: currentDraft,
      completedStep: step,
      status: newStatus,
    });

    return this.mapRecord(updated);
  }

  /**
   * Path B: Pre-populates the wizard draft from connected SaaS, Cloud, or ERP sources.
   * Extracts candidate cost centers and discovered liabilities for user review.
   */
  public async prefillDraftFromConnectedSource(
    sessionId: string,
    discoveredData: Record<string, any>
  ): Promise<WizardSession> {
    const session = await WizardSessionRepo.getSession(sessionId);
    if (!session) {
      throw new Error(`WIZARD_NOT_FOUND: Session '${sessionId}' does not exist.`);
    }

    const currentDraft = { ...session.draft_payload };

    // 1. Ingest Discovered Cost Centers into Candidate Step 4 Accounts
    if (Array.isArray(discoveredData.costCenters) && discoveredData.costCenters.length > 0) {
      currentDraft.step4_accounts = discoveredData.costCenters.map((cc: any) => ({
        accountId: cc.accountId || cc.id,
        name: cc.name,
        role: cc.role || "OPEX_DEV",
        minOperatingFloorUsdc: cc.monthlyCommittedSpend ? Math.max(50.0, cc.monthlyCommittedSpend * 0.1) : 50.0,
        safetyBufferRatio: cc.role === "PAYROLL" ? 1.25 : 1.20,
        perTxCapUsdc: 2500.0,
        dailyCapUsdc: 15000.0,
        weeklyCapUsdc: 50000.0,
        monthlyCapUsdc: 200000.0,
        authorizedCategories: cc.categories || ["INFRASTRUCTURE", "SAAS", "GENERAL_OPEX"],
        maxAutonomousSweepUsdc: cc.role === "PAYROLL" ? 0.0 : 5000.0,
        excludeFromWaterfall: cc.role === "PAYROLL",
        walletAddress: null,
      }));
    }

    // 2. Ingest Discovered Liabilities
    if (Array.isArray(discoveredData.invoices) && discoveredData.invoices.length > 0) {
      currentDraft.step5_liabilities = discoveredData.invoices.map((inv: any) => ({
        title: inv.title || `Invoice ${inv.invoiceNumber || inv.id || "SAAS"}`,
        accountId: inv.costCenter || (currentDraft.step4_accounts ? currentDraft.step4_accounts[0]?.accountId : "acc_general_ops"),
        vendorId: inv.supplierId || inv.vendorId || "vendor_discovered",
        vendorName: inv.supplierName || inv.vendorName || "Discovered Vendor",
        category: inv.category || "SAAS",
        amountUsdc: Number(inv.amountUsdc || inv.amount || 100.0),
        dueDate: inv.dueDate ? new Date(inv.dueDate).toISOString() : new Date(Date.now() + 14 * 86400 * 1000).toISOString(),
        frequencyCron: inv.frequencyCron || "0 0 1 * *",
        payoutAddress: inv.payoutAddress || null,
        serviceUrl: inv.serviceUrl || null,
        poReference: inv.purchaseOrderNumber || inv.poReference || null,
        preferredPaymentRail: inv.serviceUrl ? "GATEWAY_X402" : "DISBURSAL_VAULT",
        paymentRailConfig: {},
        disbursalRules: {
          autoPayThresholdUsdc: 500,
          requireThreeWayMatch: true,
          preFlightLeadTimeHours: 48,
        },
      }));
    }

    // 3. Synthesize Initial Math Q&A Parameters
    const highestBill = discoveredData.invoices?.reduce((max: number, inv: any) => Math.max(max, Number(inv.amountUsdc || 0)), 1000) || 1000;
    currentDraft.step2_math_rules = {
      derivedParameters: {
        single_tx_human_gate_threshold_usdc: highestBill * 1.25,
        aggregate_company_daily_cap_usdc: highestBill * 5,
        max_price_variance_percent: 10,
        target_yield_allocation_ratio: 0.80,
        min_sweep_threshold_usdc: 50.0,
        hysteresis_band_usdc: 25.0,
      },
    };

    currentDraft.connectedSources = discoveredData.connectedApps || [session.entry_path];

    const updated = await WizardSessionRepo.updateStepDraft({
      sessionId,
      currentStep: 4, // Land user on Step 4 to review and customize candidate accounts
      draftPayload: currentDraft,
      status: "DRAFT_READY",
    });

    return this.mapRecord(updated);
  }

  /**
   * Updates the full draft payload directly.
   */
  public async updateDraft(
    sessionId: string,
    updatedDraft: Record<string, any>
  ): Promise<WizardSession> {
    const session = await WizardSessionRepo.getSession(sessionId);
    if (!session) {
      throw new Error(`WIZARD_NOT_FOUND: Session '${sessionId}' does not exist.`);
    }

    const updated = await WizardSessionRepo.updateStepDraft({
      sessionId,
      currentStep: session.current_step,
      draftPayload: updatedDraft,
    });

    return this.mapRecord(updated);
  }

  /**
   * Finalizes the onboarding flow and activates the organization.
   * Atomically provisions all accounts, liabilities, vendor registries, policies, and ledger vouchers.
   */
  public async activateOrganization(
    sessionId: string
  ): Promise<{ success: boolean; companyId: string; dashboardUrl: string }> {
    const session = await WizardSessionRepo.getSession(sessionId);
    if (!session) {
      throw new Error(`WIZARD_NOT_FOUND: Session '${sessionId}' does not exist.`);
    }

    const draft = session.draft_payload;
    const companyId = session.company_id;

    if (!draft.step4_accounts || draft.step4_accounts.length === 0) {
      throw new Error("ACTIVATION_FAILED: No operating accounts found in wizard draft. Step 4 must be completed.");
    }

    const accounts: any[] = draft.step4_accounts;
    const liabilities: any[] = draft.step5_liabilities || [];
    const profileData = draft.step1_profile || { companyName: companyId };
    const declaredPolicies = draft.step3_declared_policies || {};
    const mathRules = draft.step2_math_rules || {};

    // ─────────────────────────────────────────────────────────────────────────────
    // ATOMIC TRANSACTION: PROVISION ORGANIZATION ASSETS
    // ─────────────────────────────────────────────────────────────────────────────
    const pool = DbClient.getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // 1. Provision Company Profile in PostgreSQL
      const profileRecord: CompanyProfileRecord = {
        company_id: companyId,
        company_name: profileData.companyName,
        business_description: profileData.businessDescription || "Autonomous enterprise treasury on Arc L1",
        connected_apps: draft.connectedSources || [session.entry_path],
        discovered_cost_centers: accounts.map((a) => ({
          accountId: a.accountId,
          name: a.name,
          role: a.role,
          allocatedMonthlySpendUsdc: a.dailyCapUsdc ? a.dailyCapUsdc * 20 : 5000,
        })),
        inferred_policies: {
          mathematicalRules: mathRules.derivedParameters || {},
          declaredPolicies: declaredPolicies,
        },
        activation_status: "ACTIVATED",
      };
      await CompanyProfileRepo.upsertProfile(profileRecord);

      // 2. Provision Step 4 Operating Accounts
      for (const acc of accounts) {
        const deterministicWallet: `0x${string}` = acc.walletAddress && acc.walletAddress.startsWith("0x")
          ? acc.walletAddress
          : (`0x${crypto.createHash("sha256").update(`${companyId}:${acc.accountId}`).digest("hex").slice(0, 40)}` as `0x${string}`);

        await TreasuryAccountsRepo.upsertAccount({
          account_id: acc.accountId,
          company_id: companyId,
          name: acc.name,
          role: acc.role,
          wallet_address: deterministicWallet,
          chain_id: 5042002, // Arc Testnet
          min_operating_floor_usdc: acc.minOperatingFloorUsdc,
          safety_buffer_ratio: acc.safetyBufferRatio,
          is_active: true,
          per_tx_cap_usdc: acc.perTxCapUsdc,
          daily_cap_usdc: acc.dailyCapUsdc,
          weekly_cap_usdc: acc.weeklyCapUsdc,
          monthly_cap_usdc: acc.monthlyCapUsdc,
          authorized_categories: acc.authorizedCategories,
          max_autonomous_sweep_usdc: acc.maxAutonomousSweepUsdc,
          exclude_from_waterfall: acc.excludeFromWaterfall,
          account_declared_policies: acc.accountDeclaredPolicies || {},
        });
      }

      // 3. Register Vendors & Provision Step 5 Liabilities with Unified Fiat/Crypto Settings
      for (const liab of liabilities) {
        let bankAccountId: string | undefined;
        const isFiat = liab.preferredPaymentRail === "FIAT_PAYOUT" || !!liab.fiatDetails;

        // 3a. Register Bank Account if Fiat Details provided
        if (isFiat) {
          const fiat = liab.fiatDetails || liab.paymentRailConfig?.beneficiaryBank;
          if (fiat) {
            const subMethod = liab.preferredSubMethod || fiat.paymentSubMethod || (fiat.cardToken ? "PUSH_TO_CARD" : "FEDWIRE");
            const bankRecord = await VendorBankRepo.createBankAccount({
              vendor_id: liab.vendorId,
              account_holder_name: fiat.accountHolderName || liab.vendorName || liab.vendorId,
              iban_account_number: fiat.ibanOrAccountNumber || (fiat.accountNumber || "N/A"),
              routing_swift: fiat.routingOrSwift || fiat.routingNumber || (subMethod === "PUSH_TO_CARD" ? "CARD_OCT" : "021000018"),
              bank_name: fiat.bankName,
              bank_country: fiat.bankCountry || "US",
              payment_sub_method: subMethod,
              card_token: fiat.cardToken || null,
              card_last4: fiat.cardLast4 || (fiat.ibanOrAccountNumber && fiat.ibanOrAccountNumber.length === 16 ? fiat.ibanOrAccountNumber.slice(-4) : null),
              card_network: fiat.cardNetwork || null,
              is_verified: true,
              verified_by_admin: "ONBOARDING_WIZARD",
            });
            bankAccountId = bankRecord.bank_account_id;
          }
        }

        // 3b. Determine Verified Payout Address for Vendor Master
        let payoutAddr = liab.payoutAddress;
        if (!payoutAddr || typeof payoutAddr !== "string" || !payoutAddr.startsWith("0x") || payoutAddr.length !== 42) {
          payoutAddr = liab.cryptoDetails?.walletAddress || null;
        }

        // Register in Vendor Master Registry
        await VendorMasterRepo.registerVendor({
          vendor_id: liab.vendorId,
          name: liab.vendorName || liab.vendorId,
          verified_payout_address: payoutAddr && payoutAddr.startsWith("0x") ? (payoutAddr as `0x${string}`) : null,
          verified_by_admin: "ONBOARDING_WIZARD",
          last_verified_at: new Date(),
          change_lock: true,
        });

        // 3c. Persist to VendorPaymentPreferenceRepo
        await VendorPaymentPreferenceRepo.setPreference({
          vendor_id: liab.vendorId,
          preferred_rail: liab.preferredPaymentRail || (isFiat ? "FIAT_PAYOUT" : "DISBURSAL_VAULT"),
          preferred_sub_method: liab.preferredSubMethod || null,
          crypto_wallet_address: liab.cryptoDetails?.walletAddress || (payoutAddr && payoutAddr.startsWith("0x") ? payoutAddr : null),
          crypto_chain_id: liab.cryptoDetails?.chainId ?? 5042,
          crypto_token_symbol: liab.cryptoDetails?.tokenSymbol || "USDC",
          bank_account_id: bankAccountId || null,
          service_endpoint_url: liab.serviceUrl || liab.cryptoDetails?.serviceEndpointUrl || null,
          session_key_id: liab.paymentRailConfig?.sessionKeyId || liab.cryptoDetails?.sessionKeyId || null,
          configuration_payload: {
            disbursalRules: liab.disbursalRules,
            fiatDetails: liab.fiatDetails,
          },
        });

        // Compute Document Hashes
        const poHash = liab.poReference
          ? keccak256(stringToHex(`PO:${liab.poReference}:${liab.amountUsdc}`))
          : null;
        const invHash = keccak256(stringToHex(`INV:${liab.title}:${liab.amountUsdc}:${Date.now()}`));

        const updatedConfig = {
          ...(liab.paymentRailConfig || {}),
          subMethod: liab.preferredSubMethod,
          bankAccountId,
          serviceUrl: liab.serviceUrl || liab.cryptoDetails?.serviceEndpointUrl,
          sessionKeyId: liab.paymentRailConfig?.sessionKeyId || liab.cryptoDetails?.sessionKeyId,
          beneficiaryBank: liab.fiatDetails || liab.paymentRailConfig?.beneficiaryBank,
        };

        await LiabilityRepo.createLiability({
          company_id: companyId,
          account_id: liab.accountId,
          vendor_id: liab.vendorId,
          title: liab.title,
          category: liab.category,
          amount_usdc: liab.amountUsdc,
          due_date: new Date(liab.dueDate),
          frequency_cron: liab.frequencyCron || "0 0 1 * *",
          payout_address: isFiat && !liab.payoutAddress?.startsWith("0x") ? (bankAccountId || liab.vendorId) : payoutAddr,
          source_po_hash: poHash,
          source_invoice_hash: invHash,
          status: "SCHEDULED",
          preferred_payment_rail: liab.preferredPaymentRail || (isFiat ? "FIAT_PAYOUT" : "DISBURSAL_VAULT"),
          payment_rail_config: updatedConfig,
          disbursal_rules: liab.disbursalRules || {},
          waterfall_override: liab.waterfallOverride || null,
        });

        if (liab.preferredPaymentRail === "MODULAR_SESSION_KEY") {
          const sessionKeyId = liab.paymentRailConfig?.sessionKeyId || `session_${liab.vendorId}`;
          const maxCycleUsdc = Number(liab.paymentRailConfig?.maxAmountPerCycleUsdc || liab.amountUsdc * 2 || 1000.0);
          const cycleDuration = Number(liab.paymentRailConfig?.cycleDurationSeconds || 30 * 86400);
          const validUntil = Math.floor(Date.now() / 1000) + 365 * 86400;
          await SessionKeyRepo.upsertSessionKey({
            session_key_id: sessionKeyId,
            account_id: liab.accountId,
            allowed_recipient: payoutAddr as `0x${string}`,
            max_amount_per_cycle_usdc: maxCycleUsdc,
            cycle_duration_seconds: cycleDuration,
            current_cycle_spent_usdc: 0,
            valid_until_timestamp: validUntil,
            public_key_hex: `0x${crypto.createHash("sha256").update(`${companyId}:${sessionKeyId}`).digest("hex")}`,
            is_active: true,
          });
        }
      }

      // 4. Record Genesis Voucher in Master System Journal
      const primaryAccount = accounts[0].accountId;
      await MasterJournalRepo.appendEntry({
        account_id: primaryAccount,
        company_id: companyId,
        action_type: "GENESIS_ONBOARDING",
        debit_account: `${companyId}:TREASURY_EQUITY`,
        credit_account: `${companyId}:${primaryAccount}`,
        amount_usdc: 0.0,
        document_ref: `GENESIS_${companyId}_${Date.now()}`,
      });

      // 5. Append Audit Log
      await AuditLogRepo.appendAuditLog({
        account_id: primaryAccount,
        action_type: "ORGANIZATION_ONBOARDING_ACTIVATED",
        amount_usdc: 0.0,
        is_autonomous: true,
        reason: `Onboarding completed successfully via path '${session.entry_path}'. ${accounts.length} accounts and ${liabilities.length} liabilities provisioned.`,
        pre_state_snapshot: { status: "IN_PROGRESS" },
        post_state_snapshot: { status: "ACTIVATED", companyId, accountsCount: accounts.length, liabilitiesCount: liabilities.length },
        actor_agent: "OnboardingWizardService",
      });

      // 6. Mark Wizard Session Completed
      await WizardSessionRepo.updateStatus(sessionId, "COMPLETED");

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    // Invalidate Multi-Tenant Policy Cache
    await this.tenantPolicyManager.invalidateCache(companyId);

    return {
      success: true,
      companyId,
      dashboardUrl: `/dashboard/${companyId}`,
    };
  }

  private mapRecord(record: WizardSessionRecord): WizardSession {
    return {
      sessionId: record.session_id,
      companyId: record.company_id,
      currentStep: record.current_step,
      totalSteps: record.total_steps,
      entryPath: record.entry_path,
      draftPayload: record.draft_payload || {},
      completedSteps: Array.isArray(record.completed_steps) ? record.completed_steps : [],
      status: record.status,
    };
  }
}
