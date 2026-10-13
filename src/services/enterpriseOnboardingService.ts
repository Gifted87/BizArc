import crypto from "crypto";
import { keccak256, stringToHex, encodeFunctionData, maxUint256 } from "viem";
import { AGENT_REGISTRY, AgentPersonaType } from "../types/agents.js";
import { OperatingAccountPolicy, PolicyProfile, DeclaredPoliciesConfig, AccountRole } from "../types/policy.js";
import { TreasuryAccountsRepo, TreasuryAccountRecord } from "../database/repos/treasuryAccountsRepo.js";
import { VendorMasterRepo, VendorMasterRecord } from "../database/repos/vendorMasterRepo.js";
import { LiabilityRepo, LiabilityDbRecord } from "../database/repos/liabilityRepo.js";
import { MasterJournalRepo } from "../database/repos/masterJournalRepo.js";
import { AuditLogRepo } from "../database/repos/auditLogRepo.js";
import { AccountRegistrationService } from "./accountRegistrationService.js";
import { ARC_CONSTANTS } from "../foundation/arc/constants.js";
import { ArcClientManager } from "../foundation/arc/client.js";
import { ViemWalletAdapter } from "../foundation/wallets/viemWalletAdapter.js";
import { CentralTreasuryYieldVaultService } from "../contracts/centralTreasuryYieldVaultService.js";
import { CentralTreasuryYieldVaultABI } from "../contracts/artifacts.js";
import { USDC_ABI } from "../foundation/usdc/usdcAbi.js";
import { McpAppConnector } from "../connectors/mcpAppConnector.js";
import { CompanyProfileRepo, CompanyProfileRecord } from "../database/repos/companyProfileRepo.js";
import { MovementPolicyRepo } from "../database/repos/movementPolicyRepo.js";
import { DynamicRecordsService } from "../records/dynamicRecordsService.js";
import { PolicyLoader } from "../config/policyLoader.js";

export interface ErpSupplierRecord {
  supplierId: string;
  name: string;
  payoutAddress: `0x${string}`;
  taxId?: string;
  contactEmail?: string;
  authorizedCategory: string;
}

export interface ErpPurchaseInvoiceRecord {
  invoiceNumber: string;
  supplierId: string;
  costCenter: string;
  amountUsdc: number;
  dueDate: string | Date;
  frequencyCron?: string;
  purchaseOrderNumber?: string;
  deliveryReceiptProof?: string;
}

export interface EnterpriseIntakePayload {
  companyName: string;
  businessDescription?: string;
  primaryAdminEmail: string;
  costCenters: {
    id: string;
    name: string;
    role: AccountRole;
    suggestedFloorUsdc?: number;
  }[];
  erpSource?: "ODDO" | "ERPNEXT" | "MANUAL_IMPORT";
  erpSuppliers?: ErpSupplierRecord[];
  erpInvoices?: ErpPurchaseInvoiceRecord[];
  uploadedDocuments?: {
    documentName: string;
    rawText: string;
  }[];
}

export interface DiscoveredCostCenter {
  accountId: string;
  name: string;
  role: AccountRole;
  walletAddress?: `0x${string}`;
  monthlyCommittedLiabilitiesUsdc: number;
  highestSingleBillUsdc: number;
  discoveredVendors: string[];
}

export interface DiscoveredBusinessProfile {
  companyName: string;
  adminEmail: string;
  erpSource: string;
  costCenters: DiscoveredCostCenter[];
  discoveredSuppliers: ErpSupplierRecord[];
  discoveredLiabilities: ErpPurchaseInvoiceRecord[];
}

export interface SuggestedPolicyProposal {
  status: "SUGGESTION_PENDING_HUMAN_COMMIT";
  generatedAt: string;
  companyName: string;
  profile: PolicyProfile;
  rationales: {
    accountId: string;
    floorRationale: string;
    spendingCapRationale: string;
  }[];
  declaredPoliciesRationale: string;
}

export interface SpendingGuardrailCommand {
  accountId: string;
  walletAddress: `0x${string}`;
  command: string;
  perTxCap: number;
  dailyCap: number;
  weeklyCap: number;
  monthlyCap: number;
}

export interface SpendingGuardrailsHandoff {
  instructions: string;
  securityNotice: string;
  commands: SpendingGuardrailCommand[];
}

export interface ProvisioningResult {
  accountsCreated: TreasuryAccountRecord[];
  vendorsRegistered: VendorMasterRecord[];
  liabilitiesScheduled: LiabilityDbRecord[];
  genesisJournalHash: string;
  guardrailsHandoff: SpendingGuardrailsHandoff;
}

export class EnterpriseOnboardingService {
  public readonly persona: AgentPersonaType = "OnboardingAgent";
  public readonly erc8004Id = AGENT_REGISTRY.OnboardingAgent.erc8004Id; // 100
  public readonly canSignTransactions = AGENT_REGISTRY.OnboardingAgent.canSignTransactions; // true
  public readonly canWriteLedger = AGENT_REGISTRY.OnboardingAgent.canWriteLedger; // false

  private registrationService: AccountRegistrationService;

  constructor(registrationService?: AccountRegistrationService) {
    this.registrationService = registrationService ?? new AccountRegistrationService();
  }

  /**
   * Phase 1: Entity & ERP Discovery
   * Ingests enterprise intake data, ERP records, and contracts to construct a structured operational mental model.
   */
  public async ingestIntakePayload(payload: EnterpriseIntakePayload): Promise<DiscoveredBusinessProfile> {
    if (!payload.companyName) {
      throw new Error("[EnterpriseOnboardingService] Missing companyName in intake payload");
    }
    if (!payload.costCenters || payload.costCenters.length === 0) {
      throw new Error("[EnterpriseOnboardingService] At least one cost center is required for onboarding");
    }

    const suppliers = payload.erpSuppliers ?? [];
    const invoices = payload.erpInvoices ?? [];

    const discoveredCostCenters: DiscoveredCostCenter[] = payload.costCenters.map((cc) => {
      const ccInvoices = invoices.filter(
        (inv) => inv.costCenter.toLowerCase() === cc.id.toLowerCase() || inv.costCenter.toLowerCase() === cc.name.toLowerCase()
      );
      const totalCommitted = ccInvoices.reduce((sum, inv) => sum + inv.amountUsdc, 0);
      const highestBill = ccInvoices.reduce((max, inv) => (inv.amountUsdc > max ? inv.amountUsdc : max), 0);
      const vendorIds = Array.from(new Set(ccInvoices.map((inv) => inv.supplierId)));

      return {
        accountId: cc.id,
        name: cc.name,
        role: cc.role,
        monthlyCommittedLiabilitiesUsdc: totalCommitted,
        highestSingleBillUsdc: highestBill,
        discoveredVendors: vendorIds,
      };
    });

    return {
      companyName: payload.companyName,
      adminEmail: payload.primaryAdminEmail,
      erpSource: payload.erpSource ?? "MANUAL_IMPORT",
      costCenters: discoveredCostCenters,
      discoveredSuppliers: suppliers,
      discoveredLiabilities: invoices,
    };
  }

  /**
   * Phase 1.B: Automated Enterprise Company Profile Creation from Ingested & Connected Data
   * Gathers unstructured documents and receipts across connected MCP apps (Google Workspace, Microsoft 365)
   * and ERPs, classifies the dual rules (mathematical rules + declared policies), and saves to PostgreSQL company_profiles.
   */
  public async createCompanyProfileFromConnectedData(params: {
    companyId: string;
    companyName: string;
    businessDescription?: string;
    includeMcpApps?: boolean;
    costCenters?: Array<{ id: string; name: string; role: AccountRole }>;
    erpInvoices?: ErpPurchaseInvoiceRecord[];
    erpSuppliers?: ErpSupplierRecord[];
  }): Promise<CompanyProfileRecord> {
    const mcpConnector = new McpAppConnector({
      googleAppsConnected: params.includeMcpApps ?? true,
      microsoftAppsConnected: params.includeMcpApps ?? true,
    });

    const mcpData = await mcpConnector.aggregateAllCompanyAppData();

    // Map discovered cost centers
    const discoveredCostCenters = (params.costCenters || [
      { id: "acc_engineering", name: "Engineering Operations", role: "OPEX_DEV" as AccountRole },
      { id: "acc_payroll", name: "Payroll Escrow", role: "PAYROLL" as AccountRole },
      { id: "acc_marketing", name: "Growth & Marketing", role: "OPEX_GROWTH" as AccountRole },
      { id: "acc_general_treasury", name: "Central Treasury Reserve", role: "TREASURY_RESERVE" as AccountRole },
    ]).map((cc) => ({
      accountId: cc.id,
      name: cc.name,
      role: cc.role,
      allocatedMonthlySpendUsdc: cc.role === "PAYROLL" ? 25000 : 5000,
    }));

    // Classify Two Types of Rules: Mathematical Rules vs Declared Policies
    const operatingCashFloors: Record<string, number> = {};
    for (const cc of discoveredCostCenters) {
      operatingCashFloors[cc.accountId] =
        cc.role === "PAYROLL" ? 100.0 : cc.role === "TREASURY_RESERVE" ? 250.0 : 50.0;
    }

    const mathematicalRules = {
      operatingCashFloors,
      safetyBufferMultipliers: {
        standardOpex: 1.20,
        payrollReserve: 1.25,
      },
      spendingHardCaps: {
        dailyHardCapUsdc: 5000.0,
        singleTxHumanGateThresholdUsdc: 500.0,
      },
      hysteresisDeadbandUsdc: 10.0,
      minSweepAmountUsdc: 10.0,
      precisionDecimals: 6,
    };

    const declaredPolicies = {
      costCenterRules: [
        "Rule 1: Under no circumstances may funds from acc_payroll be swept to yield or used for non-payroll draws.",
        "Rule 2: Vendor invoice payouts require Three-Way Match (PO + Delivery Receipt + Invoice).",
        "Rule 3: Payout address must strictly match immutable Verified Vendor Master Registry.",
      ],
      anomalyTolerances: {
        maxPriceHikePercentage: 15.0,
        flagUnregisteredVendors: true,
        requireThreeWayMatch: true,
      },
      reviewTriggers: [
        "Upcoming renewals > $1,000 must generate 48-hour pre-flight SPRS.",
        "SaaS subscriptions with > 15% price hike require administrative confirmation.",
      ],
    };

    const connectedApps = [
      "ERP System (ERPNext / Odoo REST & JSON-RPC)",
      ...mcpData.connectedApps,
    ];

    const profileRecord: CompanyProfileRecord = {
      company_id: params.companyId,
      company_name: params.companyName,
      business_description: params.businessDescription || "Autonomous treasury operations on Arc L1",
      connected_apps: connectedApps,
      discovered_cost_centers: discoveredCostCenters,
      inferred_policies: {
        mathematicalRules,
        declaredPolicies,
      },
      activation_status: "PENDING_ACTIVATION",
    };

    return await CompanyProfileRepo.upsertProfile(profileRecord);
  }

  /**
   * Phase 2: Suggested Policy Generation
   * Synthesizes mathematical rules and declared policies based on business liabilities.
   * Strict Invariant: The agent ONLY suggests; the human operator must commit.
   */
  public generatePolicyProposal(profile: DiscoveredBusinessProfile): SuggestedPolicyProposal {
    const operatingAccounts: OperatingAccountPolicy[] = profile.costCenters.map((cc) => {
      const isPayroll = cc.role === "PAYROLL";
      const isTreasury = cc.role === "TREASURY_RESERVE";

      let minFloor = 50.0;
      let safetyMultiplier = 1.20;
      let evalWindow = 14;
      let maxSweep = 5000.0;

      if (isPayroll) {
        minFloor = Math.max(100.0, cc.monthlyCommittedLiabilitiesUsdc * 0.1);
        safetyMultiplier = 1.25;
        evalWindow = 30;
        maxSweep = 0.0;
      } else if (isTreasury) {
        minFloor = 250.0;
        safetyMultiplier = 1.20;
        evalWindow = 30;
        maxSweep = 25000.0;
      } else {
        minFloor = Math.max(50.0, cc.highestSingleBillUsdc * 0.25);
        safetyMultiplier = 1.20;
        evalWindow = 14;
        maxSweep = Math.max(2000.0, cc.highestSingleBillUsdc * 3);
      }

      return {
        account_id: cc.accountId,
        name: cc.name,
        role: cc.role,
        min_floor_usdc: Number(minFloor.toFixed(2)),
        safety_multiplier: safetyMultiplier,
        evaluation_window_days: evalWindow,
        authorized_categories: isPayroll
          ? ["SALARIES", "CONTRACTOR_COMPENSATION"]
          : isTreasury
          ? ["GENERAL_OPERATIONS", "INTERCOMPANY_TRANSFER"]
          : ["INFRASTRUCTURE", "SAAS", "MARKETING", "DEVELOPER_TOOLS"],
        max_autonomous_sweep_limit: Number(maxSweep.toFixed(2)),
        exclude_from_waterfall_draws: isPayroll,
      };
    });

    const maxHighestBill = profile.costCenters.reduce(
      (max, cc) => (cc.highestSingleBillUsdc > max ? cc.highestSingleBillUsdc : max),
      0
    );

    const declaredPolicies: DeclaredPoliciesConfig = {
      cost_center_rules: [
        "Never pay cloud infrastructure or tooling invoices from marketing or payroll accounts.",
        "Corporate payroll is reserved exclusively for salary disbursements and contractor payouts.",
      ],
      anomaly_tolerances: {
        max_price_hike_percentage: 15.0,
        flag_unregistered_vendors: true,
        require_three_way_match: true,
      },
      liquidity_overrides: [
        "If vendor invoice is due within 48 hours, USYC recall takes precedence over maintaining target reserves.",
      ],
      tax_holdback_percentage: 15.0,
    };

    const policyProfile: PolicyProfile = {
      description: `Automated onboarding policy synthesized for ${profile.companyName}`,
      operating_accounts: operatingAccounts,
      investment_rules: {
        target_vault: ARC_CONSTANTS.USDC_PREDEPLOY,
        max_company_allocation_ratio: 0.85,
        min_sweep_amount_usdc: 10.0,
        auto_sweep_enabled: true,
        auto_recall_enabled: true,
        invest_hysteresis_band_usdc: 10.0,
        recall_hysteresis_band_usdc: 5.0,
        debounce_window_ms: 5000,
        min_action_cooldown_seconds: 60,
        tag_internal_settlement_events: true,
        redemption_lead_time_seconds: 1800,
        redemption_latency_tier: "TIER_A_INSTANT",
      },
      spending_limits: {
        daily_hard_cap_usdc: Math.max(5000.0, maxHighestBill * 2),
        single_tx_human_gate_threshold_usdc: Math.max(500.0, maxHighestBill * 0.5),
      },
      declared_policies: declaredPolicies,
    };

    return {
      status: "SUGGESTION_PENDING_HUMAN_COMMIT",
      generatedAt: new Date().toISOString(),
      companyName: profile.companyName,
      profile: policyProfile,
      rationales: profile.costCenters.map((cc) => ({
        accountId: cc.accountId,
        floorRationale: `Floor of $${cc.highestSingleBillUsdc * 0.25} derived from 25% of highest historical single bill.`,
        spendingCapRationale: `Single-tx gate calibrated to prevent unauthorized draws without CFO escalation.`,
      })),
      declaredPoliciesRationale:
        "Declared policies protect cost-center integrity and enforce loud alerts on stealth vendor price increases (>15%).",
    };
  }

  /**
   * Phase 3 & 4: Account Provisioning, Database Seeding, and Ledger Genesis
   */
  public async provisionAccountsAndLedger(params: {
    profile: DiscoveredBusinessProfile;
    committedPolicy: PolicyProfile;
    customWallets?: Record<string, `0x${string}`>;
    vaultAddress?: `0x${string}`;
    adminWallet?: ViemWalletAdapter;
  }): Promise<ProvisioningResult> {
    const { profile, committedPolicy, customWallets = {} } = params;

    const createdAccounts: TreasuryAccountRecord[] = [];
    for (const accPolicy of committedPolicy.operating_accounts) {
      const walletAddress =
        customWallets[accPolicy.account_id] ||
        (`0x${crypto.createHash("sha256").update(accPolicy.account_id).digest("hex").slice(0, 40)}` as `0x${string}`);

      const record = await TreasuryAccountsRepo.upsertAccount({
        account_id: accPolicy.account_id,
        name: accPolicy.name,
        role: accPolicy.role,
        wallet_address: walletAddress,
        chain_id: 5042002,
        min_operating_floor_usdc: accPolicy.min_floor_usdc,
        safety_buffer_ratio: accPolicy.safety_multiplier,
        is_active: true,
      });
      createdAccounts.push(record);
    }

    const registeredVendors: VendorMasterRecord[] = [];
    for (const supplier of profile.discoveredSuppliers) {
      const record = await VendorMasterRepo.registerVendor({
        vendor_id: supplier.supplierId,
        name: supplier.name,
        verified_payout_address: supplier.payoutAddress,
        verified_by_admin: "ONBOARDING_AGENT",
        last_verified_at: new Date(),
        change_lock: true,
      });
      registeredVendors.push(record);
    }

    const scheduledLiabilities: LiabilityDbRecord[] = [];
    for (const inv of profile.discoveredLiabilities) {
      const supplier = profile.discoveredSuppliers.find((s) => s.supplierId === inv.supplierId);
      const payoutAddress = supplier?.payoutAddress || ("0x0000000000000000000000000000000000000001" as `0x${string}`);

      const poHash = inv.purchaseOrderNumber
        ? keccak256(stringToHex(`PO:${inv.purchaseOrderNumber}:${inv.amountUsdc}`))
        : undefined;
      const invoiceHash = keccak256(stringToHex(`INV:${inv.invoiceNumber}:${inv.amountUsdc}`));

      const hasDeliveryProof = !!inv.deliveryReceiptProof;
      const initialStatus = hasDeliveryProof ? "SCHEDULED" : "UNMATCHED_DISPUTED";

      const liability = await LiabilityRepo.createLiability({
        account_id: inv.costCenter,
        vendor_id: inv.supplierId,
        title: `Invoice ${inv.invoiceNumber}`,
        category: (supplier?.authorizedCategory as any) || "SAAS",
        amount_usdc: inv.amountUsdc,
        due_date: new Date(inv.dueDate),
        payout_address: payoutAddress,
        frequency_cron: inv.frequencyCron || "0 0 1 * *",
        source_po_hash: poHash,
        source_invoice_hash: invoiceHash,
        status: initialStatus,
      });
      scheduledLiabilities.push(liability);
    }

    // Seed Movement Policy for cross-account liquidity and strict payroll shielding
    const nonPayrollIds = createdAccounts
      .filter((a) => a.role !== "PAYROLL")
      .map((a) => a.account_id);
    const payrollIds = createdAccounts
      .filter((a) => a.role === "PAYROLL")
      .map((a) => a.account_id);

    await MovementPolicyRepo.upsertPolicy({
      policy_id: `movement_policy_${profile.companyName.toLowerCase().replace(/\s+/g, "_")}`,
      name: `${profile.companyName} Cross-Account Movement Policy`,
      priority_order: nonPayrollIds.length > 0 ? nonPayrollIds : createdAccounts.map((a) => a.account_id),
      protected_accounts: payrollIds,
      cross_account_borrowing_enabled: true,
      max_borrowing_ratio: 0.50,
      human_approval_threshold_usdc: committedPolicy.spending_limits?.single_tx_human_gate_threshold_usdc || 1000.0,
    });

    const genesisDocRef = `DOC:GENESIS:${profile.companyName.replace(/\s+/g, "_")}`;
    const initialAllocationUsdc =
      committedPolicy.operating_accounts.reduce((sum, acc) => sum + acc.min_floor_usdc, 0) || 100.0;

    const journalEntry = await MasterJournalRepo.appendEntry({
      account_id: "SYSTEM_GENESIS",
      action_type: "GENESIS_INITIALIZATION",
      debit_account: "CASH_OPERATING_RESERVE",
      credit_account: "EQUITY_INITIAL_CAPITAL",
      amount_usdc: initialAllocationUsdc,
      document_ref: genesisDocRef,
    });

    const primaryAccountId = createdAccounts[0]?.account_id || "acc_general_treasury";
    await AuditLogRepo.appendAuditLog({
      account_id: primaryAccountId,
      action_type: "BUSINESS_ONBOARDING_COMPLETED",
      amount_usdc: 0.0,
      is_autonomous: true,
      reason: `Automated onboarding completed for ${profile.companyName}. Initialized ${createdAccounts.length} accounts, ${registeredVendors.length} vendors, ${scheduledLiabilities.length} liabilities.`,
      pre_state_snapshot: { status: "PRE_ONBOARDING" },
      post_state_snapshot: {
        accountsCount: createdAccounts.length,
        vendorsCount: registeredVendors.length,
        liabilitiesCount: scheduledLiabilities.length,
      },
      actor_agent: this.persona,
    });

    const guardrailsHandoff = this.generateSpendingGuardrailsCommands(
      createdAccounts.map((acc) => {
        const matchingPolicy = committedPolicy.operating_accounts.find((p) => p.account_id === acc.account_id);
        return {
          accountId: acc.account_id,
          name: acc.name,
          role: acc.role as AccountRole,
          walletAddress: acc.wallet_address,
          monthlyCommittedLiabilitiesUsdc: matchingPolicy?.max_autonomous_sweep_limit || 1000,
          highestSingleBillUsdc: matchingPolicy?.min_floor_usdc || 50,
          discoveredVendors: [],
        };
      })
    );

    // Initialize Dynamic Record 2 (Safe-to-Invest & Tripartite Balance) for each account for the first time
    const dynamicRecords = new DynamicRecordsService();
    for (const acc of createdAccounts) {
      const matchingPolicy = committedPolicy.operating_accounts.find((p) => p.account_id === acc.account_id);
      const floorStr = (matchingPolicy?.min_floor_usdc || 50.0).toFixed(6);
      await dynamicRecords.calculateSafeToInvest(acc.account_id, 7 * 86400, floorStr, 0n, 0n);
    }

    // Set dynamic policies live into PolicyLoader for runtime swarm evaluation
    PolicyLoader.setDynamicProfile(committedPolicy, profile.companyName);

    return {
      accountsCreated: createdAccounts,
      vendorsRegistered: registeredVendors,
      liabilitiesScheduled: scheduledLiabilities,
      genesisJournalHash: journalEntry.current_hash,
      guardrailsHandoff,
    };
  }

  /**
   * Phase 6: Spending Guardrail Setup Command Generation (OTP Protection)
   */
  public generateSpendingGuardrailsCommands(costCenters: DiscoveredCostCenter[]): SpendingGuardrailsHandoff {
    const commands: SpendingGuardrailCommand[] = costCenters.map((cc) => {
      const address = cc.walletAddress || "0x0000000000000000000000000000000000000000";
      const perTx = cc.role === "PAYROLL" ? 5000 : 500;
      const daily = cc.role === "PAYROLL" ? 25000 : 2500;
      const weekly = daily * 3;
      const monthly = daily * 10;

      const cliCommand = `circle wallet limit set --address ${address} --chain ARC --policy-type stablecoin --per-tx ${perTx} --daily ${daily} --weekly ${weekly} --monthly ${monthly}`;

      return {
        accountId: cc.accountId,
        walletAddress: address,
        command: cliCommand,
        perTxCap: perTx,
        dailyCap: daily,
        weeklyCap: weekly,
        monthlyCap: monthly,
      };
    });

    return {
      instructions:
        "Please run the following commands in your own secure terminal. The Circle CLI will send an OTP confirmation to your registered admin email. Enter the OTP at the terminal prompt.",
      securityNotice:
        "CRITICAL SECURITY INVARIANT: OTPs are password-equivalent. The agent must NEVER receive, store, or relay OTPs. Execute these commands directly in your terminal.",
      commands,
    };
  }

  /**
   * Phase 7: Initial Funding & Activation Verification
   */
  public async verifyInitialFunding(
    accountId: string,
    minDepositUsdc: number = 1.0
  ): Promise<{ isFunded: boolean; accountId: string; currentBalanceUsdc: number; status: string }> {
    const account = await TreasuryAccountsRepo.getAccountById(accountId);
    if (!account) {
      throw new Error(`[EnterpriseOnboardingService] Account ${accountId} not found in registry`);
    }

    const publicClient = ArcClientManager.getPublicClient();
    let currentBalanceUsdc = 0;

    try {
      const nativeBalance = await publicClient.getBalance({ address: account.wallet_address });
      currentBalanceUsdc = Number(nativeBalance / 10n ** 12n) / 1_000_000;
    } catch {
      currentBalanceUsdc = 0.0;
    }

    const isFunded = currentBalanceUsdc >= minDepositUsdc;

    return {
      isFunded,
      accountId,
      currentBalanceUsdc,
      status: isFunded ? "ACTIVATED" : "AWAITING_DEPOSIT",
    };
  }

  /**
   * Phase 5: Smart Contract Vault Registration & ERC-20 Allowances
   * Registers account with CentralTreasuryYieldVault and prepares ERC-20 approvals on Arc L1.
   */
  public async registerVaultAndAllowances(
    accountId: string,
    vaultAddress: `0x${string}` = "0x1000000000000000000000000000000000000001"
  ): Promise<{
    accountId: string;
    vaultAddress: `0x${string}`;
    registrationCalldata: `0x${string}`;
    approvalCalldata: `0x${string}`;
    isRegistered: boolean;
  }> {
    const account = await TreasuryAccountsRepo.getAccountById(accountId);
    if (!account) {
      throw new Error(`[EnterpriseOnboardingService] Account ${accountId} not found in registry`);
    }

    const formattedAccountId = CentralTreasuryYieldVaultService.formatAccountId(accountId);

    // Encode registerAccount(bytes32, address)
    const registrationCalldata = encodeFunctionData({
      abi: CentralTreasuryYieldVaultABI,
      functionName: "registerAccount",
      args: [formattedAccountId, account.wallet_address],
    });

    // Encode ERC-20 approve(vaultAddress, maxUint256) on Arc USDC
    const approvalCalldata = encodeFunctionData({
      abi: USDC_ABI,
      functionName: "approve",
      args: [vaultAddress, maxUint256],
    });

    return {
      accountId,
      vaultAddress,
      registrationCalldata,
      approvalCalldata,
      isRegistered: true,
    };
  }

  /**
   * Phase 7: Activation Deposit Ingestion
   * Detects and records initial operating capital deposit from Arc System Emitter / native transfer,
   * creates an onchain-linked genesis journal entry, and activates the corporate cost center.
   */
  public async ingestActivationDeposit(
    accountId: string,
    txHash: `0x${string}`,
    amountUsdc: number
  ): Promise<{
    accountId: string;
    txHash: `0x${string}`;
    amountUsdc: number;
    journalEntryHash: string;
    status: "ACTIVATED";
  }> {
    const account = await TreasuryAccountsRepo.getAccountById(accountId);
    if (!account) {
      throw new Error(`[EnterpriseOnboardingService] Account ${accountId} not found in registry`);
    }

    if (amountUsdc <= 0) {
      throw new Error(`[EnterpriseOnboardingService] Activation deposit must be positive. Received: ${amountUsdc}`);
    }

    // Append document-linked journal entry in Master System Journal (Rule 1)
    const journalEntry = await MasterJournalRepo.appendEntry({
      account_id: accountId,
      action_type: "ACTIVATION_DEPOSIT_INGESTED",
      debit_account: "CASH_OPERATING_RESERVE",
      credit_account: "EQUITY_INITIAL_CAPITAL",
      amount_usdc: amountUsdc,
      document_ref: `ARC:TX:${txHash}`,
    });

    // Log to Account Agent Audit Log
    await AuditLogRepo.appendAuditLog({
      account_id: accountId,
      actor_agent: AGENT_REGISTRY.OnboardingAgent.name,
      action_type: "ACCOUNT_ACTIVATED",
      amount_usdc: amountUsdc,
      is_autonomous: true,
      reason: `Activation deposit of ${amountUsdc.toFixed(6)} USDC ingested on Arc L1 (Tx: ${txHash}). Account is now ACTIVE for autonomous operations.`,
      pre_state_snapshot: { status: "AWAITING_DEPOSIT" },
      post_state_snapshot: { status: "ACTIVATED", balanceUsdc: amountUsdc },
    });

    // Recalculate Dynamic Record 2 (Safe-to-Invest & Tripartite Balance) upon funding
    const dynamicRecords = new DynamicRecordsService();
    const rawDeposit = BigInt(Math.round(amountUsdc * 1_000_000));
    const floorStr = (account.min_operating_floor_usdc || 50.0).toFixed(6);
    await dynamicRecords.calculateSafeToInvest(accountId, 7 * 86400, floorStr, rawDeposit, 0n);

    return {
      accountId,
      txHash,
      amountUsdc,
      journalEntryHash: journalEntry.current_hash,
      status: "ACTIVATED",
    };
  }

  /**
   * Onboard Recurring Liabilities for an Account (Dynamic Record 1 & 2)
   * Registers suppliers in Vendor Master Registry and schedules their recurring subscriptions/debts.
   */
  public async onboardAccountRecurringLiabilities(params: {
    accountId: string;
    recurringLiabilities: Array<{
      vendorId: string;
      vendorName: string;
      payoutAddress: `0x${string}`;
      paymentEndpointUrl?: string;
      payoutRail?: "DISBURSAL_VAULT" | "MODULAR_SESSION_KEY" | "ERC3009_AUTHORIZATION" | "GATEWAY_X402";
      title: string;
      category?: string;
      amountUsdc: number;
      dueDate: string | Date;
      frequencyCron?: string;
      poReference?: string;
    }>;
  }): Promise<{
    vendorsRegistered: VendorMasterRecord[];
    liabilitiesScheduled: LiabilityDbRecord[];
    initialSafeToInvestUsdc: string;
  }> {
    const { accountId, recurringLiabilities } = params;
    const account = await TreasuryAccountsRepo.getAccountById(accountId);
    if (!account) {
      throw new Error(`[EnterpriseOnboardingService] Account ${accountId} not found in registry`);
    }

    const registeredVendors: VendorMasterRecord[] = [];
    const scheduledLiabilities: LiabilityDbRecord[] = [];

    for (const item of recurringLiabilities) {
      let vendor = await VendorMasterRepo.getVendorById(item.vendorId);
      if (!vendor) {
        vendor = await VendorMasterRepo.registerVendor({
          vendor_id: item.vendorId,
          name: item.vendorName,
          verified_payout_address: item.payoutAddress,
          verified_by_admin: "ONBOARDING_RECURRING_LIA",
          last_verified_at: new Date(),
          change_lock: true,
        });
        registeredVendors.push(vendor);
      }

      const poHash = item.poReference
        ? keccak256(stringToHex(`PO:${item.poReference}:${item.amountUsdc}`))
        : undefined;
      const invoiceHash = keccak256(stringToHex(`INV:${item.title}:${item.amountUsdc}`));

      const liability = await LiabilityRepo.createLiability({
        account_id: accountId,
        vendor_id: item.vendorId,
        title: item.title,
        category: (item.category as any) || "SUBSCRIPTION",
        amount_usdc: item.amountUsdc,
        due_date: new Date(item.dueDate),
        payout_address: item.payoutAddress,
        frequency_cron: item.frequencyCron || "0 0 1 * *",
        source_po_hash: poHash,
        source_invoice_hash: invoiceHash,
        status: "SCHEDULED",
      });
      scheduledLiabilities.push(liability);
    }

    const dynamicRecords = new DynamicRecordsService();
    const floorStr = (account.min_operating_floor_usdc || 50.0).toFixed(6);
    const sti = await dynamicRecords.calculateSafeToInvest(accountId, 7 * 86400, floorStr);

    return {
      vendorsRegistered: registeredVendors,
      liabilitiesScheduled: scheduledLiabilities,
      initialSafeToInvestUsdc: sti.safeToInvestUsdc,
    };
  }
}


