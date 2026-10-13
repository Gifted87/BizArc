/**
 * Physical Ingress HTTP REST & Webhook Server.
 * ============================================
 * Provides secure HTTP endpoints listening on TCP ports to wire physical triggers
 * (webhooks from ERPs/Gmail/Stripe, frontend onboarding wizard, admin ad-hoc payments,
 * and SPRS decisions) directly into the 5 Reactive State Machines.
 * 
 * Security Guardrails Enforced:
 * - CORS origin filtering restricted to configured enterprise frontend origins (no wildcard '*').
 * - API Key / Bearer token authentication required on all operational state mutation endpoints.
 * - EIP-712 cryptographic signature verification enforced on SPRS human approval decisions.
 */

import http, { IncomingMessage, ServerResponse } from "node:http";
import { TreasuryStateMachineOrchestrator } from "../orchestration/treasuryStateMachineOrchestrator.js";
import { TokenSwapService } from "../services/tokenSwapService.js";
import { FiatFundingService } from "../services/fiatFundingService.js";
import { LiabilitySettingsService } from "../services/liabilitySettingsService.js";
import { ManualDisbursalService } from "../services/manualDisbursalService.js";
import { AccountFundingService } from "../services/accountFundingService.js";
import { UniversalPaymentRouter } from "../payments/universalPaymentRouter.js";
import { FiatPayoutRepo } from "../database/repos/fiatPayoutRepo.js";

export const DEFAULT_API_KEY = "bizarc_auth_token_live_2026";

export class SystemHttpServer {
  private server: http.Server | null = null;
  private orchestrator: TreasuryStateMachineOrchestrator;
  private swapService: TokenSwapService;
  private fiatFundingService: FiatFundingService;
  private liabilitySettingsService: LiabilitySettingsService;
  private manualDisbursalService: ManualDisbursalService;
  private accountFundingService: AccountFundingService;
  private port: number;
  private isListening = false;

  constructor(orchestrator?: TreasuryStateMachineOrchestrator, port = 3000) {
    this.orchestrator = orchestrator ?? new TreasuryStateMachineOrchestrator();
    this.swapService = new TokenSwapService();
    this.fiatFundingService = new FiatFundingService();
    this.liabilitySettingsService = new LiabilitySettingsService();
    this.manualDisbursalService = new ManualDisbursalService();
    this.accountFundingService = new AccountFundingService();
    this.port = port;
  }

  public getOrchestrator(): TreasuryStateMachineOrchestrator {
    return this.orchestrator;
  }

  public async start(): Promise<number> {
    if (this.isListening) return this.port;

    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        try {
          await this.handleRequest(req, res);
        } catch (err: any) {
          this.sendJson(req, res, 500, { error: "INTERNAL_SERVER_ERROR", message: err.message });
        }
      });

      this.server.on("error", (err) => reject(err));

      this.server.listen(this.port, () => {
        this.isListening = true;
        const addr = this.server?.address();
        const actualPort = typeof addr === "object" && addr ? addr.port : this.port;
        this.port = actualPort;
        console.log(`[SystemHttpServer] Physical Ingress Server listening on http://localhost:${actualPort}`);
        resolve(actualPort);
      });
    });
  }

  public async stop(): Promise<void> {
    if (!this.server || !this.isListening) return;
    return new Promise((resolve) => {
      this.server?.close(() => {
        this.isListening = false;
        resolve();
      });
    });
  }

  private async parseBody(req: IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let data = "";
      req.on("data", (chunk) => {
        data += chunk;
      });
      req.on("end", () => {
        if (!data) return resolve({});
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error("INVALID_JSON_BODY"));
        }
      });
      req.on("error", (err) => reject(err));
    });
  }

  /**
   * Evaluates incoming request origin against configured allowed CORS origins.
   * Eliminates wildcard '*' vulnerability.
   */
  private getAllowedOrigin(req: IncomingMessage): string | null {
    const origin = req.headers.origin;
    const allowedEnv = process.env.ALLOWED_ORIGINS || "http://localhost:5173,http://localhost:3000,https://bizarc.io";
    const allowedList = allowedEnv.split(",").map((s) => s.trim().toLowerCase());

    if (!origin) {
      // Direct server-to-server or curl calls without origin header
      return allowedList[0] || "http://localhost:5173";
    }

    if (allowedList.includes(origin.toLowerCase())) {
      return origin;
    }

    return null;
  }

  private sendJson(req: IncomingMessage, res: ServerResponse, status: number, body: any) {
    const allowedOrigin = this.getAllowedOrigin(req);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
      "Vary": "Origin",
    };

    if (allowedOrigin) {
      headers["Access-Control-Allow-Origin"] = allowedOrigin;
      headers["Access-Control-Allow-Credentials"] = "true";
    }

    res.writeHead(status, headers);
    const serialized = JSON.stringify(
      body,
      (_key, value) => (typeof value === "bigint" ? value.toString() : value),
      2
    );
    res.end(serialized);
  }

  /**
   * Ingress Authentication Gatekeeper:
   * Validates API Key or Bearer Token against environment configuration.
   */
  private authenticate(req: IncomingMessage): { authenticated: boolean; error?: string } {
    const configuredKey =
      process.env.BIZARC_API_KEY ||
      process.env.ADMIN_API_KEY ||
      DEFAULT_API_KEY;

    const authHeader = req.headers.authorization;
    const apiKeyHeader = req.headers["x-api-key"] as string | undefined;

    let token: string | undefined;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.slice(7).trim();
    } else if (apiKeyHeader) {
      token = apiKeyHeader.trim();
    }

    if (!token || token !== configuredKey) {
      return {
        authenticated: false,
        error: "Missing or invalid API key. Provide 'Authorization: Bearer <key>' or 'x-api-key: <key>'.",
      };
    }

    return { authenticated: true };
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;
    const method = req.method?.toUpperCase();

    if (method === "OPTIONS") {
      return this.sendJson(req, res, 204, {});
    }

    // Public Endpoint: Health Check Probe
    if (pathname === "/api/health" && method === "GET") {
      return this.sendJson(req, res, 200, { status: "HEALTHY", uptime: process.uptime() });
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // INGRESS AUTHENTICATION BARRIER
    // ─────────────────────────────────────────────────────────────────────────────
    const auth = this.authenticate(req);
    if (!auth.authenticated) {
      return this.sendJson(req, res, 401, {
        error: "UNAUTHORIZED",
        message: auth.error,
      });
    }

    // STATE MACHINE 1: ONBOARDING
    if (pathname === "/api/onboarding/session" && method === "POST") {
      const body = await this.parseBody(req);
      const result = await this.orchestrator.onboardingMachine.startOnboarding(body);
      return this.sendJson(req, res, result.success ? 200 : 400, result);
    }

    if (pathname === "/api/onboarding/step" && method === "POST") {
      const body = await this.parseBody(req);
      const result = await this.orchestrator.onboardingMachine.submitStep(
        body.sessionId,
        body.step,
        body.payload
      );
      return this.sendJson(req, res, result.success ? 200 : 400, result);
    }

    if (pathname === "/api/onboarding/activate" && method === "POST") {
      const body = await this.parseBody(req);
      const result = await this.orchestrator.onboardingMachine.activateOrganization(body.sessionId);
      return this.sendJson(req, res, result.success ? 200 : 400, result);
    }

    // STATE MACHINE 2: INGESTION WEBHOOK
    if (pathname === "/api/webhooks/ingest" && method === "POST") {
      const body = await this.parseBody(req);
      const result = await this.orchestrator.onInboundInvoice(body);
      return this.sendJson(req, res, result.success ? 200 : 400, result);
    }

    // STATE MACHINE 3: BALANCE MUTATION WEBHOOK / EVENT TRIGGER
    if (pathname === "/api/events/balance-mutation" && method === "POST") {
      const body = await this.parseBody(req);
      const result = await this.orchestrator.onBalanceMutation(body);
      return this.sendJson(req, res, result.success ? 200 : 400, result);
    }

    // STATE MACHINE 4: DISBURSAL MANUAL TRIGGER
    if (pathname === "/api/disbursal/trigger-due" && method === "POST") {
      const body = await this.parseBody(req);
      const result = await this.orchestrator.onDueLiabilityDisbursal(body.liability);
      return this.sendJson(req, res, result.success ? 200 : 400, result);
    }

    // STATE MACHINE 5: AD-HOC DISCRETIONARY PAYMENT
    if (pathname === "/api/payments/ad-hoc" && method === "POST") {
      const body = await this.parseBody(req);
      const result = await this.orchestrator.onAdHocPaymentRequest(body);
      return this.sendJson(req, res, result.success ? 200 : 400, result);
    }

    // SPRS DECISION GATEWAY (HUMAN SIGN-OFF)
    // Enforces that human approval must carry an authentic cryptographic EIP-712 signature
    if (pathname.startsWith("/api/sprs/") && pathname.endsWith("/decision") && method === "POST") {
      const parts = pathname.split("/");
      const requestId = parts[3];
      const body = await this.parseBody(req);

      if (body.decision === "APPROVE" && !body.adminSignature) {
        return this.sendJson(req, res, 400, {
          error: "SIGNATURE_REQUIRED",
          message: "A valid cryptographic EIP-712 human adminSignature is required to approve SPRS requests.",
        });
      }

      try {
        const result = await this.orchestrator.handleSprsDecision({
          requestId,
          decision: body.decision,
          adminSignature: body.adminSignature,
        });
        return this.sendJson(req, res, result.success ? 200 : 400, result);
      } catch (err: any) {
        return this.sendJson(req, res, 400, {
          error: "AUTHORIZATION_ERROR",
          message: err.message,
        });
      }
    }

    // TREASURY OVERVIEW & VISIBILITY
    if (pathname === "/api/treasury/overview" && method === "GET") {
      const companyId = url.searchParams.get("companyId") || undefined;
      const overview = await this.orchestrator.getTreasuryOverview(companyId);
      return this.sendJson(req, res, 200, { overview });
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // TOKEN SWAP & CONVERSION RAILS (Circle Swap Kit / Viem)
    // ─────────────────────────────────────────────────────────────────────────────
    if (pathname === "/api/swaps/estimate" && method === "POST") {
      const body = await this.parseBody(req);
      try {
        const estimate = await this.swapService.estimateSwap(body);
        return this.sendJson(req, res, 200, { success: true, data: estimate });
      } catch (err: any) {
        return this.sendJson(req, res, 400, { success: false, error: err.message });
      }
    }

    if (pathname === "/api/swaps/execute" && method === "POST") {
      const body = await this.parseBody(req);
      try {
        const result = await this.swapService.executeSwap(body);
        return this.sendJson(req, res, result.success ? 200 : 400, result);
      } catch (err: any) {
        return this.sendJson(req, res, 400, { success: false, error: err.message });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // FIAT FUNDING RAILS (Cards/ACH On-ramp & Institutional Fedwire)
    // ─────────────────────────────────────────────────────────────────────────────
    if (pathname === "/api/funding/fiat/onramp" && method === "POST") {
      const body = await this.parseBody(req);
      try {
        const result = await this.fiatFundingService.createFiatOnRampSession(body);
        return this.sendJson(req, res, 200, { success: true, data: result });
      } catch (err: any) {
        return this.sendJson(req, res, 400, { success: false, error: err.message });
      }
    }

    if (pathname === "/api/funding/fiat/wire-instructions" && method === "GET") {
      const accountId = url.searchParams.get("accountId") || "acc_primary";
      const currency = (url.searchParams.get("currency") as "USD" | "EUR") || "USD";
      try {
        const instructions = await this.fiatFundingService.getFiatWireInstructions({ accountId, currency });
        return this.sendJson(req, res, 200, { success: true, data: instructions });
      } catch (err: any) {
        return this.sendJson(req, res, 400, { success: false, error: err.message });
      }
    }

    if (pathname === "/api/funding/fiat/deposit-reconcile" && method === "POST") {
      const body = await this.parseBody(req);
      try {
        const result = await this.fiatFundingService.recordFiatDeposit(body);
        return this.sendJson(req, res, 200, { success: true, data: result });
      } catch (err: any) {
        return this.sendJson(req, res, 400, { success: false, error: err.message });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // FIAT DISBURSAL RAILS (Traditional Banking Disbursals / Rail 5)
    // ─────────────────────────────────────────────────────────────────────────────
    if (pathname === "/api/disbursals/fiat" && method === "POST") {
      const body = await this.parseBody(req);
      try {
        const router = new UniversalPaymentRouter();
        const result = await router.routeAndExecute({
          intent: {
            intentId: body.intentId || `INTENT_FIAT_${Date.now()}`,
            primaryAccountId: body.accountId,
            vendorId: body.vendorId,
            vendorName: body.vendorName || body.vendorId,
            amountUsdc: Number(body.amountUsdc),
            beneficiaryBank: body.beneficiaryBank,
            declaredReason: body.declaredReason || "Vendor traditional bank settlement via Rail 5",
            invoiceId: body.invoiceId,
          },
          overrideRail: "FIAT_PAYOUT",
          adminSignature: body.adminSignature,
          clearanceCode: body.clearanceCode,
          sprsRequestId: body.sprsRequestId,
        });
        return this.sendJson(req, res, result.success ? 200 : 400, result);
      } catch (err: any) {
        return this.sendJson(req, res, 400, { success: false, error: err.message });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // CIRCLE MINT WEBHOOK (Reconcile payouts & deposits)
    // ─────────────────────────────────────────────────────────────────────────────
    if (pathname === "/api/webhooks/circle-mint" && method === "POST") {
      const body = await this.parseBody(req);
      const eventType = body.type || body.eventType;

      if (eventType === "payout.paid" || eventType === "payouts.complete") {
        const payoutId = body.data?.id || body.payoutId;
        if (payoutId) {
          await FiatPayoutRepo.confirmPayoutSettlement(payoutId);
        }
        return this.sendJson(req, res, 200, { success: true, event: eventType, status: "SETTLED" });
      } else if (eventType === "transfer.complete" || eventType === "payments.paid") {
        const trackingMemo = body.data?.trackingMemo || body.trackingMemo || body.data?.reference;
        const amount = parseFloat(body.data?.amount?.amount || body.amountUsdc || "0");
        const accountId = body.accountId || "acc_primary";
        if (trackingMemo && amount > 0) {
          await this.fiatFundingService.recordFiatDeposit({
            accountId,
            amountUsdc: amount,
            depositReference: trackingMemo,
            sourceBank: "Circle Mint Fedwire Webhook",
          });
        }
        return this.sendJson(req, res, 200, { success: true, event: eventType, status: "DEPOSIT_RECONCILED" });
      }

      return this.sendJson(req, res, 200, { success: true, received: true });
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // LIABILITY & VENDOR PAYMENT METHOD CONFIGURATION (Crypto Rails 1-4 & Fiat Sub-Methods)
    // ─────────────────────────────────────────────────────────────────────────────
    if (pathname.startsWith("/api/liabilities/") && pathname.endsWith("/payment-method")) {
      const parts = pathname.split("/");
      const liabilityId = parts[3];
      if (method === "POST") {
        const body = await this.parseBody(req);
        try {
          const result = await this.liabilitySettingsService.configurePaymentMethod({
            companyId: body.companyId || "default_org",
            vendorId: body.vendorId,
            liabilityId,
            preferredRail: body.preferredRail,
            preferredSubMethod: body.preferredSubMethod,
            cryptoDetails: body.cryptoDetails,
            fiatDetails: body.fiatDetails,
            disbursalRules: body.disbursalRules,
          });
          return this.sendJson(req, res, 200, { success: true, data: result });
        } catch (err: any) {
          return this.sendJson(req, res, 400, { success: false, error: err.message });
        }
      } else if (method === "GET") {
        const companyId = url.searchParams.get("companyId") || "default_org";
        const vendorId = url.searchParams.get("vendorId") || liabilityId;
        try {
          const result = await this.liabilitySettingsService.getPaymentMethod({
            companyId,
            vendorId,
            liabilityId,
          });
          return this.sendJson(req, res, 200, { success: true, data: result });
        } catch (err: any) {
          return this.sendJson(req, res, 400, { success: false, error: err.message });
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // MANUAL DISBURSAL ENDPOINT (User-Initiated Payments via Fiat or Crypto)
    // ─────────────────────────────────────────────────────────────────────────────
    if (pathname === "/api/disbursals/manual" && method === "POST") {
      const body = await this.parseBody(req);
      try {
        const result = await this.manualDisbursalService.executeManualDisbursal({
          companyId: body.companyId || "default_org",
          sourceAccountId: body.sourceAccountId || body.accountId,
          vendorId: body.vendorId,
          vendorName: body.vendorName || body.vendorId,
          amountUsdc: Number(body.amountUsdc),
          paymentRail: body.paymentRail,
          fiatDetails: body.fiatDetails,
          cryptoDetails: body.cryptoDetails,
          declaredReason: body.declaredReason || "Manual payment initiated by user",
          invoiceId: body.invoiceId,
          poReference: body.poReference,
          category: body.category,
          adminSignature: body.adminSignature,
          clearanceCode: body.clearanceCode,
        });
        return this.sendJson(req, res, result.success ? 200 : 400, result);
      } catch (err: any) {
        return this.sendJson(req, res, 400, { success: false, error: err.message });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // UNIFIED ACCOUNT FUNDING ENDPOINTS (Operating, Payroll, Tax, Yield Vault)
    // ─────────────────────────────────────────────────────────────────────────────
    if (pathname.startsWith("/api/accounts/") && pathname.endsWith("/funding-options") && method === "GET") {
      const parts = pathname.split("/");
      const accountId = parts[3];
      try {
        const result = await this.accountFundingService.getFundingOptions(accountId);
        return this.sendJson(req, res, 200, { success: true, data: result });
      } catch (err: any) {
        return this.sendJson(req, res, 400, { success: false, error: err.message });
      }
    }

    if (pathname.startsWith("/api/accounts/") && pathname.endsWith("/fund") && method === "POST") {
      const parts = pathname.split("/");
      const accountId = parts[3];
      const body = await this.parseBody(req);
      try {
        const result = await this.accountFundingService.initiateFundingSession({
          accountId,
          method: body.method,
          amountUsdc: Number(body.amountUsdc),
          userEmail: body.userEmail,
          sourceChain: body.sourceChain,
          sourceToken: body.sourceToken,
        });
        return this.sendJson(req, res, 200, { success: true, data: result });
      } catch (err: any) {
        return this.sendJson(req, res, 400, { success: false, error: err.message });
      }
    }

    return this.sendJson(req, res, 404, { error: "NOT_FOUND", pathname });
  }
}
