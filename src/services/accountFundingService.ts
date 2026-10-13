import crypto from "node:crypto";
import { TreasuryAccountsRepo } from "../database/repos/treasuryAccountsRepo.js";
import { MasterJournalRepo } from "../database/repos/masterJournalRepo.js";
import { AuditLogRepo } from "../database/repos/auditLogRepo.js";
import { FiatDepositSessionRepo } from "../database/repos/fiatDepositSessionRepo.js";
import { DynamicRecordsService } from "../records/dynamicRecordsService.js";
import { TokenSwapService } from "./tokenSwapService.js";

export type FundingRail =
  | "FIAT_CARD_ONRAMP"
  | "FIAT_FEDWIRE"
  | "FIAT_ACH"
  | "FIAT_SEPA"
  | "CRYPTO_ARC_NATIVE"
  | "CRYPTO_CROSS_CHAIN_CCTP"
  | "CRYPTO_TOKEN_SWAP";

export interface AccountFundingOptionsResult {
  accountId: string;
  accountRole: string;
  accountWalletAddress: string;
  fiatOptions: {
    cardOnramp: {
      available: boolean;
      description: string;
      supportedCurrencies: string[];
      settlementSpeed: string;
      maxAmountUsdc: number;
    };
    fedwire: {
      available: boolean;
      beneficiaryName: string;
      bankName: string;
      routingNumber: string;
      accountNumber: string;
      trackingMemo: string;
      settlementSpeed: string;
    };
    ach: {
      available: boolean;
      routingNumber: string;
      accountNumber: string;
      trackingMemo: string;
      settlementSpeed: string;
    };
    sepa: {
      available: boolean;
      iban: string;
      swiftBic: string;
      trackingMemo: string;
      settlementSpeed: string;
    };
  };
  cryptoOptions: {
    arcNative: {
      available: boolean;
      chain: string;
      chainId: number;
      token: string;
      depositAddress: string;
      settlementSpeed: string;
      gasFloorGwei: number;
    };
    crossChainBridge: {
      available: boolean;
      supportedChains: string[];
      targetAddress: string;
      settlementSpeed: string;
    };
    multiTokenSwap: {
      available: boolean;
      supportedTokens: string[];
      depositAddress: string;
      autoConvertToken: string;
    };
  };
}

export interface InitiateFundingParams {
  accountId: string;
  method: FundingRail;
  amountUsdc: number;
  userEmail?: string;
  sourceChain?: string;
  sourceToken?: string;
}

export interface ReconcileFundingDepositParams {
  accountId: string;
  amountUsdc: number;
  depositReference: string;
  method: FundingRail;
  sourceInstitution?: string;
  senderName?: string;
  sourceTxHash?: string;
}

export interface ReconcileFundingDepositResult {
  depositId: string;
  accountId: string;
  method: FundingRail;
  amountUsdc: number;
  creditedBalanceUsdc: number;
  journalSequenceId: string;
  txHash: string;
  status: "CONFIRMED";
  timestamp: string;
}

/**
 * AccountFundingService
 *
 * Provides complete multi-pathway funding infrastructure for ANY BizArc treasury account:
 * - Operating Account
 * - Payroll Account
 * - Tax Account
 * - Central Yield Vault / Reserve
 *
 * Supports both:
 * 1. Fiat Pathways:
 *    - Instant Card / Apple Pay On-ramp (Circle Mint checkout & CLI)
 *    - Institutional Fedwire with unique tracking memo (BIZARC-MINT-<ACCOUNT>)
 *    - Domestic ACH Direct Transfer
 *    - Euro SEPA / SEPA Instant
 * 2. Crypto Pathways:
 *    - Arc L1 Native Direct Deposit (USDC as gas, sub-second)
 *    - Cross-Chain Bridge via CCTP (Base, Ethereum, Arbitrum, Solana)
 *    - Multi-Token Inflow with Auto-Swap to USDC (Circle Swap Kit)
 */
export class AccountFundingService {
  private dynamicRecords: DynamicRecordsService;
  private tokenSwapService: TokenSwapService;

  constructor(options?: {
    dynamicRecords?: DynamicRecordsService;
    tokenSwapService?: TokenSwapService;
  }) {
    this.dynamicRecords = options?.dynamicRecords ?? new DynamicRecordsService();
    this.tokenSwapService = options?.tokenSwapService ?? new TokenSwapService();
  }

  /**
   * Returns comprehensive funding options and deposit coordinates for any account.
   */
  public async getFundingOptions(accountId: string): Promise<AccountFundingOptionsResult> {
    const account = await TreasuryAccountsRepo.getAccountById(accountId);
    if (!account || !account.wallet_address) {
      throw new Error(`[AccountFundingService] ACCOUNT_WALLET_NOT_CONFIGURED: Account '${accountId}' does not have a configured wallet address.`);
    }
    const targetAddress = account.wallet_address;
    const accountRole = account?.role || "OPERATING";
    const trackingMemo = `BIZARC-MINT-${accountId.toUpperCase()}-${targetAddress.slice(2, 8).toUpperCase()}`;

    return {
      accountId,
      accountRole,
      accountWalletAddress: targetAddress,
      fiatOptions: {
        cardOnramp: {
          available: true,
          description: "Instant debit/credit card or Apple Pay funding directly into account balance.",
          supportedCurrencies: ["USD", "EUR", "GBP", "CAD"],
          settlementSpeed: "Instant (< 2 minutes)",
          maxAmountUsdc: 10000,
        },
        fedwire: {
          available: true,
          beneficiaryName: "Circle Internet Financial LLC",
          bankName: "Bank of New York Mellon (BNY Mellon)",
          routingNumber: "021000018",
          accountNumber: "8900481239",
          trackingMemo,
          settlementSpeed: "Same-Day (during Fedwire banking hours)",
        },
        ach: {
          available: true,
          routingNumber: "021000018",
          accountNumber: "8900481239",
          trackingMemo,
          settlementSpeed: "1-2 Business Days",
        },
        sepa: {
          available: true,
          iban: "LU1200000000000000000",
          swiftBic: "IRVTUS3N",
          trackingMemo,
          settlementSpeed: "SEPA Instant (< 30 seconds) / Next Business Day",
        },
      },
      cryptoOptions: {
        arcNative: {
          available: true,
          chain: "Arc L1",
          chainId: 5042,
          token: "USDC (Native Gas)",
          depositAddress: targetAddress,
          settlementSpeed: "Sub-second (< 500ms)",
          gasFloorGwei: 20,
        },
        crossChainBridge: {
          available: true,
          supportedChains: ["Base", "Ethereum", "Arbitrum", "Optimism", "Solana", "Polygon"],
          targetAddress,
          settlementSpeed: "1-3 minutes (via Circle CCTP)",
        },
        multiTokenSwap: {
          available: true,
          supportedTokens: ["USDT", "DAI", "ETH", "WBTC"],
          depositAddress: targetAddress,
          autoConvertToken: "USDC",
        },
      },
    };
  }

  /**
   * Initiates a funding session (e.g. Card checkout link or Cross-Chain intent).
   */
  public async initiateFundingSession(params: InitiateFundingParams): Promise<{
    sessionId: string;
    accountId: string;
    method: FundingRail;
    amountUsdc: number;
    checkoutUrl?: string;
    cliCommandVerbatim?: string;
    trackingMemo?: string;
    depositAddress?: string;
    expiresAt: string;
  }> {
    const account = await TreasuryAccountsRepo.getAccountById(params.accountId);
    if (!account || !account.wallet_address) {
      throw new Error(`[AccountFundingService] ACCOUNT_WALLET_NOT_CONFIGURED: Account '${params.accountId}' does not have a configured wallet address.`);
    }
    const targetAddress = account.wallet_address;
    const sessionId = `fund_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const expiresAt = new Date(Date.now() + 3600 * 1000).toISOString();
    const trackingMemo = `BIZARC-MINT-${params.accountId.toUpperCase()}-${sessionId.slice(5, 11).toUpperCase()}`;

    let checkoutUrl: string | undefined;
    let cliCommandVerbatim: string | undefined;
    let depositAddress: string | undefined = targetAddress;

    if (params.method === "FIAT_CARD_ONRAMP") {
      cliCommandVerbatim = `circle wallet fund --address ${targetAddress} --chain ARC --amount ${params.amountUsdc.toFixed(2)} --token usdc --method fiat --open`;
      checkoutUrl = `https://checkout.circle.com/onramp?session=${sessionId}&address=${targetAddress}&chain=ARC&amount=${params.amountUsdc}&email=${encodeURIComponent(params.userEmail || "")}`;

      await FiatDepositSessionRepo.createSession({
        session_id: sessionId,
        account_id: params.accountId,
        method: "CARD_ONRAMP",
        amount_usdc: params.amountUsdc,
        tracking_memo: trackingMemo,
        checkout_url: checkoutUrl,
        cli_command: cliCommandVerbatim,
        status: "PENDING",
      });
    } else if (params.method === "FIAT_FEDWIRE" || params.method === "FIAT_ACH" || params.method === "FIAT_SEPA") {
      await FiatDepositSessionRepo.createSession({
        session_id: sessionId,
        account_id: params.accountId,
        method: params.method.replace("FIAT_", "") as any,
        amount_usdc: params.amountUsdc,
        tracking_memo: trackingMemo,
        status: "PENDING",
      });
    }

    return {
      sessionId,
      accountId: params.accountId,
      method: params.method,
      amountUsdc: params.amountUsdc,
      checkoutUrl,
      cliCommandVerbatim,
      trackingMemo,
      depositAddress,
      expiresAt,
    };
  }

  /**
   * Reconciles a confirmed deposit (fiat wire, card settlement, or crypto inflow),
   * crediting the designated account's liquid balance in PostgreSQL and posting double-entry vouchers.
   */
  public async reconcileDeposit(params: ReconcileFundingDepositParams): Promise<ReconcileFundingDepositResult> {
    const timestamp = new Date().toISOString();
    const depositId = `dep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const txHash = params.sourceTxHash || `0x${crypto.createHash("sha256").update(`${depositId}:${params.depositReference}`).digest("hex")}`;

    // Confirm session in database if memo matches
    try {
      const session = await FiatDepositSessionRepo.getSessionByMemo(params.depositReference);
      if (session) {
        await FiatDepositSessionRepo.confirmSession(session.session_id);
      }
    } catch {
      // Non-fatal
    }

    // 1. Double-Entry Master Journal Entry: Debit Cash, Credit Equity/Capital
    const isCrypto = params.method.startsWith("CRYPTO_");
    const creditCategory = isCrypto ? "Equity:CryptoTreasuryContribution" : "Equity:FiatCapitalContribution";

    const entry = await MasterJournalRepo.appendEntry({
      account_id: params.accountId,
      action_type: `ACCOUNT_FUNDING_${params.method}`,
      debit_account: `Asset:Cash:USDC:${params.accountId}`,
      credit_account: `${creditCategory}:${params.accountId}`,
      amount_usdc: params.amountUsdc,
      document_ref: params.depositReference,
    });

    // 2. Audit Log Entry
    await AuditLogRepo.appendAuditLog({
      account_id: params.accountId,
      actor_agent: "AccountFundingManager",
      action_type: `ACCOUNT_FUNDING_CONFIRMED_${params.method}`,
      amount_usdc: params.amountUsdc,
      is_autonomous: true,
      tx_hash: txHash,
      reason: `Account '${params.accountId}' funded with $${params.amountUsdc.toFixed(2)} USDC via ${params.method} (Ref: ${params.depositReference})`,
      pre_state_snapshot: { accountId: params.accountId },
      post_state_snapshot: { creditedAmount: params.amountUsdc, depositId },
    });

    // 3. Update Liquid Balances in PostgreSQL (Dynamic Record 1 & 2)
    const currentTrip = await this.dynamicRecords.getTripartiteBalance(params.accountId);
    const addedRaw = this.dynamicRecords.parseUsdcToRaw(params.amountUsdc.toFixed(6));
    const newLiquidRaw = currentTrip.liquidCashRaw + addedRaw;

    await this.dynamicRecords.calculateSafeToInvest(
      params.accountId,
      7 * 86400,
      undefined,
      newLiquidRaw,
      currentTrip.investedYieldRaw
    );

    const updatedTrip = await this.dynamicRecords.getTripartiteBalance(params.accountId);

    return {
      depositId,
      accountId: params.accountId,
      method: params.method,
      amountUsdc: params.amountUsdc,
      creditedBalanceUsdc: parseFloat(updatedTrip.liquidCashUsdc),
      journalSequenceId: entry.sequence_id || "",
      txHash,
      status: "CONFIRMED",
      timestamp,
    };
  }
}
