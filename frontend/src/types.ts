/**
 * Front-end view models mirroring BizArc's backend and Halcyon Robotics Inc. fixtures.
 * Rule 5 (Refuse Silent Rounding): All money amounts are exact 6-decimal Usdc strings.
 */

export type Usdc = string;
export type Hex = `0x${string}`;

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
  | "OPEX_LEGAL"
  | "PAYROLL"
  | "TREASURY_RESERVE"
  | "TAX_ESCROW"
  | "DEFI_DISPATCH"
  | "CAPEX"
  | (string & {});

export type LiabilityStatus =
  | "SCHEDULED"
  | "AWAITING_APPROVAL"
  | "DISBURSED"
  | "SETTLED"
  | "CANCELLED"
  | "FROZEN"
  | "UNMATCHED_DISPUTED";

export type LiabilityCategory =
  | "SUBSCRIPTION"
  | "DEBT_SERVICE"
  | "PAYROLL"
  | "MILESTONE"
  | "INFRASTRUCTURE"
  | "DEVELOPER_TOOLS"
  | "CONTRACTOR"
  | "SAAS"
  | "MARKETING"
  | "GENERAL_OPERATIONS"
  | (string & {});

export type SprStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "CANCELLED_WITH_INSTRUCTIONS"
  | "EXECUTED";

export type SprActionType =
  | "DISBURSEMENT_PAYMENT"
  | "MULTI_HOP_SUBSCRIPTION_SETTLEMENT"
  | "CROSS_ACCOUNT_REBALANCE"
  | "UNREGISTERED_VENDOR_ADDITION"
  | "HIGH_VALUE_SWEEP_EXEMPTION";

export type PaymentRail =
  | "DISBURSAL_VAULT"
  | "MODULAR_SESSION_KEY"
  | "ERC3009_AUTHORIZATION"
  | "GATEWAY_X402"
  | "FIAT_PAYOUT";

export type FiatSubMethod = "FEDWIRE" | "ACH" | "PUSH_TO_CARD" | "SEPA" | "SWIFT";

export type AgentPersona =
  | "OnboardingAgent"
  | "TreasurySentinelAgent"
  | "LiabilityRadarAgent"
  | "DisbursalRouterAgent"
  | "PolicyComplianceAgent"
  | "LedgerWitnessAgent";

export type SafeToInvestStatus = "SAFE_TO_INVEST" | "RECALL_REQUIRED" | "BALANCED";

export type RouteType =
  | "SINGLE_ACCOUNT"
  | "MULTI_ACCOUNT_WATERFALL"
  | "REJECTED_INSUFFICIENT_FUNDS"
  | "REJECTED_POLICY";

export type EntryPath = "MANUAL" | "GOOGLE_WORKSPACE" | "MICROSOFT_365" | "ODOO" | "ERPNEXT";

export interface Company {
  companyId: string;
  name: string;
  legalName: string;
  taxId: string;
  jurisdiction: string;
  reportingCurrency: string;
  activationStatus: "ACTIVE" | "PENDING_ACTIVATION" | "SUSPENDED";
  network: string;
}

export interface Membership {
  companyId: string;
  companyName: string;
  role: string;
  network: string;
  activationStatus: string;
}

export interface Member {
  userId: string;
  name: string;
  email: string;
  role: "CFO" | "ADMIN" | "APPROVER" | "OPERATOR" | "VIEWER";
  status: "ACTIVE" | "INVITED" | "SUSPENDED";
  emailVerified: boolean;
  mfaEnabled: boolean;
  approverWallet?: Hex;
  lastActiveAt?: string;
}

export interface ApproverWallet {
  address: Hex;
  label: string;
  userName: string;
  addedAt: string;
  addedBy: string;
  status: "ACTIVE" | "PENDING_SPRS" | "REVOKED";
}

export interface ApiKeyRecord {
  keyId: string;
  label: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  createdBy: string;
  lastUsedAt?: string;
  status: "ACTIVE" | "REVOKED";
}

export interface DeviceSession {
  sessionId: string;
  device: string;
  location: string;
  ip: string;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}

export interface AccountDistribution {
  accountId: string;
  name: string;
  role: AccountRole;
  chain: string;
  address: Hex;
  liquidUsdc: Usdc;
  investedUsyc: Usdc;
  totalEffectiveUsdc: Usdc;
  committedLiabilities30dUsdc: Usdc;
  protectedReserveUsdc: Usdc;
  freeCapitalUsdc: Usdc;
  safeToInvestUsdc: Usdc;
  excludeFromWaterfall: boolean;
  isActive: boolean;
  authorizedCategories: string[];
}

export interface VendorBank {
  bankAccountId: string;
  accountHolderName: string;
  accountMasked: string;
  routingOrSwift: string;
  bankName: string;
  bankCountry: string;
  subMethod: FiatSubMethod;
  isVerified: boolean;
}

export interface Vendor {
  vendorId: string;
  name: string;
  verifiedPayoutAddress?: Hex;
  changeLock: boolean;
  verifiedByAdmin?: string;
  lastVerifiedAt?: string;
  taxId?: string;
  authorizedCategory: string;
  preferredRail: PaymentRail;
  paymentEndpointUrl?: string;
  banks: VendorBank[];
  openLiabilities: number;
  trailing30dUsdc: Usdc;
}

export interface Liability {
  liabilityId: string;
  accountId: string;
  vendorId: string;
  title: string;
  category: LiabilityCategory;
  amountUsdc: Usdc;
  dueDate: string;
  status: LiabilityStatus;
  payoutAddress: string;
  isOverdue?: boolean;
  rail?: PaymentRail;
}

export interface SprAccountImpact {
  accountId: string;
  role: string;
  currentLiquidBalance: Usdc;
  currentInvestedUsyc: Usdc;
  usycRecallAmount: Usdc;
  postTxLiquidBalance: Usdc;
  postTxInvestedUsyc: Usdc;
  unencumberedBalance: Usdc;
}

export interface PermissionRequest {
  requestId: string;
  timestamp: string;
  action: SprActionType;
  reason: string;
  amountUsdc: Usdc;
  status: SprStatus;
  affectedAccounts: SprAccountImpact[];
  targetRecipient?: {
    vendorId: string;
    vendorName: string;
    payoutAddress: string;
    isInVerifiedMaster: boolean;
    payeeAddressMatchesHistory: boolean;
  };
  associatedRecords: {
    purchaseOrderId?: string;
    goodsReceiptId?: string;
    invoiceDocumentId?: string;
    idempotencyKey: Hex;
  };
  adminInstructions?: string;
  decidedAt?: string;
}

export interface WaterfallAllocation {
  accountId: string;
  accountName: string;
  accountRole: string;
  allocatedAmountUsdc: Usdc;
  requiresRecall: boolean;
  recallAmountUsdc: Usdc;
  remainingFreeCapitalUsdc: Usdc;
}

export interface RouteQualification {
  routeType: RouteType;
  isQualified: boolean;
  totalRequestedUsdc: Usdc;
  totalAllocatedUsdc: Usdc;
  shortfallUsdc?: Usdc;
  allocations: WaterfallAllocation[];
  requiresHumanApproval: boolean;
  evaluationReason: string;
  idempotencyKey: Hex;
}

export interface JournalVoucher {
  sequenceId: number;
  timestamp: string;
  accountId: string;
  actionType: string;
  debitAccount: string;
  creditAccount: string;
  amountUsdc: Usdc;
  documentRef: string;
  txHash?: string;
  previousHash: string;
  currentHash: string;
  memo?: string;
}

export interface AuditEvent {
  logId?: string;
  accountId: string;
  actionType: string;
  amountUsdc: Usdc;
  isAutonomous: boolean;
  txHash?: string;
  reason: string;
  createdAt: string;
  actorAgent?: AgentPersona;
}

export interface AgentStatus {
  persona: AgentPersona;
  state: "IDLE" | "WORKING" | "BLOCKED" | "OFFLINE";
  actions24h: number;
  lastAction: string;
  lastActionAt: string;
}

export interface AgentEvent {
  id: string;
  sessionId: string;
  eventSeq: number;
  agentId: number;
  agentName: string;
  eventType: string;
  content: string;
  createdAt: string;
  txHash?: Hex;
  amountUsdc?: Usdc;
}

export interface CompactionEpisode {
  episodeIndex: number;
  startSeq: number;
  endSeq: number;
  createdAt: string;
  narrativeSummary: string;
  anchors: {
    liquidCashUsdc: Usdc;
    investedYieldUsdc: Usdc;
    availableBalanceUsdc: Usdc;
    targetReserveUsdc: Usdc;
    safeToInvestUsdc: Usdc;
    invariantCheckPassed: boolean;
    recentTxHashes: Hex[];
  };
}

export interface MemoryDocument {
  documentId: string;
  collection: string;
  title: string;
  chunks: number;
  ingestedAt: string;
  snippet: string;
}

export interface AppNotification {
  id: string;
  kind: string;
  tone: "neutral" | "auto" | "gate" | "danger" | "info" | "liquid" | "invested";
  title: string;
  body: string;
  createdAt: string;
  read: boolean;
  href?: string;
}

export interface ReadinessPillar {
  pillar: string;
  isReady: boolean;
  score: number;
  details: string;
}

export interface ReadinessReport {
  overallReady: boolean;
  overallScore: number;
  evaluatedAt: string;
  activeProfile: string;
  pillars: ReadinessPillar[];
  blockingIssues: string[];
  warnings: string[];
}

export interface MathQuestion {
  questionId: string;
  category: "GENERAL_MATH" | "ACCOUNT_MATH" | "LIABILITY_MATH" | "INVESTMENT_MATH";
  questionText: string;
  helpText?: string;
  responseType: "NUMBER" | "PERCENTAGE" | "SELECT" | "BOOLEAN";
  options?: { label: string; value: string | number | boolean }[];
  defaultValue?: string | number | boolean;
  formulaDescription: string;
}

export interface MathAnswerRecord {
  questionId: string;
  category: string;
  questionText: string;
  userAnswer: string;
  derivedParameterName: string;
  derivedValue: string;
  answeredAt: string;
}

export interface DerivedParameter {
  name: string;
  label: string;
  value: string;
  unit: string;
}

export interface WizardProfileDraft {
  companyName: string;
  taxId: string;
  jurisdiction: string;
  reportingCurrency: string;
  businessDescription: string;
  adminEmail: string;
}

export interface WizardAccountDraft {
  accountId: string;
  name: string;
  role: AccountRole;
  minOperatingFloorUsdc: Usdc;
  safetyBufferRatio: string;
  perTxCapUsdc: Usdc;
  dailyCapUsdc: Usdc;
  weeklyCapUsdc: Usdc;
  monthlyCapUsdc: Usdc;
  authorizedCategories: string[];
  maxAutonomousSweepUsdc: Usdc;
  excludeFromWaterfall: boolean;
  walletAddress: Hex | null;
  suggestedBy: "HUMAN" | "AGENT";
}

export interface WizardLiabilityDraft {
  title: string;
  accountId: string;
  vendorId: string;
  vendorName: string;
  category: LiabilityCategory;
  amountUsdc: Usdc;
  dueDate: string;
  frequencyCron: string;
  payoutAddress?: Hex;
  poReference?: string;
  serviceUrl?: string;
  preferredPaymentRail: PaymentRail;
  preferredSubMethod?: FiatSubMethod;
  fiatDetails?: {
    accountHolderName: string;
    ibanOrAccountNumber: string;
    routingOrSwift: string;
    bankName: string;
    bankCountry: string;
    paymentSubMethod: FiatSubMethod;
  };
  disbursalRules: {
    autoPayThresholdUsdc: Usdc;
    requireThreeWayMatch: boolean;
    preFlightLeadTimeHours: number;
  };
  suggestedBy: "HUMAN" | "AGENT";
  flags: {
    payeeVerified: boolean;
    stealthCreep?: string;
  };
}

export interface DeclaredPoliciesDraft {
  costCenterRules: string[];
  anomalyTolerances: {
    maxPriceHikePercentage: string;
    flagUnregisteredVendors: boolean;
    requireThreeWayMatch: boolean;
  };
  reviewTriggers: string[];
  investmentPolicies: {
    targetAllocationRatio: string;
    minSweepThresholdUsdc: Usdc;
    hysteresisBandUsdc: Usdc;
  };
}

export interface IntakeSynthesis {
  companyId: string;
  totalCommittedMonthlySpendUsdc: Usdc;
  connectedSources: string[];
  discoveredCostCenters: {
    tag: string;
    name: string;
    suggestedRole: string;
    dimensionSource: string;
    sourceSystem: string;
  }[];
  discoveredLiabilities: {
    invoiceId: string;
    vendorName: string;
    vendorId: string;
    amountUsdc: Usdc;
    dueDate: string;
    payoutAddress: string;
    poNumber?: string;
    costCenterTag: string;
    optimalRail: PaymentRail;
    payeeVerified: boolean;
    stealthCreepDetected: boolean;
    stealthCreepClause?: string;
  }[];
  stealthCreepAlerts: {
    vendorName: string;
    billedAmountUsdc: Usdc;
    baselineAmountUsdc: Usdc;
    clause: string;
  }[];
}

export interface ProvisionStep {
  id: string;
  label: string;
  detail?: string;
  status: "PENDING" | "RUNNING" | "DONE" | "FAILED";
  txHash?: Hex;
}

export interface WizardSession {
  sessionId: string;
  companyId: string;
  currentStep: number;
  totalSteps: number;
  entryPath: EntryPath;
  completedSteps: number[];
  status: "IN_PROGRESS" | "DRAFT_READY" | "COMPLETED" | "ABANDONED";
  draftPayload: Record<string, unknown>;
}

export interface FundingOptions {
  accountId: string;
  accountRole: AccountRole;
  accountWalletAddress: Hex;
  fiat: {
    card: { available: boolean; currencies: string[]; speed: string; maxUsdc: Usdc };
    fedwire: { available: boolean; beneficiary: string; bank: string; routing: string; account: string; memo: string; speed: string };
    ach: { available: boolean; routing: string; account: string; memo: string; speed: string };
    sepa: { available: boolean; iban: string; bic: string; memo: string; speed: string };
  };
  crypto: {
    arcNative: { available: boolean; chain: string; chainId: number; token: string; depositAddress: Hex; speed: string };
    bridge: { available: boolean; chains: string[]; targetAddress: Hex; speed: string };
    swap: { available: boolean; tokens: string[]; depositAddress: Hex; autoConvertTo: string };
  };
}

export interface DepositSession {
  sessionId: string;
  accountId: string;
  method: string;
  amountUsdc: Usdc;
  trackingMemo: string;
  checkoutUrl?: string;
  status: "PENDING" | "CONFIRMED" | "EXPIRED" | "FAILED";
  createdAt: string;
  confirmedAt?: string;
}

export interface FiatPayout {
  payoutId: string;
  accountId: string;
  vendorId: string;
  vendorName: string;
  amountUsdc: Usdc;
  feeUsdc: Usdc;
  status: "SETTLED" | "PROCESSING" | "ESCALATED" | "FAILED";
  subMethod: FiatSubMethod;
  circlePayoutRef: string;
  burnTxHash?: Hex;
  sprsRequestId?: string;
  invoiceRef: string;
  createdAt: string;
  settledAt?: string;
  estimatedArrival?: string;
  imadOmad?: string;
}

export interface SwapQuote {
  fromChain: string;
  fromToken: string;
  toChain: string;
  toToken: string;
  fromAmount: Usdc;
  estimatedToAmount: Usdc;
  minimumToAmount: Usdc;
  rate: string;
  slippageBps: number;
  feeUsdc: Usdc;
  aggregator: string;
  etaSeconds: number;
}

export interface SwapRecord {
  swapId: string;
  accountId: string;
  fromChain: string;
  fromToken: string;
  toChain: string;
  toToken: string;
  fromAmount: Usdc;
  toAmount: Usdc;
  realizedRate: string;
  slippageBps: number;
  txHash?: Hex;
  status: "COMPLETED" | "PENDING" | "REJECTED_BY_POLICY";
  aggregator: string;
  createdAt: string;
}

export interface SessionKey {
  sessionKeyId: string;
  accountId: string;
  allowedRecipient: Hex;
  recipientName: string;
  maxAmountPerCycleUsdc: Usdc;
  cycleDurationSeconds: number;
  currentCycleSpentUsdc: Usdc;
  validUntil: string;
  lastExecutedAt?: string;
  publicKey: Hex;
  isActive: boolean;
}

export interface Erc3009Authorization {
  nonce: Hex;
  from: Hex;
  to: Hex;
  amountUsdc: Usdc;
  validAfter: string;
  validBefore: string;
  intentId: string;
  txHash?: Hex;
  executedAt?: string;
}

export interface X402Schema {
  serviceUrl: string;
  priceUsdc: Usdc;
  unit: string;
  acceptedAsset: string;
  network: string;
  payTo: Hex;
  description: string;
}

export interface DisbursalVaultState {
  address: Hex;
  balanceAtRestUsdc: Usdc;
  perTxCapUsdc: Usdc;
  dailyCapUsdc: Usdc;
  approvedVendors: { vendor: Hex; name: string }[];
  executedKeys24h: number;
  lastExecutionAt: string;
}

export interface Integration {
  provider: string;
  kind: "WORKSPACE" | "ERP" | "BILLING";
  status: "CONNECTED" | "DISCONNECTED" | "ERROR" | "EXPIRED";
  connectedAt?: string;
  scope?: string;
  lastSyncAt?: string;
  error?: string;
  detail?: string;
}

export interface PollingJob {
  jobId: string;
  appType: string;
  cron: string;
  lastPolledAt: string;
  nextPollAt: string;
  status: "IDLE" | "RUNNING" | "FAILED";
  lastDiscoveredCount: number;
  lastError?: string;
}

export interface ErpSyncStatus {
  overall: "HEALTHY" | "DEGRADED" | "DOWN";
  lastSyncAt: string;
  threeWayMatchIntegrity: boolean;
  unreconciled: number;
  erpNext: { connected: boolean; synced: number };
  odoo: { connected: boolean; synced: number };
  checkpoints: {
    syncId: string;
    systemType: string;
    accountId: string;
    entityType: string;
    lastSyncAt: string;
    lastDocumentId: string;
    status: "SYNCED" | "FAILED";
    threeWayMatchVerified?: boolean;
    txHash?: Hex;
  }[];
}

export interface WebhookEndpoint {
  id: string;
  label: string;
  path: string;
  events: string[];
  lastDeliveryAt: string;
  lastStatus: number;
  signingSecretPrefix: string;
  active: boolean;
}

export interface InvestmentRules {
  maxAllocationRatio: string;
  minSweepUsdc: Usdc;
  autoSweep: boolean;
  autoRecall: boolean;
  investHysteresisUsdc: Usdc;
  recallHysteresisUsdc: Usdc;
  debounceMs: number;
  cooldownSeconds: number;
  redemptionLeadSeconds: number;
  redemptionTier: string;
}

export interface SpendingLimits {
  dailyHardCapUsdc: Usdc;
  singleTxHumanGateUsdc: Usdc;
}

export interface MovementPolicy {
  policyId: string;
  name: string;
  priorityOrder: string[];
  protectedAccounts: string[];
  crossAccountBorrowing: boolean;
  maxBorrowingRatio: string;
  humanApprovalThresholdUsdc: Usdc;
}

export interface PolicyProfileSummary {
  id: string;
  description: string;
  active: boolean;
  accounts: number;
  version: string;
}

export interface YieldPerformance {
  accountId: string;
  timeframe: string;
  accruedYieldUsdc: Usdc;
  lifetimeDepositedUsdc: Usdc;
  lifetimeWithdrawnUsdc: Usdc;
  currentAprPct: string;
  series: { date: string; investedUsdc: Usdc; accruedUsdc: Usdc }[];
}

export interface YieldMove {
  id: string;
  accountId: string;
  kind: "SWEEP" | "RECALL";
  amountUsdc: Usdc;
  reason: string;
  actor: string;
  autonomous: boolean;
  txHash?: Hex;
  at: string;
  suppressedBy?: "PAYROLL_SHIELD" | "HYSTERESIS" | "COOLDOWN";
}

export interface ShortfallAssessment {
  accountId: string;
  accountName: string;
  totalDueUsdc: Usdc;
  liquidUsdc: Usdc;
  investedUsdc: Usdc;
  shortfallUsdc: Usdc;
  requiresRecall: boolean;
  canCoverFromUsyc: boolean;
  liabilities: number;
  dueBy: string;
  status: "NOT_RUN" | "INSUFFICIENT_USYC" | "COVERED";
}

export interface PreflightAlert {
  liabilityId: string;
  title: string;
  vendorName: string;
  accountId: string;
  accountName: string;
  amountUsdc: Usdc;
  dueDate: string;
  hoursUntilDue: number;
  payee: { verified: boolean; matchesHistory: boolean };
  rail: PaymentRail;
  fundingState: "FUNDED" | "RECALL_NEEDED" | "SHORT";
  flags: string[];
}

export interface RecurringProposal {
  proposalId: string;
  action: "ADD" | "EDIT" | "REMOVE";
  liabilityId?: string;
  accountId: string;
  vendorId: string;
  vendorName: string;
  proposedBy: string;
  summary: string;
  before?: Record<string, string>;
  after?: Record<string, string>;
  status: "PENDING_HUMAN_APPROVAL" | "APPROVED" | "REJECTED";
  sprsRequestId?: string;
  createdAt: string;
}

export interface ThreeWayMatch {
  vendorId: string;
  poRef: string;
  poAmountUsdc: Usdc;
  receiptRef: string;
  deliveryVerified: boolean;
  invoiceRef: string;
  invoiceAmountUsdc: Usdc;
  payoutAddress: string;
  verdict: "MATCHED" | "PAYEE_MISMATCH" | "DISCREPANCY" | "UNMATCHED";
  notes: string[];
}

export interface VendorSpend {
  vendorId: string;
  vendorName: string;
  monthlySpendUsdc: Usdc;
  forecastedMonthlySpendUsdc: Usdc;
  billingCycleAnchorDay: number;
  source: string;
  optimalRail: PaymentRail;
}

export interface OperationalHealth {
  status: "HEALTHY" | "DEGRADED" | "DOWN";
  uptimeSeconds: number;
  checks: { name: string; ok: boolean; latencyMs?: number; detail?: string }[];
  circuitBreaker: { tripped: boolean; reason?: string; trippedAt?: string; trippedBy?: string };
}

export interface AuditSummary {
  totalVouchers: number;
  headSequence: number;
  headHash: string;
  chainIntact: boolean;
  autonomousActions: number;
  humanActions: number;
}

export interface OverviewState {
  asOf: string;
  profile: string;
  currency: string;
  totals: {
    liquidUsdc: Usdc;
    investedUsyc: Usdc;
    effectiveUsdc: Usdc;
    invariantOk: boolean;
    healthRatio: string;
    surplusUsdc: Usdc;
  };
  accounts: AccountDistribution[];
  liabilities: {
    upcoming30dUsdc: Usdc;
    overdueUsdc: Usdc;
    scheduled: number;
    byCategory: Record<string, Usdc>;
    next: Liability[];
  };
  safeToInvest: {
    totalUsdc: Usdc;
    protectedReserveUsdc: Usdc;
    freeCapitalUsdc: Usdc;
  };
  pendingSprs: PermissionRequest[];
  recentActivity: AuditEvent[];
  limits: {
    dailyHardCapUsdc: Usdc;
    dailySpentUsdc: Usdc;
    singleTxHumanGateUsdc: Usdc;
  };
  erp: ErpSyncStatus;
  audit: AuditSummary;
  health: OperationalHealth;
}
