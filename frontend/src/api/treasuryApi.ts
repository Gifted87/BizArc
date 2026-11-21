/**
 * BizArc Treasury & Liquidity Engine - Live HTTP & SSE Client
 * Connects frontend directly to SystemHttpServer endpoints.
 */

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  [key: string]: any;
}

const BASE_URL = ""; // Relies on Vite proxy to http://localhost:3000

class TreasuryApiClient {
  private token: string | null = null;
  private companyId: string | null = "org_bizglobal";

  public setToken(token: string | null) {
    this.token = token;
  }

  public setCompanyId(companyId: string | null) {
    this.companyId = companyId;
  }

  private async fetchJson<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    };

    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    // Attach tenant companyId in query if GET and present
    let url = `${BASE_URL}${path}`;
    if (this.companyId && !url.includes("companyId=")) {
      const sep = url.includes("?") ? "&" : "?";
      url = `${url}${sep}companyId=${encodeURIComponent(this.companyId)}`;
    }

    try {
      const res = await fetch(url, { ...options, headers });
      const data = await res.json();
      return data;
    } catch (err: any) {
      return {
        success: false,
        error: err.message || "Network request failed",
      };
    }
  }

  // --- Treasury Cockpit & Balances ---
  public async getDistribution(companyId?: string) {
    const query = companyId ? `?companyId=${companyId}` : "";
    return this.fetchJson(`/api/treasury/distribution${query}`);
  }

  public async getSafeToInvest(accountId = "acc_primary", companyId?: string) {
    const query = `?accountId=${encodeURIComponent(accountId)}${companyId ? `&companyId=${companyId}` : ""}`;
    return this.fetchJson(`/api/treasury/safe-to-invest${query}`);
  }

  public async getShortfalls(companyId?: string) {
    const query = companyId ? `?companyId=${companyId}` : "";
    return this.fetchJson(`/api/treasury/shortfalls${query}`);
  }

  public async runShortfallRebalance(companyId?: string) {
    return this.fetchJson(`/api/treasury/shortfalls/run`, {
      method: "POST",
      body: JSON.stringify({ companyId: companyId || this.companyId }),
    });
  }

  // --- Yield Machine & Rebalancing ---
  public async getYieldPerformance(companyId?: string) {
    const query = companyId ? `?companyId=${companyId}` : "";
    return this.fetchJson(`/api/yield/performance${query}`);
  }

  public async getYieldMoves(accountId?: string, limit = 50, companyId?: string) {
    let query = `?limit=${limit}`;
    if (accountId) query += `&accountId=${encodeURIComponent(accountId)}`;
    if (companyId) query += `&companyId=${encodeURIComponent(companyId)}`;
    return this.fetchJson(`/api/treasury/yield/moves${query}`);
  }

  public async executeSweep(accountId = "acc_primary", amountUsdc?: string | number, companyId?: string) {
    return this.fetchJson(`/api/yield/sweep`, {
      method: "POST",
      body: JSON.stringify({ accountId, amountUsdc, companyId: companyId || this.companyId }),
    });
  }

  public async executeRecall(accountId = "acc_primary", amountUsdc: number | string = 0, companyId?: string) {
    return this.fetchJson(`/api/yield/recall`, {
      method: "POST",
      body: JSON.stringify({ accountId, amountUsdc, companyId: companyId || this.companyId }),
    });
  }

  // --- Operating Accounts ---
  public async getAccounts(companyId?: string) {
    const query = companyId ? `?companyId=${companyId}` : "";
    return this.fetchJson(`/api/accounts${query}`);
  }

  public async createAccount(payload: {
    accountId: string;
    name: string;
    role: string;
    minOperatingFloorUsdc: number;
    safetyBufferRatio: number;
    perTxCapUsdc?: number;
    dailyCapUsdc?: number;
    maxAutonomousSweepLimit?: number;
    excludeFromWaterfall?: boolean;
    companyId?: string;
  }) {
    return this.fetchJson(`/api/accounts`, {
      method: "POST",
      body: JSON.stringify({ ...payload, companyId: payload.companyId || this.companyId }),
    });
  }

  public async updateAccount(
    accountId: string,
    payload: {
      minOperatingFloorUsdc?: number;
      safetyBufferRatio?: number;
      perTxCapUsdc?: number;
      dailyCapUsdc?: number;
      maxAutonomousSweepLimit?: number;
      excludeFromWaterfall?: boolean;
      companyId?: string;
    }
  ) {
    return this.fetchJson(`/api/accounts/${encodeURIComponent(accountId)}`, {
      method: "PUT",
      body: JSON.stringify({ ...payload, companyId: payload.companyId || this.companyId }),
    });
  }

  public async transferFunds(payload: {
    fromAccountId: string;
    toAccountId: string;
    amountUsdc: string;
    memo?: string;
    reason?: string;
    companyId?: string;
  }) {
    return this.fetchJson(`/api/accounts/transfer`, {
      method: "POST",
      body: JSON.stringify({
        ...payload,
        reason: payload.reason || payload.memo,
        memo: payload.memo || payload.reason,
        companyId: payload.companyId || this.companyId,
      }),
    });
  }

  // --- Account Funding & Wires ---
  public async getFundingOptions(accountId: string) {
    return this.fetchJson(`/api/accounts/${encodeURIComponent(accountId)}/funding-options`);
  }

  public async fundAccount(
    accountId: string,
    payload: {
      method: "CARD" | "ACH" | "CRYPTO" | "FIAT_CARD_ONRAMP" | "FIAT_FEDWIRE" | "CRYPTO_ARC_NATIVE";
      amountUsdc: number;
      userEmail?: string;
      sourceChain?: string;
      sourceToken?: string;
      companyId?: string;
    }
  ) {
    return this.fetchJson(`/api/accounts/${encodeURIComponent(accountId)}/fund`, {
      method: "POST",
      body: JSON.stringify({ ...payload, companyId: payload.companyId || this.companyId }),
    });
  }

  public async getWireInstructions(accountId = "acc_primary", currency = "USD") {
    return this.fetchJson(
      `/api/funding/fiat/wire-instructions?accountId=${encodeURIComponent(accountId)}&currency=${currency}`
    );
  }

  public async createFiatOnramp(accountId: string, amountUsd: number) {
    return this.fetchJson(`/api/funding/fiat/onramp`, {
      method: "POST",
      body: JSON.stringify({ accountId, amountUsd, amountUsdc: amountUsd }),
    });
  }

  public async reconcileFiatDeposit(payload: {
    targetAccountId?: string;
    accountId?: string;
    amountUsdc: number;
    wireReference?: string;
    depositReference?: string;
    sourceBank?: string;
  }) {
    const accountId = payload.accountId || payload.targetAccountId || "acc_primary";
    const depositReference = payload.depositReference || payload.wireReference || `FIAT_DEP_${Date.now()}`;
    return this.fetchJson(`/api/funding/fiat/deposit-reconcile`, {
      method: "POST",
      body: JSON.stringify({
        ...payload,
        accountId,
        targetAccountId: accountId,
        depositReference,
        wireReference: depositReference,
      }),
    });
  }

  // --- Swaps ---
  public async estimateSwap(payload: {
    fromChain: string;
    fromToken: string;
    toChain?: string;
    toToken?: string;
    amount: string;
  }) {
    return this.fetchJson(`/api/swaps/estimate`, {
      method: "POST",
      body: JSON.stringify({ toChain: "Arc", toToken: "USDC", ...payload }),
    });
  }

  public async executeSwap(payload: any) {
    return this.fetchJson(`/api/swaps/execute`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  // --- SPRS, Governance & Onboarding ---
  public async payLiability(liabilityId: string, companyId?: string) {
    return this.fetchJson(`/api/disbursal/trigger-due`, {
      method: "POST",
      body: JSON.stringify({ liabilityId, companyId: companyId || this.companyId }),
    });
  }

  public async signSpr(requestId: string, adminSignature?: string, memo?: string) {
    return this.fetchJson(`/api/sprs/${encodeURIComponent(requestId)}/sign`, {
      method: "POST",
      body: JSON.stringify({ privateKey: adminSignature, memo }),
    });
  }

  public async decideSpr(
    requestId: string,
    decision: "APPROVE" | "CANCEL_WITH_INSTRUCTIONS",
    memo?: string,
    adminSignature?: string
  ) {
    return this.fetchJson(`/api/sprs/${encodeURIComponent(requestId)}/decision`, {
      method: "POST",
      body: JSON.stringify({ decision, memo, adminSignature }),
    });
  }

  public async tripCircuitBreaker(reason: string) {
    return this.fetchJson(`/api/governance/circuit-breaker`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  }

  public async disarmCircuitBreaker(clearanceCode: string) {
    return this.fetchJson(`/api/governance/circuit-breaker/disarm`, {
      method: "POST",
      body: JSON.stringify({ clearanceCode }),
    });
  }

  public async disputeLiability(liabilityId: string, reason?: string, accountId?: string, companyId?: string) {
    return this.fetchJson(`/api/liabilities/dispute`, {
      method: "POST",
      body: JSON.stringify({ liabilityId, reason, accountId, companyId: companyId || this.companyId }),
    });
  }

  public async disburseManual(payload: {
    companyId?: string;
    sourceAccountId?: string;
    accountId?: string;
    vendorId: string;
    vendorName?: string;
    amountUsdc: number | string;
    paymentRail: string;
    declaredReason?: string;
    invoiceId?: string;
    poReference?: string;
    category?: string;
    fiatDetails?: any;
    cryptoDetails?: any;
  }) {
    return this.fetchJson(`/api/disbursals/manual`, {
      method: "POST",
      body: JSON.stringify({ ...payload, companyId: payload.companyId || this.companyId }),
    });
  }

  public async disburseAdHoc(payload: any) {
    return this.fetchJson(`/api/payments/ad-hoc`, {
      method: "POST",
      body: JSON.stringify({ ...payload, companyId: payload.companyId || this.companyId }),
    });
  }

  public async activateOnboarding(sessionId = "default_session") {
    return this.fetchJson(`/api/onboarding/activate`, {
      method: "POST",
      body: JSON.stringify({ sessionId }),
    });
  }

  // --- Live Server-Sent Events (SSE) Stream ---
  public subscribeToEvents(
    onEvent: (event: { type: string; data: any }) => void
  ): () => void {
    const sseUrl = `${BASE_URL}/api/events`;
    const eventSource = new EventSource(sseUrl);

    eventSource.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data);
        onEvent({ type: "message", data: parsed });
      } catch {}
    };

    const registeredEvents = [
      "balance:mutated",
      "yield:swept",
      "yield:recalled",
      "deposit:confirmed",
      "sprs:created",
      "circuit_breaker:tripped",
      "circuit_breaker:disarmed",
      "discovery:completed",
    ];

    registeredEvents.forEach((evType) => {
      eventSource.addEventListener(evType, (e: any) => {
        try {
          const parsed = JSON.parse(e.data);
          onEvent({ type: evType, data: parsed });
        } catch {}
      });
    });

    return () => {
      eventSource.close();
    };
  }
}

export const treasuryApi = new TreasuryApiClient();
