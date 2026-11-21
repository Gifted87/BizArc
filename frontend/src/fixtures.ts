/**
 * One coherent fictional company ("Halcyon Robotics Inc.") used across the system so numbers agree everywhere.
 * Every amount is an exact Usdc string; every balance satisfies B_E = B_L + B_Y; the journal's hash chain links.
 */
import { fromMicro, sumUsdc, toMicro } from "./money";
import type * as T from "./types";

/* Deterministic fake hex (fixtures only) */
export function hex(seed: string, bytes = 32): T.Hex {
  let h = 2166136261 >>> 0;
  let out = "";
  for (let i = 0; out.length < bytes * 2; i++) {
    const c = seed.charCodeAt(i % seed.length) + i * 31;
    h = Math.imul(h ^ c, 16777619) >>> 0;
    h ^= h >>> 13;
    out += (h >>> 0).toString(16).padStart(8, "0");
  }
  return `0x${out.slice(0, bytes * 2)}` as T.Hex;
}

export const addr = (seed: string) => hex(seed, 20);
const ago = (min: number) => new Date(Date.UTC(2026, 9, 14, 3, 30) - min * 60_000).toISOString();
const inDays = (d: number) => new Date(Date.UTC(2026, 9, 14, 12, 0) + d * 86_400_000).toISOString();
export const NOW_ISO = ago(0);

/* ───────── Identity & Membership ───────── */
export const COMPANY: T.Company = {
  companyId: "org_halcyon",
  name: "Halcyon Robotics",
  legalName: "Halcyon Robotics Inc.",
  taxId: "84-2917365",
  jurisdiction: "US-DE",
  reportingCurrency: "USD",
  activationStatus: "ACTIVE",
  network: "arcTestnet",
};

export const MEMBERSHIPS: T.Membership[] = [
  { companyId: "org_halcyon", companyName: "Halcyon Robotics Inc.", role: "CFO", network: "arcTestnet", activationStatus: "ACTIVE" },
  { companyId: "org_halcyon_eu", companyName: "Halcyon Robotics GmbH", role: "VIEWER", network: "arcTestnet", activationStatus: "ACTIVE" },
  { companyId: "org_newco", companyName: "Newco Labs (setup unfinished)", role: "OWNER", network: "arcTestnet", activationStatus: "PENDING_ACTIVATION" },
];

export const ME: T.Member = {
  userId: "usr_01",
  name: "Amara Okafor",
  email: "amara@halcyon.example",
  role: "CFO",
  status: "ACTIVE",
  emailVerified: true,
  mfaEnabled: true,
  approverWallet: addr("approver-amara"),
  lastActiveAt: ago(2),
};

export const MEMBERS: T.Member[] = [
  ME,
  { userId: "usr_02", name: "Tomás Reyes", email: "tomas@halcyon.example", role: "ADMIN", status: "ACTIVE", emailVerified: true, mfaEnabled: true, lastActiveAt: ago(95) },
  { userId: "usr_03", name: "Priya Nair", email: "priya@halcyon.example", role: "APPROVER", status: "ACTIVE", emailVerified: true, mfaEnabled: false, approverWallet: addr("approver-priya"), lastActiveAt: ago(1440) },
  { userId: "usr_04", name: "Jonas Weber", email: "jonas@halcyon.example", role: "OPERATOR", status: "ACTIVE", emailVerified: true, mfaEnabled: true, lastActiveAt: ago(300) },
  { userId: "usr_05", name: "Lena Fischer", email: "lena@halcyon-audit.example", role: "VIEWER", status: "INVITED", emailVerified: false, mfaEnabled: false },
];

export const APPROVERS: T.ApproverWallet[] = [
  { address: addr("approver-amara"), label: "Amara · Ledger Nano", userName: "Amara Okafor", addedAt: ago(60 * 24 * 40), addedBy: "usr_01", status: "ACTIVE" },
  { address: addr("approver-priya"), label: "Priya · MetaMask", userName: "Priya Nair", addedAt: ago(60 * 24 * 12), addedBy: "usr_01", status: "ACTIVE" },
  { address: addr("approver-jonas"), label: "Jonas · pending approval", userName: "Jonas Weber", addedAt: ago(180), addedBy: "usr_02", status: "PENDING_SPRS" },
];

export const API_KEYS: T.ApiKeyRecord[] = [
  { keyId: "key_01", label: "ERP webhook (Odoo)", prefix: "bz_live_7Hq2", scopes: ["webhooks:ingest"], createdAt: ago(60 * 24 * 30), createdBy: "usr_01", lastUsedAt: ago(14), status: "ACTIVE" },
  { keyId: "key_02", label: "Read-only BI export", prefix: "bz_live_Qm94", scopes: ["treasury:read", "ledger:read"], createdAt: ago(60 * 24 * 9), createdBy: "usr_02", lastUsedAt: ago(60 * 20), status: "ACTIVE" },
  { keyId: "key_03", label: "Old staging key", prefix: "bz_test_a81x", scopes: ["treasury:read"], createdAt: ago(60 * 24 * 90), createdBy: "usr_02", status: "REVOKED" },
];

export const DEVICE_SESSIONS: T.DeviceSession[] = [
  { sessionId: "ses_1", device: "Chrome on macOS", location: "Lagos, NG", ip: "102.89.•.•", createdAt: ago(60 * 5), lastSeenAt: ago(1), current: true },
  { sessionId: "ses_2", device: "Safari on iPhone", location: "Lagos, NG", ip: "102.89.•.•", createdAt: ago(60 * 24 * 3), lastSeenAt: ago(60 * 9), current: false },
  { sessionId: "ses_3", device: "Firefox on Windows", location: "London, UK", ip: "81.2.•.•", createdAt: ago(60 * 24 * 11), lastSeenAt: ago(60 * 24 * 6), current: false },
];

/* ───────── Accounts & Balances ───────── */
interface AcctSeed {
  id: string;
  name: string;
  role: T.AccountRole;
  liquid: string;
  invested: string;
  committed: string;
  reserve: string;
  safe: string;
  shield?: boolean;
  cats: string[];
}

const SEEDS: AcctSeed[] = [
  { id: "acc_treasury", name: "General Treasury Reserve", role: "TREASURY_RESERVE", liquid: "182400.250000", invested: "410000.000000", committed: "21850.000000", reserve: "26220.000000", safe: "134330.250000", cats: ["GENERAL_OPERATIONS", "INTERCOMPANY_TRANSFER"] },
  { id: "acc_payroll", name: "Corporate Payroll Escrow", role: "PAYROLL", liquid: "96000.000000", invested: "0.000000", committed: "88400.000000", reserve: "110500.000000", safe: "0.000000", shield: true, cats: ["SALARIES", "CONTRACTOR_COMPENSATION"] },
  { id: "acc_engineering", name: "Engineering Operations", role: "OPEX_DEV", liquid: "18240.500000", invested: "42500.000000", committed: "14230.500000", reserve: "17076.600000", safe: "1163.900000", cats: ["INFRASTRUCTURE", "DEVELOPER_TOOLS", "SAAS"] },
  { id: "acc_growth", name: "Marketing & Growth", role: "OPEX_GROWTH", liquid: "6120.750000", invested: "12000.000000", committed: "3980.000000", reserve: "4776.000000", safe: "1344.750000", cats: ["MARKETING", "ADVERTISING", "SUBSCRIPTION"] },
  { id: "acc_legal", name: "Legal & Compliance", role: "OPEX_LEGAL", liquid: "4800.000000", invested: "0.000000", committed: "5200.000000", reserve: "6240.000000", safe: "0.000000", cats: ["LEGAL", "COMPLIANCE"] },
  { id: "acc_tax", name: "Tax Escrow", role: "TAX_ESCROW", liquid: "31250.000000", invested: "0.000000", committed: "0.000000", reserve: "31250.000000", safe: "0.000000", shield: true, cats: ["TAX"] },
];

export const ACCOUNTS: T.AccountDistribution[] = SEEDS.map(s => {
  const total = sumUsdc([s.liquid, s.invested]);
  const free = toMicro(s.liquid) > toMicro(s.reserve) ? fromMicro(toMicro(s.liquid) - toMicro(s.reserve)) : "0.000000";
  return {
    accountId: s.id,
    name: s.name,
    role: s.role,
    chain: "Arc Testnet (5042002)",
    address: addr(s.id),
    liquidUsdc: s.liquid,
    investedUsyc: s.invested,
    totalEffectiveUsdc: total,
    committedLiabilities30dUsdc: s.committed,
    protectedReserveUsdc: s.reserve,
    freeCapitalUsdc: free,
    safeToInvestUsdc: s.safe,
    excludeFromWaterfall: !!s.shield,
    isActive: true,
    authorizedCategories: s.cats,
  };
});

export const ACCOUNT_BY_ID = Object.fromEntries(ACCOUNTS.map(a => [a.accountId, a])) as Record<string, T.AccountDistribution>;
export const TOTAL_LIQUID = sumUsdc(ACCOUNTS.map(a => a.liquidUsdc));
export const TOTAL_INVESTED = sumUsdc(ACCOUNTS.map(a => a.investedUsyc));
export const TOTAL_EFFECTIVE = sumUsdc(ACCOUNTS.map(a => a.totalEffectiveUsdc));

export const ACCOUNT_POLICIES: Record<string, { floor: string; buffer: string; perTx: string; daily: string; weekly: string; monthly: string; sweepMax: string }> = {
  acc_treasury: { floor: "250.000000", buffer: "1.20", perTx: "5000.000000", daily: "25000.000000", weekly: "100000.000000", monthly: "250000.000000", sweepMax: "25000.000000" },
  acc_payroll: { floor: "100.000000", buffer: "1.25", perTx: "0.000000", daily: "0.000000", weekly: "0.000000", monthly: "110000.000000", sweepMax: "0.000000" },
  acc_engineering: { floor: "50.000000", buffer: "1.20", perTx: "2500.000000", daily: "15000.000000", weekly: "50000.000000", monthly: "200000.000000", sweepMax: "5000.000000" },
  acc_growth: { floor: "50.000000", buffer: "1.20", perTx: "1000.000000", daily: "5000.000000", weekly: "20000.000000", monthly: "60000.000000", sweepMax: "2000.000000" },
  acc_legal: { floor: "500.000000", buffer: "1.20", perTx: "7500.000000", daily: "10000.000000", weekly: "25000.000000", monthly: "50000.000000", sweepMax: "0.000000" },
  acc_tax: { floor: "31250.000000", buffer: "1.00", perTx: "0.000000", daily: "0.000000", weekly: "0.000000", monthly: "0.000000", sweepMax: "0.000000" },
};

/* ───────── Vendors ───────── */
const bank = (id: string, holder: string, acct: string, routing: string, bankName: string, sub: T.FiatSubMethod, country = "US"): T.VendorBank => ({
  bankAccountId: id,
  accountHolderName: holder,
  accountMasked: `•••• ${acct.slice(-4)}`,
  routingOrSwift: routing,
  bankName,
  bankCountry: country,
  subMethod: sub,
  isVerified: true,
});

export const VENDORS: T.Vendor[] = [
  { vendorId: "vendor_aws", name: "Amazon Web Services", verifiedPayoutAddress: addr("v-aws"), changeLock: true, verifiedByAdmin: "usr_01", lastVerifiedAt: ago(60 * 24 * 41), taxId: "91-1646860", authorizedCategory: "INFRASTRUCTURE", preferredRail: "DISBURSAL_VAULT", banks: [], openLiabilities: 1, trailing30dUsdc: "14210.500000" },
  { vendorId: "vendor_github", name: "GitHub Enterprise", verifiedPayoutAddress: addr("v-github"), changeLock: true, verifiedByAdmin: "usr_01", lastVerifiedAt: ago(60 * 24 * 41), authorizedCategory: "DEVELOPER_TOOLS", preferredRail: "MODULAR_SESSION_KEY", banks: [], openLiabilities: 1, trailing30dUsdc: "2400.000000" },
  { vendorId: "vendor_openai", name: "OpenAI API", verifiedPayoutAddress: addr("v-openai"), changeLock: true, verifiedByAdmin: "usr_02", lastVerifiedAt: ago(60 * 24 * 20), authorizedCategory: "INFRASTRUCTURE", preferredRail: "GATEWAY_X402", paymentEndpointUrl: "https://api.openai.example/v1/pay", banks: [], openLiabilities: 1, trailing30dUsdc: "3875.125000" },
  { vendorId: "vendor_figma", name: "Figma", verifiedPayoutAddress: addr("v-figma"), changeLock: true, verifiedByAdmin: "usr_02", lastVerifiedAt: ago(60 * 24 * 20), authorizedCategory: "SAAS", preferredRail: "ERC3009_AUTHORIZATION", banks: [], openLiabilities: 1, trailing30dUsdc: "540.000000" },
  { vendorId: "vendor_mofo", name: "Morrison & Foerster LLP", changeLock: true, verifiedByAdmin: "usr_01", lastVerifiedAt: ago(60 * 24 * 60), taxId: "94-1234567", authorizedCategory: "LEGAL", preferredRail: "FIAT_PAYOUT", banks: [bank("bk_1", "Morrison & Foerster LLP", "021000021987654321", "021000021", "JPMorgan Chase Bank, N.A.", "FEDWIRE")], openLiabilities: 1, trailing30dUsdc: "5200.000000" },
  { vendorId: "vendor_deel", name: "Deel Payroll", verifiedPayoutAddress: addr("v-deel"), changeLock: true, verifiedByAdmin: "usr_01", lastVerifiedAt: ago(60 * 24 * 90), authorizedCategory: "PAYROLL", preferredRail: "DISBURSAL_VAULT", banks: [], openLiabilities: 1, trailing30dUsdc: "88400.000000" },
  { vendorId: "vendor_datadog", name: "Datadog", verifiedPayoutAddress: addr("v-datadog"), changeLock: true, verifiedByAdmin: "usr_02", lastVerifiedAt: ago(60 * 24 * 33), authorizedCategory: "INFRASTRUCTURE", preferredRail: "DISBURSAL_VAULT", banks: [], openLiabilities: 1, trailing30dUsdc: "3980.000000" },
  { vendorId: "vendor_berlin_gmbh", name: "Büro Berlin Coworking GmbH", changeLock: true, verifiedByAdmin: "usr_02", lastVerifiedAt: ago(60 * 24 * 14), authorizedCategory: "GENERAL_OPERATIONS", preferredRail: "FIAT_PAYOUT", banks: [bank("bk_2", "Büro Berlin Coworking GmbH", "DE89370400440532013000", "COBADEFFXXX", "Commerzbank AG", "SEPA", "DE")], openLiabilities: 1, trailing30dUsdc: "2100.000000" },
];

export const VENDOR_BY_ID = Object.fromEntries(VENDORS.map(v => [v.vendorId, v])) as Record<string, T.Vendor>;

/* ───────── Liabilities (11 Bills) ───────── */
const L = (
  n: number,
  accountId: string,
  vendorId: string,
  title: string,
  category: string,
  amountUsdc: string,
  dueDays: number,
  status: T.LiabilityStatus,
  rail: T.PaymentRail
): T.Liability => ({
  liabilityId: `0b6f1c2e-5a7d-4c1e-9d3b-${String(n).padStart(12, "0")}`,
  accountId,
  vendorId,
  title,
  category,
  amountUsdc,
  dueDate: inDays(dueDays),
  status,
  payoutAddress: VENDOR_BY_ID[vendorId]?.verifiedPayoutAddress ?? "Bank account on file",
  isOverdue: dueDays < 0 && status !== "SETTLED",
  rail,
});

export const LIABILITIES: T.Liability[] = [
  L(1, "acc_engineering", "vendor_aws", "AWS Cloud Infrastructure", "INFRASTRUCTURE", "14210.500000", 3, "SCHEDULED", "DISBURSAL_VAULT"),
  L(2, "acc_engineering", "vendor_github", "GitHub Enterprise: annual renewal", "DEVELOPER_TOOLS", "2400.000000", 9, "AWAITING_APPROVAL", "MODULAR_SESSION_KEY"),
  L(3, "acc_engineering", "vendor_openai", "OpenAI API Tier 5", "INFRASTRUCTURE", "3875.125000", 5, "SCHEDULED", "GATEWAY_X402"),
  L(4, "acc_engineering", "vendor_figma", "Figma Organization", "SAAS", "540.000000", 12, "SCHEDULED", "ERC3009_AUTHORIZATION"),
  L(5, "acc_legal", "vendor_mofo", "Expedited legal retainer (Q4)", "CONTRACTOR", "5200.000000", 2, "AWAITING_APPROVAL", "FIAT_PAYOUT"),
  L(6, "acc_payroll", "vendor_deel", "October payroll run", "PAYROLL", "88400.000000", 1, "SCHEDULED", "DISBURSAL_VAULT"),
  L(7, "acc_growth", "vendor_datadog", "Datadog Pro: usage true-up", "SUBSCRIPTION", "3980.000000", -2, "FROZEN", "DISBURSAL_VAULT"),
  L(8, "acc_treasury", "vendor_berlin_gmbh", "Berlin coworking (Nov)", "GENERAL_OPERATIONS", "2100.000000", 17, "SCHEDULED", "FIAT_PAYOUT"),
  L(9, "acc_engineering", "vendor_aws", "AWS Cloud Infrastructure (Sep)", "INFRASTRUCTURE", "13980.250000", -24, "SETTLED", "DISBURSAL_VAULT"),
  L(10, "acc_growth", "vendor_figma", "Figma: extra seats (cancelled)", "SAAS", "180.000000", -8, "CANCELLED", "ERC3009_AUTHORIZATION"),
  L(11, "acc_engineering", "vendor_github", "GitHub Copilot seats (Sep)", "DEVELOPER_TOOLS", "760.000000", -14, "DISBURSED", "MODULAR_SESSION_KEY"),
];

export const SUBMETHOD_BY_LIAB: Record<string, T.FiatSubMethod> = {
  [LIABILITIES[4].liabilityId]: "FEDWIRE",
  [LIABILITIES[7].liabilityId]: "SEPA",
};

/* ───────── SPRS (Human-In-The-Loop Approval Gates) ───────── */
const impact = (id: string, cash: string, recall: string): T.SprAccountImpact => {
  const a = ACCOUNT_BY_ID[id];
  const post = fromMicro(toMicro(cash) + toMicro(recall));
  return {
    accountId: id,
    role: a.role,
    currentLiquidBalance: cash,
    currentInvestedUsyc: a.investedUsyc,
    usycRecallAmount: recall,
    postTxLiquidBalance: post,
    postTxInvestedUsyc: fromMicro(toMicro(a.investedUsyc) - toMicro(recall)),
    unencumberedBalance: a.freeCapitalUsdc,
  };
};

export const SPR_PENDING_PAYEE: T.PermissionRequest = {
  requestId: "SPRS-20261014-0007",
  timestamp: ago(42),
  action: "DISBURSEMENT_PAYMENT",
  reason: "Datadog usage true-up invoice INV-88213 claims a payout address that differs from the verified one on file. Payment frozen; the Radar agent needs a human to confirm with the vendor.",
  amountUsdc: "3980.000000",
  status: "PENDING",
  affectedAccounts: [impact("acc_growth", "6120.750000", "0.000000")],
  targetRecipient: {
    vendorId: "vendor_datadog",
    vendorName: "Datadog",
    payoutAddress: addr("attacker-datadog"),
    isInVerifiedMaster: true,
    payeeAddressMatchesHistory: false,
  },
  associatedRecords: {
    purchaseOrderId: "PO-DD-2026-Q4",
    invoiceDocumentId: "INV-88213",
    idempotencyKey: hex("idem-dd-88213"),
  },
};

export const SPR_PENDING_LEGAL: T.PermissionRequest = {
  requestId: "SPRS-20261014-0006",
  timestamp: ago(130),
  action: "DISBURSEMENT_PAYMENT",
  reason: "Legal retainer exceeds the Legal account's single-transaction cap ($5,000.00). Paying by Fedwire to a verified bank account.",
  amountUsdc: "5200.000000",
  status: "PENDING",
  affectedAccounts: [
    impact("acc_legal", "4800.000000", "0.000000"),
    impact("acc_treasury", "182400.250000", "0.000000"),
  ],
  targetRecipient: {
    vendorId: "vendor_mofo",
    vendorName: "Morrison & Foerster LLP",
    payoutAddress: "Fedwire · JPMorgan Chase •••• 4321",
    isInVerifiedMaster: true,
    payeeAddressMatchesHistory: true,
  },
  associatedRecords: {
    purchaseOrderId: "PO-MOFO-Q4",
    goodsReceiptId: "GR-MOFO-0091",
    invoiceDocumentId: "INV-MOFO-2210",
    idempotencyKey: hex("idem-mofo-2210"),
  },
};

export const SPR_PENDING_SWEEP: T.PermissionRequest = {
  requestId: "SPRS-20261014-0005",
  timestamp: ago(300),
  action: "HIGH_VALUE_SWEEP_EXEMPTION",
  reason: "Treasury Reserve has $134,330.25 of safe-to-invest surplus. Sweeping all of it exceeds the autonomous sweep cap ($25,000.00).",
  amountUsdc: "134330.250000",
  status: "PENDING",
  affectedAccounts: [impact("acc_treasury", "182400.250000", "0.000000")],
  associatedRecords: { idempotencyKey: hex("idem-sweep-1") },
};

export const SPR_PENDING_REBALANCE: T.PermissionRequest = {
  requestId: "SPRS-20261013-0004",
  timestamp: ago(60 * 22),
  action: "CROSS_ACCOUNT_REBALANCE",
  reason: "AWS (Engineering) is $0 short after the predictive refunder ran. Recall from USYC covers $12,000.00; the remaining $1,100.00 must come from Treasury Reserve.",
  amountUsdc: "1100.000000",
  status: "PENDING",
  affectedAccounts: [
    impact("acc_engineering", "18240.500000", "12000.000000"),
    impact("acc_treasury", "182400.250000", "0.000000"),
  ],
  associatedRecords: { idempotencyKey: hex("idem-rebal-4") },
};

export const SPR_DECIDED: T.PermissionRequest[] = [
  {
    requestId: "SPRS-20261012-0003",
    timestamp: ago(60 * 52),
    action: "UNREGISTERED_VENDOR_ADDITION",
    reason: "Add Büro Berlin Coworking GmbH to the verified vendor list (SEPA).",
    amountUsdc: "0.000000",
    status: "EXECUTED",
    affectedAccounts: [],
    decidedAt: ago(60 * 51),
    associatedRecords: { idempotencyKey: hex("idem-v-3") },
    targetRecipient: {
      vendorId: "vendor_berlin_gmbh",
      vendorName: "Büro Berlin Coworking GmbH",
      payoutAddress: "SEPA · Commerzbank •••• 3000",
      isInVerifiedMaster: false,
      payeeAddressMatchesHistory: true,
    },
  },
  {
    requestId: "SPRS-20261009-0002",
    timestamp: ago(60 * 24 * 5),
    action: "MULTI_HOP_SUBSCRIPTION_SETTLEMENT",
    reason: "OpenAI invoice is 31% above its 6-month average.",
    amountUsdc: "5120.000000",
    status: "CANCELLED_WITH_INSTRUCTIONS",
    affectedAccounts: [],
    decidedAt: ago(60 * 24 * 5 - 20),
    adminInstructions: "Ask OpenAI to confirm the new tier. Do not pay until the contract amendment is attached.",
    associatedRecords: { idempotencyKey: hex("idem-o-2") },
  },
  {
    requestId: "SPRS-20261007-0001",
    timestamp: ago(60 * 24 * 7),
    action: "DISBURSEMENT_PAYMENT",
    reason: "GitHub Enterprise renewal over per-tx cap.",
    amountUsdc: "2400.000000",
    status: "REJECTED",
    affectedAccounts: [],
    decidedAt: ago(60 * 24 * 7 - 12),
    associatedRecords: { idempotencyKey: hex("idem-g-1") },
  },
];

export const SPR_PENDING_ALL = [
  SPR_PENDING_PAYEE,
  SPR_PENDING_LEGAL,
  SPR_PENDING_SWEEP,
  SPR_PENDING_REBALANCE,
];

/* ───────── Route Qualification (Waterfall) ───────── */
export const ROUTE_WATERFALL: T.RouteQualification = {
  routeType: "MULTI_ACCOUNT_WATERFALL",
  isQualified: true,
  totalRequestedUsdc: "14210.500000",
  totalAllocatedUsdc: "14210.500000",
  requiresHumanApproval: true,
  evaluationReason: "Engineering's free capital ($1,163.90) cannot cover this bill alone. Treasury Reserve and Growth are eligible; Payroll and Tax Escrow are shielded.",
  idempotencyKey: hex("idem-route-aws"),
  allocations: [
    { accountId: "acc_engineering", accountName: "Engineering Operations", accountRole: "OPEX_DEV", allocatedAmountUsdc: "1163.900000", requiresRecall: false, recallAmountUsdc: "0.000000", remainingFreeCapitalUsdc: "0.000000" },
    { accountId: "acc_treasury", accountName: "General Treasury Reserve", accountRole: "TREASURY_RESERVE", allocatedAmountUsdc: "13046.600000", requiresRecall: true, recallAmountUsdc: "0.000000", remainingFreeCapitalUsdc: "121283.650000" },
  ],
};

export const ROUTE_REJECTED: T.RouteQualification = {
  routeType: "REJECTED_INSUFFICIENT_FUNDS",
  isQualified: false,
  totalRequestedUsdc: "400000.000000",
  totalAllocatedUsdc: "0.000000",
  shortfallUsdc: "127419.750000",
  allocations: [],
  requiresHumanApproval: false,
  evaluationReason: "Requested amount exceeds the free capital of all eligible accounts combined.",
  idempotencyKey: hex("idem-route-big"),
};

/* ───────── Cryptographic Master Journal ───────── */
const GENESIS = ("0x" + "0".repeat(64)) as T.Hex;
const voucherSeeds: [string, string, string, string, string, string][] = [
  ["GENESIS", "acc_treasury", "Ledger genesis", "—", "0.000000", "ONBOARDING-GENESIS"],
  ["DEPOSIT", "acc_treasury", "Bank: Circle Mint", "acc_treasury:liquid", "250000.000000", "FEDWIRE-BIZARC-MINT-001"],
  ["SWEEP_TO_YIELD", "acc_treasury", "acc_treasury:liquid", "acc_treasury:invested", "410000.000000", "SWEEP-0001"],
  ["DEPOSIT", "acc_payroll", "Bank: Circle Mint", "acc_payroll:liquid", "96000.000000", "ACH-BIZARC-MINT-014"],
  ["DISBURSEMENT", "acc_engineering", "acc_engineering:liquid", "vendor_aws", "13980.250000", "INV-AWS-SEP"],
  ["RECALL_FROM_YIELD", "acc_engineering", "acc_engineering:invested", "acc_engineering:liquid", "12000.000000", "RECALL-0004"],
  ["FIAT_PAYOUT", "acc_legal", "acc_legal:liquid", "vendor_mofo", "4200.000000", "INV-MOFO-1987"],
  ["DISBURSEMENT", "acc_engineering", "acc_engineering:liquid", "vendor_github", "760.000000", "INV-GH-SEP"],
];

export const JOURNAL: T.JournalVoucher[] = (() => {
  const out: T.JournalVoucher[] = [];
  let prev = GENESIS;
  voucherSeeds.forEach(([type, acct, debit, credit, amt, ref], i) => {
    const cur = hex(`journal-${i}-${prev}-${ref}`);
    out.push({
      sequenceId: i + 1,
      timestamp: ago(60 * 24 * (20 - i * 2)),
      accountId: acct,
      actionType: type,
      debitAccount: debit,
      creditAccount: credit,
      amountUsdc: amt,
      documentRef: ref,
      txHash: i === 0 ? undefined : hex(`tx-${i}`),
      previousHash: prev,
      currentHash: cur,
    });
    prev = cur;
  });
  return out;
})();

export const JOURNAL_BROKEN: T.JournalVoucher[] = JOURNAL.map((v, i) =>
  i === 5 ? { ...v, previousHash: hex("tampered_hash_break") } : v
);

/* ───────── Audit & Autonomous Agents ───────── */
export const AUDIT: T.AuditEvent[] = [
  { logId: "9021", accountId: "acc_treasury", actionType: "SWEEP_TO_YIELD", amountUsdc: "25000.000000", isAutonomous: true, txHash: hex("tx-a1"), reason: "Safe-to-invest surplus above hysteresis band; swept within autonomous cap.", createdAt: ago(18), actorAgent: "TreasurySentinelAgent" },
  { logId: "9020", accountId: "acc_engineering", actionType: "RECALL_FROM_YIELD", amountUsdc: "12000.000000", isAutonomous: true, txHash: hex("tx-a2"), reason: "Pre-funding AWS invoice due in 72h (48h lead time + weekend buffer).", createdAt: ago(95), actorAgent: "TreasurySentinelAgent" },
  { logId: "9019", accountId: "acc_growth", actionType: "PAYEE_SUBSTITUTION_FREEZE", amountUsdc: "3980.000000", isAutonomous: true, reason: "Invoice INV-88213 payout address differs from the verified Datadog address. Liability frozen, SPRS-0007 opened.", createdAt: ago(42), actorAgent: "LiabilityRadarAgent" },
  { logId: "9018", accountId: "acc_legal", actionType: "ESCALATE_TO_SPRS", amountUsdc: "5200.000000", isAutonomous: false, reason: "Exceeds single-tx cap of $5,000.00.", createdAt: ago(130), actorAgent: "PolicyComplianceAgent" },
  { logId: "9017", accountId: "acc_legal", actionType: "FIAT_PAYOUT", amountUsdc: "4200.000000", isAutonomous: false, txHash: hex("tx-a3"), reason: "Fedwire retainer. Approved by Amara Okafor (EIP-712).", createdAt: ago(60 * 24 * 6), actorAgent: "DisbursalRouterAgent" },
  { logId: "9016", accountId: "acc_engineering", actionType: "DISBURSEMENT", amountUsdc: "760.000000", isAutonomous: true, txHash: hex("tx-a4"), reason: "Scheduled GitHub Copilot seats; below auto-pay ceiling; verified payee.", createdAt: ago(60 * 24 * 14), actorAgent: "DisbursalRouterAgent" },
];

export const AGENT_STATUS: T.AgentStatus[] = [
  { persona: "OnboardingAgent", state: "IDLE", actions24h: 0, lastAction: "Provisioned 6 accounts and wrote ledger genesis", lastActionAt: ago(60 * 24 * 40) },
  { persona: "TreasurySentinelAgent", state: "WORKING", actions24h: 9, lastAction: "Swept $25,000.00 from Treasury Reserve into USYC", lastActionAt: ago(18) },
  { persona: "LiabilityRadarAgent", state: "BLOCKED", actions24h: 4, lastAction: "Froze Datadog invoice: payee address mismatch", lastActionAt: ago(42) },
  { persona: "DisbursalRouterAgent", state: "IDLE", actions24h: 2, lastAction: "Planned waterfall for AWS across 2 accounts", lastActionAt: ago(210) },
  { persona: "PolicyComplianceAgent", state: "WORKING", actions24h: 14, lastAction: "Issued clearance #CLEAR-1760412-9f3a for sweep", lastActionAt: ago(18) },
  { persona: "LedgerWitnessAgent", state: "IDLE", actions24h: 11, lastAction: "Witnessed and journaled sequence 8", lastActionAt: ago(17) },
];

export const AGENT_EVENTS: T.AgentEvent[] = [
  { id: "e9", sessionId: "swarm_20261014", eventSeq: 4821, agentId: 105, agentName: "LedgerWitnessAgent", eventType: "STATE_MUTATION", content: "Journal voucher #8 appended; chain head advanced.", createdAt: ago(17), txHash: hex("tx-a1") },
  { id: "e8", sessionId: "swarm_20261014", eventSeq: 4820, agentId: 101, agentName: "TreasurySentinelAgent", eventType: "TOOL_RESULT", content: "sweep_excess_liquidity → EXECUTED", createdAt: ago(18), txHash: hex("tx-a1"), amountUsdc: "25000.000000" },
  { id: "e7", sessionId: "swarm_20261014", eventSeq: 4819, agentId: 104, agentName: "PolicyComplianceAgent", eventType: "INVARIANT_CHECK", content: "Tier A passed (floor, payroll wall, 6-dec). Tier B passed. Clearance issued.", createdAt: ago(18) },
  { id: "e6", sessionId: "swarm_20261014", eventSeq: 4818, agentId: 101, agentName: "TreasurySentinelAgent", eventType: "TOOL_CALLED", content: "sweep_excess_liquidity(accountId=acc_treasury, amountUsdc=25000.000000)", createdAt: ago(18) },
  { id: "e5", sessionId: "swarm_20261014", eventSeq: 4817, agentId: 101, agentName: "TreasurySentinelAgent", eventType: "LLM_DELIBERATION", content: "Safe-to-invest is $134,330.25 but the autonomous cap is $25,000.00. Sweeping the cap now and opening an SPRS for the remainder.", createdAt: ago(19) },
  { id: "e4", sessionId: "swarm_20261014", eventSeq: 4816, agentId: 102, agentName: "LiabilityRadarAgent", eventType: "SYSTEM_INTERRUPT", content: "PAYEE_SUBSTITUTION_ALERT: claimed address does not match vendor master. Liability FROZEN.", createdAt: ago(42) },
  { id: "e3", sessionId: "swarm_20261014", eventSeq: 4815, agentId: 102, agentName: "LiabilityRadarAgent", eventType: "TASK_INITIATED", content: "Ingest invoice INV-88213 (Datadog, $3,980.00).", createdAt: ago(43) },
];

export const EPISODES: T.CompactionEpisode[] = [
  {
    episodeIndex: 12,
    startSeq: 4790,
    endSeq: 4821,
    createdAt: ago(16),
    narrativeSummary: "Sentinel swept $25,000.00 of Treasury surplus into USYC under clearance. Radar froze the Datadog invoice for a payee mismatch and opened SPRS-0007. Router planned a two-account waterfall for AWS pending approval.",
    anchors: {
      liquidCashUsdc: TOTAL_LIQUID,
      investedYieldUsdc: TOTAL_INVESTED,
      availableBalanceUsdc: TOTAL_EFFECTIVE,
      targetReserveUsdc: "196062.600000",
      safeToInvestUsdc: "136838.900000",
      invariantCheckPassed: true,
      recentTxHashes: [hex("tx-a1"), hex("tx-a2")],
    },
  },
  {
    episodeIndex: 11,
    startSeq: 4760,
    endSeq: 4789,
    createdAt: ago(60 * 20),
    narrativeSummary: "Recalled $12,000.00 from USYC to Engineering ahead of the AWS due date. No policy escalations.",
    anchors: {
      liquidCashUsdc: "319111.500000",
      investedYieldUsdc: "440500.000000",
      availableBalanceUsdc: "759611.500000",
      targetReserveUsdc: "194500.000000",
      safeToInvestUsdc: "120114.000000",
      invariantCheckPassed: true,
      recentTxHashes: [hex("tx-a2")],
    },
  },
];

/* ───────── Notifications ───────── */
export const NOTIFICATIONS: T.AppNotification[] = [
  { id: "n1", kind: "PAYEE_MISMATCH", tone: "danger", title: "Datadog invoice frozen", body: "The payout address on invoice INV-88213 doesn't match the verified one. Review SPRS-0007.", createdAt: ago(42), read: false, href: "/approvals" },
  { id: "n2", kind: "SPRS_PENDING", tone: "gate", title: "3 requests need your signature", body: "Legal retainer, large sweep, and a cross-account rebalance are waiting.", createdAt: ago(130), read: false, href: "/approvals" },
  { id: "n3", kind: "PREFLIGHT_ALERT", tone: "gate", title: "AWS pays in 72 hours", body: "$14,210.50 from Engineering. Needs a $12,000.00 recall from yield; already staged.", createdAt: ago(200), read: false, href: "/bills" },
  { id: "n4", kind: "SWEEP", tone: "auto", title: "Sentinel swept $25,000.00 to yield", body: "Treasury Reserve · tx 0x3fa1…c902", createdAt: ago(18), read: true, href: "/ledger" },
  { id: "n5", kind: "DEPOSIT_CONFIRMED", tone: "auto", title: "Wire received: $50,000.00", body: "Credited to Payroll Escrow, reference BIZARC-MINT-ACC_PAYROLL-9F31A2.", createdAt: ago(60 * 26), read: true },
  { id: "n6", kind: "INTEGRATION_ERROR", tone: "danger", title: "Odoo sync failed", body: "Session expired. Reconnect to resume purchase-invoice sync.", createdAt: ago(60 * 30), read: true, href: "/integrations" },
];

/* ───────── Onboarding Data & Questionnaire ───────── */
export const MATH_QUESTIONS: T.MathQuestion[] = [
  { questionId: "GM_RUNWAY_MONTHS", category: "GENERAL_MATH", questionText: "How many months of liquid cash runway must your treasury maintain at all times?", helpText: "Determines the base operational reserve floor. Minimum 1 month, maximum 24 months.", responseType: "NUMBER", defaultValue: 3, formulaDescription: "M_runway: Target cash runway horizon in months" },
  { questionId: "GM_MONTHLY_BURN", category: "GENERAL_MATH", questionText: "What is your estimated 30-day net operating cash burn in USDC?", helpText: "Sum of monthly payroll, SaaS subscriptions, cloud infra, and rent obligations.", responseType: "NUMBER", defaultValue: 25000, formulaDescription: "MonthlyBurn_30d: Incurred monthly cash burn rate" },
  { questionId: "GM_REVENUE_VOLATILITY", category: "GENERAL_MATH", questionText: "What is your organization's revenue volatility risk level?", helpText: "Adjusts the liquidity buffer based on cash-inflow predictability.", responseType: "SELECT", options: [{ label: "Low volatility (predictable subscriptions, 10% buffer)", value: "LOW" }, { label: "Medium volatility (blended contracts and usage, 20% buffer)", value: "MEDIUM" }, { label: "High volatility (transactional or early stage, 35% buffer)", value: "HIGH" }], defaultValue: "MEDIUM", formulaDescription: "sigma_rev: Reserve expansion multiplier for revenue volatility" },
  { questionId: "GM_BUFFER_MULTIPLIER", category: "GENERAL_MATH", questionText: "What cash safety buffer multiplier should be applied to account operating floors?", helpText: "Safety ratio held in operating accounts to absorb unplanned expenses.", responseType: "SELECT", options: [{ label: "Conservative (1.50x)", value: "CONSERVATIVE" }, { label: "Balanced (1.25x)", value: "BALANCED" }, { label: "Lean (1.15x)", value: "LEAN" }], defaultValue: "BALANCED", formulaDescription: "B_buffer: Account liquidity floor safety multiplier" },
  { questionId: "AM_OPERATING_FLOOR_USDC", category: "ACCOUNT_MATH", questionText: "What is the minimum operating cash floor for this account (USDC)?", helpText: "Funds below this threshold will trigger liquidity alerts and prevent outward sweeps.", responseType: "NUMBER", defaultValue: 500, formulaDescription: "Floor_acc: Minimum required balance for operational solvency" },
  { questionId: "AM_DAILY_SPEND_CEILING", category: "ACCOUNT_MATH", questionText: "What is the maximum daily cumulative disbursal ceiling for this account (USDC)?", helpText: "Daily hard cap for autonomous agent actions before requiring human re-authorization.", responseType: "NUMBER", defaultValue: 5000, formulaDescription: "Cap_daily: Cumulative daily spending ceiling" },
  { questionId: "AM_SINGLE_TX_CAP", category: "ACCOUNT_MATH", questionText: "What is the single-transaction approval ceiling for this account before requiring CFO authorization?", helpText: "Transactions exceeding this limit trigger an EIP-712 human signoff gate.", responseType: "NUMBER", defaultValue: 1000, formulaDescription: "Gate_tx: Maximum single transaction amount allowed autonomously" },
  { questionId: "AM_AUTONOMOUS_SWEEP_MAX", category: "ACCOUNT_MATH", questionText: "What is the maximum autonomous single-sweep amount to yield vaults for this account (USDC)?", helpText: "Maximum single batch size swept to USYC.", responseType: "NUMBER", defaultValue: 2500, formulaDescription: "Sweep_max: Single-batch yield sweep limit" },
  { questionId: "LM_HISTORICAL_INVOICE_AVG", category: "LIABILITY_MATH", questionText: "What is the expected or historical average monthly invoice amount for this vendor (USDC)?", helpText: "Used as baseline benchmark for automated settlement and anomaly detection.", responseType: "NUMBER", defaultValue: 1000, formulaDescription: "mu_inv: Baseline expected invoice magnitude" },
  { questionId: "LM_STEALTH_CREEP_TOLERANCE_PCT", category: "LIABILITY_MATH", questionText: "What is the maximum percentage price variance tolerated before triggering a Stealth Price Creep freeze?", helpText: "If month-over-month unit cost rises by more than this percentage, the agent escalates to the CFO.", responseType: "SELECT", options: [{ label: "Strict (3% maximum variance)", value: "STRICT_3_PCT" }, { label: "Standard (5% maximum variance)", value: "STANDARD_5_PCT" }, { label: "Permissive (10% maximum variance)", value: "PERMISSIVE_10_PCT" }], defaultValue: "STANDARD_5_PCT", formulaDescription: "tau_creep: Maximum allowed price hike percentage without contract amendment" },
  { questionId: "LM_AUTOPAY_BUFFER_RATIO", category: "LIABILITY_MATH", questionText: "What auto-pay ceiling multiplier above the historical average is authorized for automated settlement?", helpText: "Multiplier applied to expected invoice for vault and session-key execution limits.", responseType: "SELECT", options: [{ label: "Exact match only (1.00x)", value: "EXACT_1_00" }, { label: "Low variance buffer (1.10x)", value: "LOW_1_10" }, { label: "Medium variance buffer (1.25x)", value: "MEDIUM_1_25" }], defaultValue: "LOW_1_10", formulaDescription: "K_buffer: Permitted headroom multiplier for auto-disbursals" },
  { questionId: "LM_PREFLIGHT_LEAD_HOURS", category: "LIABILITY_MATH", questionText: "How many hours before the invoice due date should the agent begin liquidity pre-flighting?", helpText: "Pre-verifies cash balance and un-stakes USYC if needed to ensure on-time settlement.", responseType: "NUMBER", defaultValue: 48, formulaDescription: "T_lead: Pre-flight runway evaluation window in hours" },
  { questionId: "IM_USYC_SWEEP_RATIO", category: "INVESTMENT_MATH", questionText: "What percentage of surplus liquid cash above operational floors should be swept into USYC yield vaults?", helpText: "Allocates surplus treasury capital to yield-bearing tokenized US Treasuries.", responseType: "PERCENTAGE", defaultValue: 80, formulaDescription: "R_usyc: Fraction of surplus liquid cash swept into yield assets" },
  { questionId: "IM_MIN_SWEEP_BATCH_USDC", category: "INVESTMENT_MATH", questionText: "What is the minimum sweep batch size to avoid micro-transaction friction (USDC)?", helpText: "Prevents dusting transactions and ensures capital efficiency.", responseType: "NUMBER", defaultValue: 50, formulaDescription: "Min_sweep: Smallest allowed autonomous sweep batch" },
  { questionId: "IM_EMERGENCY_RECALL_BUFFER_PCT", category: "INVESTMENT_MATH", questionText: "What percentage liquidity buffer should trigger an automated emergency recall from yield vaults?", helpText: "If operational liquid cash drops below (Floor × this buffer), instant USYC recall is triggered.", responseType: "PERCENTAGE", defaultValue: 15, formulaDescription: "B_recall: Critical threshold percentage triggering automated USYC liquidation" },
];

export const DERIVED_PARAMS: T.DerivedParameter[] = [
  { name: "minRunwayMonths", label: "Cash runway", value: "6", unit: "months" },
  { name: "monthlyOperatingBurnUsdc", label: "30-day burn", value: "88400.000000", unit: "USDC" },
  { name: "revenueVolatilityBuffer", label: "Volatility buffer", value: "20", unit: "%" },
  { name: "cashSafetyBufferMultiplier", label: "Floor multiplier", value: "1.25", unit: "x" },
  { name: "usycYieldSweepRatio", label: "Surplus swept to yield", value: "80", unit: "%" },
  { name: "minSweepBatchUsdc", label: "Smallest sweep", value: "50.000000", unit: "USDC" },
];

export const WIZARD_PROFILE: T.WizardProfileDraft = {
  companyName: "Halcyon Robotics Inc.",
  taxId: "84-2917365",
  jurisdiction: "US-DE",
  reportingCurrency: "USD",
  businessDescription: "We build warehouse-picking robots. Revenue is annual enterprise contracts billed quarterly; spend is mostly cloud, payroll and contract manufacturing.",
  adminEmail: "amara@halcyon.example",
};

export const WIZARD_ACCOUNTS: T.WizardAccountDraft[] = ACCOUNTS.slice(0, 4).map(a => {
  const p = ACCOUNT_POLICIES[a.accountId];
  return {
    accountId: a.accountId,
    name: a.name,
    role: a.role,
    minOperatingFloorUsdc: p.floor,
    safetyBufferRatio: p.buffer,
    perTxCapUsdc: p.perTx,
    dailyCapUsdc: p.daily,
    weeklyCapUsdc: p.weekly,
    monthlyCapUsdc: p.monthly,
    authorizedCategories: a.authorizedCategories,
    maxAutonomousSweepUsdc: p.sweepMax,
    excludeFromWaterfall: a.excludeFromWaterfall,
    walletAddress: null,
    suggestedBy: "HUMAN",
  };
});

export const WIZARD_POLICIES: T.DeclaredPoliciesDraft = {
  costCenterRules: [
    "Never pay cloud infrastructure or tooling invoices from marketing or payroll accounts.",
    "Corporate payroll is reserved exclusively for salary disbursements and contractor payouts.",
  ],
  anomalyTolerances: {
    maxPriceHikePercentage: "15.0",
    flagUnregisteredVendors: true,
    requireThreeWayMatch: true,
  },
  reviewTriggers: [
    "Any invoice above $10,000 requires two approvers.",
    "New vendors need a verified bank letter.",
  ],
  investmentPolicies: {
    targetAllocationRatio: "0.80",
    minSweepThresholdUsdc: "50.000000",
    hysteresisBandUsdc: "25.000000",
  },
};

/* ───────── Operational Health & Readiness ───────── */
export const HEALTH_OK: T.OperationalHealth = {
  status: "HEALTHY",
  uptimeSeconds: 864_211,
  checks: [
    { name: "Postgres", ok: true, latencyMs: 12 },
    { name: "Arc RPC (5042002)", ok: true, latencyMs: 184 },
    { name: "Circle Mint API", ok: true, latencyMs: 322 },
    { name: "LLM Swarm Engine", ok: true, latencyMs: 640 },
    { name: "Chain Listener", ok: true },
  ],
  circuitBreaker: { tripped: false },
};

export const READINESS_PILLARS: T.ReadinessPillar[] = [
  { pillar: "1. Disbursal vault whitelist", isReady: true, score: 100, details: "6 of 6 vendors whitelisted onchain." },
  { pillar: "2. Active company profile", isReady: true, score: 100, details: "ACTIVE with 6 cost centers." },
  { pillar: "3. Latency tiers", isReady: true, score: 92, details: "Arc RPC 184 ms, database 12 ms (limit 2,000 ms)." },
  { pillar: "4. Spending caps", isReady: false, score: 66, details: "Payroll and Tax Escrow have no per-transaction cap." },
  { pillar: "5. Address checksums", isReady: true, score: 100, details: "All 6 wallet addresses pass EIP-55." },
  { pillar: "6. Vendor master immutability", isReady: true, score: 100, details: "All vendors have change lock on." },
  { pillar: "7. Solvency invariant", isReady: true, score: 100, details: "Zero variance between available and cash + invested." },
  { pillar: "8. Circuit breakers", isReady: true, score: 100, details: "Armed and responsive." },
];

export const READINESS: T.ReadinessReport = {
  overallReady: false,
  overallScore: 94.8,
  evaluatedAt: ago(5),
  activeProfile: "PRODUCTION_TESTNET",
  pillars: READINESS_PILLARS,
  blockingIssues: ["Spending caps: Payroll and Tax Escrow have no per-transaction cap."],
  warnings: ["Odoo integration is in error; ERP reconciliation is degraded."],
};

export const AUDIT_SUMMARY: T.AuditSummary = {
  totalVouchers: JOURNAL.length,
  headSequence: JOURNAL[JOURNAL.length - 1].sequenceId,
  headHash: JOURNAL[JOURNAL.length - 1].currentHash,
  chainIntact: true,
  autonomousActions: 41,
  humanActions: 7,
};

export const FUNDING_OPTIONS_HALCYON: T.FundingOptions = {
  accountId: "acc_treasury",
  accountRole: "TREASURY_RESERVE",
  accountWalletAddress: addr("acc_treasury"),
  fiat: {
    card: { available: true, currencies: ["USD", "EUR", "GBP"], speed: "Instant (< 2 minutes)", maxUsdc: "10000.000000" },
    fedwire: { available: true, beneficiary: "Circle Internet Financial LLC", bank: "Bank of New York Mellon", routing: "021000018", account: "8900481239", memo: "BIZARC-MINT-ACC_TREASURY-01", speed: "Same-day (Fedwire hours)" },
    ach: { available: true, routing: "021000018", account: "8900481239", memo: "BIZARC-MINT-ACC_TREASURY-01", speed: "1–2 business days" },
    sepa: { available: true, iban: "LU1200000000000000000", bic: "IRVTUS3N", memo: "BIZARC-MINT-ACC_TREASURY-01", speed: "SEPA Instant (< 30s)" },
  },
  crypto: {
    arcNative: { available: true, chain: "Arc L1", chainId: 5042002, token: "USDC (native gas)", depositAddress: addr("acc_treasury"), speed: "Sub-second" },
    bridge: { available: true, chains: ["Base", "Ethereum", "Arbitrum", "Solana"], targetAddress: addr("acc_treasury"), speed: "~1–3 minutes (CCTP)" },
    swap: { available: true, tokens: ["USDT", "DAI", "ETH", "EURC"], depositAddress: addr("acc_treasury"), autoConvertTo: "USDC" },
  },
};
