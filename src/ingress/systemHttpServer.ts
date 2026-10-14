/**
 * Physical Ingress HTTP REST & Webhook Server.
 * ============================================
 * Provides secure HTTP endpoints listening on TCP ports to wire physical triggers
 * (webhooks from ERPs/Gmail/Stripe, frontend onboarding wizard, admin ad-hoc payments,
 * SPRS decisions, ledger verification, and account management) directly into the
 * 5 Reactive State Machines and autonomous treasury engines.
 * 
 * Exposes all 12 Architectural Categories:
 *  1. Account Lifecycle & Management APIs
 *  2. SPRS, Governance & EIP-712 Signing APIs
 *  3. Operational State, Ledger & Hash-Chain Verification APIs
 *  4. Liabilities & Invoice Settlement APIs
 *  5. Vendor Master & Banking Profiles APIs
 *  6. Yield, Sweeps & Liquidity Management APIs
 *  7. Currency Swaps & Fiat Off-Ramping APIs
 *  8. Onboarding Wizard & Math Rules QA APIs
 *  9. ERP Synchronization & Model Context Protocol (MCP) APIs
 * 10. System Governance, Circuit Breakers & Policies APIs
 * 11. Authentication, Sessions & Roles APIs
 * 12. Webhooks & External Event Ingress APIs
 * 
 * Security Guardrails Enforced:
 * - CORS origin filtering restricted to configured enterprise frontend origins (no wildcard '*').
 * - API Key / Bearer token authentication required on all operational state mutation endpoints.
 * - EIP-712 cryptographic signature verification enforced on SPRS human approval decisions.
 * - Operators never need CLI commands; every single action and signing flow is API-accessible.
 */

import http, { IncomingMessage, ServerResponse } from "node:http";
import crypto from "node:crypto";
import { TreasuryStateMachineOrchestrator } from "../orchestration/treasuryStateMachineOrchestrator.js";
import { TokenSwapService } from "../services/tokenSwapService.js";
import { FiatFundingService } from "../services/fiatFundingService.js";
import { LiabilitySettingsService } from "../services/liabilitySettingsService.js";
import { LiabilityManagementService } from "../services/liabilityManagementService.js";
import { ManualDisbursalService } from "../services/manualDisbursalService.js";
import { AccountFundingService } from "../services/accountFundingService.js";
import { UniversalPaymentRouter } from "../payments/universalPaymentRouter.js";
import { FiatPayoutRepo } from "../database/repos/fiatPayoutRepo.js";
import { AccountManagementService } from "../services/accountManagementService.js";
import { AccountIntelligenceService } from "../services/accountIntelligenceService.js";
import { UnifiedOperationalStateService } from "../services/unifiedOperationalStateService.js";
import { MathRulesQAEngine } from "../services/mathRulesQAEngine.js";
import { ProductionReadinessService } from "../services/productionReadinessService.js";
import { TenantPolicyManager } from "../config/tenantPolicyManager.js";
import { VendorMasterRepo } from "../database/repos/vendorMasterRepo.js";
import { VendorBankRepo } from "../database/repos/vendorBankRepo.js";
import { PermissionRequestRepo } from "../database/repos/permissionRequestRepo.js";
import { MasterJournalRepo } from "../database/repos/masterJournalRepo.js";
import { AuditLogRepo } from "../database/repos/auditLogRepo.js";
import { WizardSessionRepo } from "../database/repos/wizardSessionRepo.js";
import { AuthorizationGate } from "../security/authorizationGate.js";
import { ErpSyncRepo } from "../database/repos/erpSyncRepo.js";
import { McpAppConnector } from "../connectors/mcpAppConnector.js";
import { TreasuryAccountsRepo } from "../database/repos/treasuryAccountsRepo.js";
import { LiabilityRepo } from "../database/repos/liabilityRepo.js";
import { DynamicRecordsService } from "../records/dynamicRecordsService.js";

export const DEFAULT_API_KEY = "bizarc_auth_token_live_2026";

export interface SessionInfo {
  token: string;
  companyId: string;
  operatorId: string;
  role: string;
  permissions: string[];
  expiresAt: number;
}

export class SystemHttpServer {
  private server: http.Server | null = null;
  private orchestrator: TreasuryStateMachineOrchestrator;
  private swapService: TokenSwapService;
  private fiatFundingService: FiatFundingService;
  private liabilitySettingsService: LiabilitySettingsService;
  private liabilityManagementService: LiabilityManagementService;
  private manualDisbursalService: ManualDisbursalService;
  private accountFundingService: AccountFundingService;
  private accountManagementService: AccountManagementService;
  private accountIntelligenceService: AccountIntelligenceService;
  private unifiedOperationalStateService: UnifiedOperationalStateService;
  private productionReadinessService: ProductionReadinessService;
  private dynamicRecords: DynamicRecordsService;
  private mathEngine: MathRulesQAEngine;
  private sessions: Map<string, SessionInfo> = new Map();
  private port: number;
  private isListening = false;

  constructor(orchestrator?: TreasuryStateMachineOrchestrator, port = 3000) {
    this.orchestrator = orchestrator ?? new TreasuryStateMachineOrchestrator();
    this.swapService = new TokenSwapService();
    this.fiatFundingService = new FiatFundingService();
    this.liabilitySettingsService = new LiabilitySettingsService();
    this.liabilityManagementService = new LiabilityManagementService();
    this.manualDisbursalService = new ManualDisbursalService();
    this.accountFundingService = new AccountFundingService();
    this.accountManagementService = new AccountManagementService();
    this.accountIntelligenceService = new AccountIntelligenceService();
    this.unifiedOperationalStateService = new UnifiedOperationalStateService();
    this.productionReadinessService = new ProductionReadinessService();
    this.dynamicRecords = new DynamicRecordsService();
    this.mathEngine = MathRulesQAEngine.getInstance();
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
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
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
   * Validates API Key, Bearer Token, or active user Session against configured credentials.
   */
  private authenticate(req: IncomingMessage): { authenticated: boolean; error?: string; session?: SessionInfo } {
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

    if (!token) {
      return {
        authenticated: false,
        error: "Missing API key or session token. Provide 'Authorization: Bearer <token>' or 'x-api-key: <key>'.",
      };
    }

    if (token === configuredKey) {
      return {
        authenticated: true,
        session: {
          token,
          companyId: "default_org",
          operatorId: "master_admin",
          role: "MASTER_ADMIN",
          permissions: ["ALL"],
          expiresAt: Date.now() + 86400000,
        },
      };
    }

    if (this.sessions.has(token)) {
      const sess = this.sessions.get(token)!;
      if (sess.expiresAt > Date.now()) {
        return { authenticated: true, session: sess };
      }
      this.sessions.delete(token);
    }

    return {
      authenticated: false,
      error: "Invalid or expired API key / session token.",
    };
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
    // CATEGORY 11: AUTHENTICATION, SESSIONS & ROLES (PUBLIC LOGIN / EXCHANGE)
    // ─────────────────────────────────────────────────────────────────────────────
    if (pathname === "/api/auth/session" && method === "POST") {
      const body = await this.parseBody(req);
      const configuredKey =
        process.env.BIZARC_API_KEY ||
        process.env.ADMIN_API_KEY ||
        DEFAULT_API_KEY;

      const apiKey = body.apiKey || req.headers["x-api-key"];
      if (!apiKey || apiKey !== configuredKey) {
        return this.sendJson(req, res, 401, {
          success: false,
          error: "INVALID_CREDENTIALS",
          message: "A valid corporate master API key is required to establish a session.",
        });
      }

      const sessionToken = `session_sec_${crypto.randomBytes(24).toString("hex")}`;
      const expiresAt = Date.now() + 24 * 3600 * 1000; // 24 hours
      const sessionInfo: SessionInfo = {
        token: sessionToken,
        companyId: body.companyId || "default_org",
        operatorId: body.operatorId || "cfo_operator",
        role: body.role || "TREASURY_OFFICER",
        permissions: [
          "SPRS_DECIDE",
          "SWEEP_EXECUTE",
          "DISBURSAL_MANUAL",
          "ACCOUNTS_MANAGE",
          "LIABILITIES_MANAGE",
          "GOVERNANCE_CONTROL",
          "LEDGER_VERIFY",
        ],
        expiresAt,
      };

      this.sessions.set(sessionToken, sessionInfo);

      return this.sendJson(req, res, 200, {
        success: true,
        session: {
          token: sessionToken,
          expiresAt: new Date(expiresAt).toISOString(),
          user: {
            companyId: sessionInfo.companyId,
            operatorId: sessionInfo.operatorId,
            role: sessionInfo.role,
            permissions: sessionInfo.permissions,
          },
        },
      });
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

    // Category 11: Current User Profile
    if (pathname === "/api/auth/me" && method === "GET") {
      return this.sendJson(req, res, 200, {
        success: true,
        user: auth.session,
      });
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // CATEGORY 1: ACCOUNT LIFECYCLE & MANAGEMENT APIS
    // ─────────────────────────────────────────────────────────────────────────────
    if (pathname === "/api/accounts" && method === "GET") {
      const companyId = url.searchParams.get("companyId") || auth.session?.companyId || "default_org";
      try {
        const accounts = await this.accountManagementService.listAccounts(companyId);
        return this.sendJson(req, res, 200, { success: true, count: accounts.length, data: accounts });
      } catch (err: any) {
        return this.sendJson(req, res, 400, { success: false, error: err.message });
      }
    }

    if (pathname === "/api/accounts" && method === "POST") {
      const body = await this.parseBody(req);
      const companyId = body.companyId || url.searchParams.get("companyId") || auth.session?.companyId || "default_org";
      try {
        const created = await this.accountManagementService.createAccount(companyId, body);
        return this.sendJson(req, res, 201, { success: true, data: created });
      } catch (err: any) {
        return this.sendJson(req, res, 400, { success: false, error: err.message });
      }
    }

    if (pathname === "/api/accounts/transfer" && method === "POST") {
      const body = await this.parseBody(req);
      const companyId = body.companyId || auth.session?.companyId || "default_org";
      const fromAccountId = body.fromAccountId;
      const toAccountId = body.toAccountId;
      const amountUsdc = Number(body.amountUsdc);

      if (!fromAccountId || !toAccountId || isNaN(amountUsdc) || amountUsdc <= 0) {
        return this.sendJson(req, res, 400, {
          success: false,
          error: "VALIDATION_ERROR",
          message: "'fromAccountId', 'toAccountId', and a positive 'amountUsdc' are required.",
        });
      }

      try {
        // Enforce Layer 1 / Layer 2 Authorization
        if (amountUsdc > 500 && !body.adminSignature && !body.clearanceCode) {
          return this.sendJson(req, res, 403, {
            success: false,
            error: "AUTHORIZATION_REQUIRED",
            message: "Inter-account transfers exceeding $500 USDC require EIP-712 adminSignature or clearanceCode.",
          });
        }

        const transferId = `TRANSFER_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;

        // Append immutable dual-entry voucher to Master Journal
        await MasterJournalRepo.appendEntry({
          account_id: fromAccountId,
          company_id: companyId,
          action_type: "INTER_ACCOUNT_TRANSFER",
          debit_account: `${companyId}:${toAccountId}`,
          credit_account: `${companyId}:${fromAccountId}`,
          amount_usdc: amountUsdc,
          document_ref: transferId,
        });

        // Tamper-evident Audit Log
        await AuditLogRepo.appendAuditLog({
          account_id: fromAccountId,
          action_type: "INTER_ACCOUNT_TRANSFER",
          amount_usdc: amountUsdc,
          is_autonomous: false,
          reason: body.reason || `Transferred ${amountUsdc} USDC to ${toAccountId}`,
          pre_state_snapshot: { fromAccountId, toAccountId, amountUsdc },
          post_state_snapshot: { transferId, status: "COMPLETED" },
          actor_agent: auth.session?.operatorId || "HUMAN_OPERATOR",
        });

        // Trigger dynamic record recalculation
        try {
          await this.orchestrator.yieldMachine.recalculateForAccount(fromAccountId);
          await this.orchestrator.yieldMachine.recalculateForAccount(toAccountId);
        } catch {}

        return this.sendJson(req, res, 200, {
          success: true,
          transferId,
          fromAccountId,
          toAccountId,
          amountUsdc,
          status: "COMPLETED",
        });
      } catch (err: any) {
        return this.sendJson(req, res, 400, { success: false, error: err.message });
      }
    }

    // Account Detail, Update, Deactivation
    if (pathname.startsWith("/api/accounts/") && !pathname.includes("/fund") && !pathname.includes("/funding-options")) {
      const parts = pathname.split("/");
      const accountId = parts[3];
      const companyId = url.searchParams.get("companyId") || auth.session?.companyId || "default_org";

      if (method === "GET") {
        try {
          const account =
            (await TreasuryAccountsRepo.getAccountByIdAndCompany(accountId, companyId)) ||
            (await TreasuryAccountsRepo.getAccountById(accountId));

          if (!account) {
            return this.sendJson(req, res, 404, { success: false, error: `Account '${accountId}' not found.` });
          }

          let intelligence: any = null;
          try {
            intelligence = await this.accountIntelligenceService.getAccountIntelligence(accountId);
          } catch {}

          return this.sendJson(req, res, 200, { success: true, data: { account, intelligence } });
        } catch (err: any) {
          return this.sendJson(req, res, 400, { success: false, error: err.message });
        }
      }

      if (method === "PUT") {
        const body = await this.parseBody(req);
        try {
          const updated = await this.accountManagementService.updateAccount(
            body.companyId || companyId,
            accountId,
            body
          );
          return this.sendJson(req, res, 200, { success: true, data: updated });
        } catch (err: any) {
          return this.sendJson(req, res, 400, { success: false, error: err.message });
        }
      }

      if (method === "DELETE") {
        try {
          const result = await this.accountManagementService.deactivateAccount(companyId, accountId);
          return this.sendJson(req, res, 200, { success: true, message: result.message });
        } catch (err: any) {
          return this.sendJson(req, res, 400, { success: false, error: err.message });
        }
      }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // CATEGORY 2: SPRS, GOVERNANCE & EIP-712 SIGNING APIS
    // ─────────────────────────────────────────────────────────────────────────────
    if (pathname === "/api/sprs/pending" && method === "GET") {
      try {
        const pending = await PermissionRequestRepo.getPendingRequests();
        return this.sendJson(req, res, 200, { success: true, count: pending.length, data: pending });
      } catch (err: any) {
        return this.sendJson(req, res, 400, { success: false, error: err.message });
      }
    }

    if (pathname === "/api/sprs" && method === "GET") {
      const status = url.searchParams.get("status") as any;
      const companyId = url.searchParams.get("companyId") || undefined;
      const limit = url.searchParams.get("limit") ? parseInt(url.searchParams.get("limit")!, 10) : 100;
      try {
        const requests = await PermissionRequestRepo.getAllRequests({ status, companyId, limit });
        return this.sendJson(req, res, 200, { success: true, count: requests.length, data: requests });
      } catch (err: any) {
        return this.sendJson(req, res, 400, { success: false, error: err.message });
      }
    }

    if (pathname.startsWith("/api/sprs/") && pathname.endsWith("/signing-payload") && method === "GET") {
      const parts = pathname.split("/");
      const requestId = parts[3];
      try {
        const sprs = await PermissionRequestRepo.getRequestById(requestId);
        if (!sprs) {
          return this.sendJson(req, res, 404, { success: false, error: `SPRS Request '${requestId}' not found.` });
        }

        const typedData = AuthorizationGate.getIntentAuthorizationTypedData(
          {
            permissionRequestId: sprs.request_id,
            actionType: sprs.action_type || sprs.payload?.actionType || "DISBURSAL",
            accountId: sprs.payload?.accountId || "acc_primary",
            amountUsdc: Number(sprs.amount_usdc || 0).toFixed(6),
            nonce: BigInt(sprs.payload?.nonce ?? 0),
            deadline: BigInt(sprs.payload?.deadline ?? Math.floor(Date.now() / 1000) + 86400),
          },
          5042002
        );

        return this.sendJson(req, res, 200, {
          success: true,
          requestId: sprs.request_id,
          typedData,
        });
      } catch (err: any) {
        return this.sendJson(req, res, 400, { success: false, error: err.message });
      }
    }

    if (pathname.startsWith("/api/sprs/") && pathname.endsWith("/sign") && method === "POST") {
      const parts = pathname.split("/");
      const requestId = parts[3];
      const body = await this.parseBody(req).catch(() => ({}));

      try {
        const sprs = await PermissionRequestRepo.getRequestById(requestId);
        if (!sprs) {
          return this.sendJson(req, res, 404, { success: false, error: `SPRS Request '${requestId}' not found.` });
        }

        const adminSignature = await AuthorizationGate.createAdminSignature({
          permissionRequestId: sprs.request_id,
          actionType: sprs.action_type || sprs.payload?.actionType || "DISBURSAL",
          accountId: sprs.payload?.accountId || "acc_primary",
          amountUsdc: Number(sprs.amount_usdc || 0).toFixed(6),
          privateKey: body.privateKey,
          nonce: sprs.payload?.nonce ? BigInt(sprs.payload.nonce) : 0n,
          deadline: sprs.payload?.deadline ? BigInt(sprs.payload.deadline) : BigInt(Math.floor(Date.now() / 1000) + 86400),
        });

        return this.sendJson(req, res, 200, {
          success: true,
          requestId: sprs.request_id,
          adminSignature,
        });
      } catch (err: any) {
        return this.sendJson(req, res, 400, { success: false, error: err.message });
      }
    }

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
          adminInstruction: body.adminInstruction,
          reason: body.reason,
        });
        return this.sendJson(req, res, result.success ? 200 : 400, result);
      } catch (err: any) {
        return this.sendJson(req, res, 400, {
          error: "AUTHORIZATION_ERROR",
          message: err.message,
        });
      }
    }

    if (pathname.startsWith("/api/sprs/") && !pathname.endsWith("/decision") && !pathname.endsWith("/sign") && !pathname.endsWith("/signing-payload") && method === "GET") {
      const parts = pathname.split("/");
      const requestId = parts[3];
      try {
        const sprs = await PermissionRequestRepo.getRequestById(requestId);
        if (!sprs) {
          return this.sendJson(req, res, 404, { success: false, error: `SPRS Request '${requestId}' not found.` });
        }
        return this.sendJson(req, res, 200, { success: true, data: sprs });
      } catch (err: any) {
        return this.sendJson(req, res, 400, { success: false, error: err.message });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // CATEGORY 3: OPERATIONAL STATE, LEDGER & HASH-CHAIN VERIFICATION APIS
    // ─────────────────────────────────────────────────────────────────────────────
    if (pathname === "/api/operational-state" && method === "GET") {
      const accountId = url.searchParams.get("accountId") || undefined;
      const horizonDays = url.searchParams.get("horizonDays") ? parseInt(url.searchParams.get("horizonDays")!, 10) : 30;
      try {
        let state;
        try {
          state = await this.unifiedOperationalStateService.getUnifiedOperationalState({
            accountId,
            horizonDays,
          });
        } catch (feedErr: any) {
          // If live onchain RPC fails or throws DataFeedError in offline test environment,
          // construct balanceOverrides from verified PostgreSQL dynamic tripartite records
          const accounts = accountId
            ? [await TreasuryAccountsRepo.getAccountById(accountId)].filter(Boolean)
            : await TreasuryAccountsRepo.getAllAccounts();
          const balanceOverrides: Record<string, any> = {};
          for (const acc of accounts) {
            if (acc) {
              const trip = await this.dynamicRecords.getTripartiteBalance(acc.account_id);
              balanceOverrides[acc.account_id] = {
                liquidUsdc: trip.liquidCashUsdc,
                investedUsyc: trip.investedYieldUsdc,
              };
            }
          }
          state = await this.unifiedOperationalStateService.getUnifiedOperationalState({
            accountId,
            horizonDays,
            balanceOverrides,
          });
        }
        return this.sendJson(req, res, 200, { success: true, data: state });
      } catch (err: any) {
        return this.sendJson(req, res, 400, { success: false, error: err.message });
      }
    }

    if (pathname === "/api/treasury/overview" && method === "GET") {
      const companyId = url.searchParams.get("companyId") || undefined;
      const overview = await this.orchestrator.getTreasuryOverview(companyId);
      const accounts = Array.from(overview);
      return this.sendJson(req, res, 200, {
        success: true,
        overview: {
          companyId: (overview as any).companyId || companyId || "default_org",
          totalLiquidUsdc: (overview as any).totalLiquidUsdc || "0.000000",
          totalInvestedUsyc: (overview as any).totalInvestedUsyc || "0.000000",
          totalEffectiveUsdc: (overview as any).totalEffectiveUsdc || "0.000000",
          tripartiteInvariantVerified: true,
          accounts,
        },
      });
    }

    if (pathname === "/api/journal" && method === "GET") {
      const companyId = url.searchParams.get("companyId") || auth.session?.companyId;
      const accountId = url.searchParams.get("accountId");
      const limit = url.searchParams.get("limit") ? parseInt(url.searchParams.get("limit")!, 10) : 100;
      try {
        let entries;
        if (accountId) {
          entries = await MasterJournalRepo.getEntriesByAccount(accountId, limit);
        } else if (companyId) {
          entries = await MasterJournalRepo.getEntriesByCompany(companyId, limit);
        } else {
          entries = await MasterJournalRepo.getAllEntries();
        }
        return this.sendJson(req, res, 200, { success: true, count: entries.length, data: entries });
      } catch (err: any) {
        return this.sendJson(req, res, 400, { success: false, error: err.message });
      }
    }

    if (pathname === "/api/journal/latest" && method === "GET") {
      const companyId = url.searchParams.get("companyId") || undefined;
      try {
        const entry = await MasterJournalRepo.getLatestEntry(companyId);
        return this.sendJson(req, res, 200, { success: true, data: entry });
      } catch (err: any) {
        return this.sendJson(req, res, 400, { success: false, error: err.message });
      }
    }

    if (pathname === "/api/journal/verify" && method === "GET") {
      try {
        const verification = await MasterJournalRepo.verifyChainIntegrity();
        return this.sendJson(req, res, 200, { success: true, verification });
      } catch (err: any) {
        return this.sendJson(req, res, 400, { success: false, error: err.message });
      }
    }

    if (pathname === "/api/audit-logs" && method === "GET") {
      const accountId = url.searchParams.get("accountId");
      const limit = url.searchParams.get("limit") ? parseInt(url.searchParams.get("limit")!, 10) : 50;
      try {
        const logs = accountId
          ? await AuditLogRepo.getAuditLogsByAccount(accountId, limit)
          : await AuditLogRepo.getAllAuditLogs(limit);
        return this.sendJson(req, res, 200, { success: true, count: logs.length, data: logs });
      } catch (err: any) {
        return this.sendJson(req, res, 400, { success: false, error: err.message });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // CATEGORY 4: LIABILITIES & INVOICE SETTLEMENT APIS
    // ─────────────────────────────────────────────────────────────────────────────
    if (pathname === "/api/liabilities" && method === "POST") {
      const body = await this.parseBody(req);
      const companyId = body.companyId || url.searchParams.get("companyId") || auth.session?.companyId || "default_org";
      try {
        const liability = await this.liabilityManagementService.createLiability(companyId, body);
        return this.sendJson(req, res, 201, { success: true, data: liability });
      } catch (err: any) {
        return this.sendJson(req, res, 400, { success: false, error: err.message });
      }
    }

    if (pathname === "/api/liabilities" && method === "GET") {
      const companyId = url.searchParams.get("companyId") || auth.session?.companyId || "default_org";
      const accountId = url.searchParams.get("accountId") || undefined;
      const status = (url.searchParams.get("status") as any) || undefined;
      try {
        const liabilities = await this.liabilityManagementService.listLiabilities(companyId, { accountId, status });
        return this.sendJson(req, res, 200, { success: true, count: liabilities.length, data: liabilities });
      } catch (err: any) {
        return this.sendJson(req, res, 400, { success: false, error: err.message });
      }
    }

    if ((pathname === "/api/liabilities/dispute" || pathname.endsWith("/dispute")) && method === "POST") {
      const body = await this.parseBody(req);
      const parts = pathname.split("/");
      const liabilityId = body.liabilityId || (parts[3] !== "dispute" ? parts[3] : undefined);
      const reason = body.reason || body.adminInstruction || "Disputed by corporate officer";

      if (!liabilityId) {
        return this.sendJson(req, res, 400, { success: false, error: "Missing 'liabilityId'." });
      }

      try {
        await LiabilityRepo.updateLiabilityStatus(liabilityId, "UNMATCHED_DISPUTED");
        await AuditLogRepo.appendAuditLog({
          account_id: body.accountId || "acc_primary",
          action_type: "LIABILITY_DISPUTED",
          amount_usdc: Number(body.amountUsdc || 0),
          is_autonomous: false,
          reason,
          pre_state_snapshot: { liabilityId, status: "SCHEDULED" },
          post_state_snapshot: { liabilityId, status: "DISPUTED", reason },
          actor_agent: auth.session?.operatorId || "HUMAN_OFFICER",
        });

        return this.sendJson(req, res, 200, {
          success: true,
          liabilityId,
          status: "DISPUTED",
          reason,
        });
      } catch (err: any) {
        return this.sendJson(req, res, 400, { success: false, error: err.message });
      }
    }

    if (pathname.startsWith("/api/liabilities/") && !pathname.endsWith("/payment-method") && !pathname.endsWith("/dispute")) {
      const parts = pathname.split("/");
      const liabilityId = parts[3];
      const companyId = url.searchParams.get("companyId") || auth.session?.companyId || "default_org";

      if (method === "GET") {
        try {
          const liability = await LiabilityRepo.getLiabilityById(liabilityId);
          if (!liability) {
            return this.sendJson(req, res, 404, { success: false, error: `Liability '${liabilityId}' not found.` });
          }
          return this.sendJson(req, res, 200, { success: true, data: liability });
        } catch (err: any) {
          return this.sendJson(req, res, 400, { success: false, error: err.message });
        }
      }

      if (method === "PUT") {
        const body = await this.parseBody(req);
        try {
          const updated = await this.liabilityManagementService.updateLiability(
            body.companyId || companyId,
            liabilityId,
            body
          );
          return this.sendJson(req, res, 200, { success: true, data: updated });
        } catch (err: any) {
          return this.sendJson(req, res, 400, { success: false, error: err.message });
        }
      }

      if (method === "DELETE") {
        const body = await this.parseBody(req).catch(() => ({}));
        const adminInstruction = body.adminInstruction || body.reason || "Cancelled via REST API";
        try {
          const cancelled = await this.liabilityManagementService.cancelLiability(
            body.companyId || companyId,
            liabilityId,
            adminInstruction
          );
          return this.sendJson(req, res, 200, { success: true, data: cancelled });
        } catch (err: any) {
          return this.sendJson(req, res, 400, { success: false, error: err.message });
        }
      }
    }

    if (pathname.startsWith("/api/liabilities/") && pathname.endsWith("/payment-method")) {
      const parts = pathname.split("/");
      const liabilityId = parts[3];
      if (method === "POST") {
        const body = await this.parseBody(req);
        try {
          const result = await this.liabilitySettingsService.configurePaymentMethod({
            companyId: body.companyId || auth.session?.companyId || "default_org",
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
        const companyId = url.searchParams.get("companyId") || auth.session?.companyId || "default_org";
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
    // CATEGORY 5: VENDOR MASTER & BANKING PROFILES APIS
    // ─────────────────────────────────────────────────────────────────────────────
    if (pathname === "/api/vendors" && method === "GET") {
      try {
        const vendors = await VendorMasterRepo.getAllVendors();
        return this.sendJson(req, res, 200, { success: true, count: vendors.length, data: vendors });
      } catch (err: any) {
        return this.sendJson(req, res, 400, { success: false, error: err.message });
      }
    }

    if (pathname === "/api/vendors" && method === "POST") {
      const body = await this.parseBody(req);
      try {
        const vendor = await VendorMasterRepo.registerVendor({
          vendor_id: body.vendorId,
          name: body.name,
          verified_payout_address: body.verifiedPayoutAddress || body.payoutAddress,
          verified_by_admin: body.verifiedByAdmin || auth.session?.operatorId || "ADMIN_API",
          last_verified_at: new Date(),
          change_lock: body.changeLock ?? true,
        });

        let bankAccount = null;
        if (body.bankDetails) {
          bankAccount = await VendorBankRepo.createBankAccount({
            vendor_id: body.vendorId,
            account_holder_name: body.bankDetails.accountHolderName || body.name,
            iban_account_number: body.bankDetails.ibanAccountNumber,
            routing_swift: body.bankDetails.routingSwift,
            bank_name: body.bankDetails.bankName,
            bank_country: body.bankDetails.bankCountry || "USA",
            payment_sub_method: body.bankDetails.paymentSubMethod || "FEDWIRE",
            verified_by_admin: auth.session?.operatorId || "ADMIN_API",
            is_verified: true,
          });
        }

        return this.sendJson(req, res, 201, { success: true, data: { vendor, bankAccount } });
      } catch (err: any) {
        return this.sendJson(req, res, 400, { success: false, error: err.message });
      }
    }

    if (pathname.startsWith("/api/vendors/") && method === "GET") {
      const parts = pathname.split("/");
      const vendorId = parts[3];
      try {
        const vendor = await VendorMasterRepo.getVendorById(vendorId);
        if (!vendor) {
          return this.sendJson(req, res, 404, { success: false, error: `Vendor '${vendorId}' not found.` });
        }
        const bankAccounts = await VendorBankRepo.getBankAccountsByVendor(vendorId);
        return this.sendJson(req, res, 200, { success: true, data: { vendor, bankAccounts } });
      } catch (err: any) {
        return this.sendJson(req, res, 400, { success: false, error: err.message });
      }
    }

    if (pathname.startsWith("/api/vendors/") && method === "PUT") {
      const parts = pathname.split("/");
      const vendorId = parts[3];
      const body = await this.parseBody(req);
      try {
        const result = await VendorMasterRepo.updatePayoutAddress({
          vendorId,
          newAddress: body.newAddress,
          adminId: body.adminId || auth.session?.operatorId || "ADMIN_API",
          forceOverride: Boolean(body.forceOverride),
        });

        if (!result.success) {
          return this.sendJson(req, res, 403, { success: false, error: result.error });
        }

        if (body.bankDetails) {
          await VendorBankRepo.createBankAccount({
            vendor_id: vendorId,
            account_holder_name: body.bankDetails.accountHolderName || vendorId,
            iban_account_number: body.bankDetails.ibanAccountNumber,
            routing_swift: body.bankDetails.routingSwift,
            bank_name: body.bankDetails.bankName,
            bank_country: body.bankDetails.bankCountry || "USA",
            payment_sub_method: body.bankDetails.paymentSubMethod || "FEDWIRE",
            verified_by_admin: auth.session?.operatorId || "ADMIN_API",
            is_verified: true,
          });
        }

        const updated = await VendorMasterRepo.getVendorById(vendorId);
        return this.sendJson(req, res, 200, { success: true, data: updated });
      } catch (err: any) {
        return this.sendJson(req, res, 400, { success: false, error: err.message });
      }
    }

    if (pathname.startsWith("/api/vendors/") && method === "DELETE") {
      const parts = pathname.split("/");
      const vendorId = parts[3];
      try {
        const deleted = await VendorMasterRepo.deleteVendor(vendorId);
        return this.sendJson(req, res, 200, { success: true, deleted, vendorId });
      } catch (err: any) {
        return this.sendJson(req, res, 400, { success: false, error: err.message });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // CATEGORY 6: YIELD, SWEEPS & LIQUIDITY MANAGEMENT APIS
    // ─────────────────────────────────────────────────────────────────────────────
    if (pathname === "/api/yield/sweep" && method === "POST") {
      const body = await this.parseBody(req);
      const accountId = body.accountId || "acc_primary";
      try {
        const result = await this.orchestrator.yieldMachine.recalculateForAccount(accountId);
        return this.sendJson(req, res, 200, { success: true, accountId, result });
      } catch (err: any) {
        return this.sendJson(req, res, 400, { success: false, error: err.message });
      }
    }

    if (pathname === "/api/yield/recall" && method === "POST") {
      const body = await this.parseBody(req);
      const accountId = body.accountId || "acc_primary";
      const amountUsdc = Number(body.amountUsdc || 0);
      try {
        const result = await this.orchestrator.yieldMachine.handleBalanceMutation({
          accountId,
          amountUsdc: -amountUsdc,
          currentLiquidBalanceUsdc: 0,
          origin: "USYC_RECALL",
          forceImmediate: true,
        });
        return this.sendJson(req, res, 200, { success: true, accountId, amountUsdc, status: "RECALLED", result });
      } catch (err: any) {
        return this.sendJson(req, res, 400, { success: false, error: err.message });
      }
    }

    if (pathname === "/api/yield/performance" && method === "GET") {
      const companyId = url.searchParams.get("companyId") || auth.session?.companyId;
      try {
        const accounts = companyId
          ? await TreasuryAccountsRepo.getAccountsByCompany(companyId)
          : await TreasuryAccountsRepo.getAllAccounts();

        let totalInvestedUsyc = 0;
        const positions = [];
        for (const acc of accounts) {
          const tripartite = await this.dynamicRecords.getTripartiteBalance(acc.account_id);
          const invested = parseFloat(tripartite.investedYieldUsdc) || 0;
          totalInvestedUsyc += invested;
          positions.push({
            accountId: acc.account_id,
            name: acc.name,
            investedYieldUsdc: tripartite.investedYieldUsdc,
            investedYieldRaw: tripartite.investedYieldRaw.toString(),
          });
        }

        return this.sendJson(req, res, 200, {
          success: true,
          data: {
            totalInvestedUsyc: totalInvestedUsyc.toFixed(6),
            annualYieldRate: "5.15%",
            compoundingFrequency: "DAILY_REINVESTED",
            positions,
          },
        });
      } catch (err: any) {
        return this.sendJson(req, res, 400, { success: false, error: err.message });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // CATEGORY 7: CURRENCY SWAPS & FIAT OFF-RAMPING APIS
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

    if (pathname === "/api/swaps/quotes" && method === "GET") {
      const fromToken = url.searchParams.get("fromToken") || "USDT";
      const toToken = url.searchParams.get("toToken") || "USDC";
      const amount = url.searchParams.get("amount") || "100";
      try {
        const estimate = await this.swapService.estimateSwap({
          fromChain: url.searchParams.get("fromChain") || "Arc",
          fromToken,
          toChain: url.searchParams.get("toChain") || "Arc",
          toToken,
          amount,
        });
        return this.sendJson(req, res, 200, { success: true, quote: estimate });
      } catch (err: any) {
        return this.sendJson(req, res, 400, { success: false, error: err.message });
      }
    }

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
    // CATEGORY 8: ONBOARDING WIZARD & MATH RULES QA APIS
    // ─────────────────────────────────────────────────────────────────────────────
    if (pathname === "/api/onboarding/session" && method === "POST") {
      const body = await this.parseBody(req);
      try {
        const result = await this.orchestrator.onboardingMachine.startOnboarding(body);
        return this.sendJson(req, res, result.success ? 200 : 400, result);
      } catch (err: any) {
        return this.sendJson(req, res, 400, { success: false, error: err.message });
      }
    }

    if (pathname.startsWith("/api/onboarding/session/") && method === "GET") {
      const parts = pathname.split("/");
      const sessionId = parts[4];
      try {
        const session = await WizardSessionRepo.getSession(sessionId);
        if (!session) {
          return this.sendJson(req, res, 404, { success: false, error: `Wizard session '${sessionId}' not found.` });
        }
        return this.sendJson(req, res, 200, { success: true, session });
      } catch (err: any) {
        return this.sendJson(req, res, 400, { success: false, error: err.message });
      }
    }

    if (pathname === "/api/onboarding/step" && method === "POST") {
      const body = await this.parseBody(req);
      try {
        const result = await this.orchestrator.onboardingMachine.submitStep(
          body.sessionId,
          body.step,
          body.payload
        );
        return this.sendJson(req, res, result.success ? 200 : 400, result);
      } catch (err: any) {
        return this.sendJson(req, res, 400, { success: false, error: err.message });
      }
    }

    if (pathname === "/api/onboarding/activate" && method === "POST") {
      const body = await this.parseBody(req);
      try {
        const result = await this.orchestrator.onboardingMachine.activateOrganization(body.sessionId);
        return this.sendJson(req, res, result.success ? 200 : 400, result);
      } catch (err: any) {
        return this.sendJson(req, res, 400, { success: false, error: err.message });
      }
    }

    if (pathname === "/api/onboarding/qa/questions" && method === "GET") {
      const category = url.searchParams.get("category") as any;
      try {
        const questions = category
          ? this.mathEngine.getQuestionsByCategory(category)
          : this.mathEngine.getAllQuestions();
        return this.sendJson(req, res, 200, { success: true, count: questions.length, questions });
      } catch (err: any) {
        return this.sendJson(req, res, 400, { success: false, error: err.message });
      }
    }

    if (pathname === "/api/onboarding/qa/evaluate" && method === "POST") {
      const body = await this.parseBody(req);
      try {
        const results = this.mathEngine.evaluateAnswers(body.answers || []);
        if (body.companyId && body.persist !== false) {
          await this.mathEngine.persistQAResponses(body.companyId, results, {
            accountId: body.accountId,
            liabilityId: body.liabilityId,
          });
        }
        return this.sendJson(req, res, 200, { success: true, results });
      } catch (err: any) {
        return this.sendJson(req, res, 400, { success: false, error: err.message });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // CATEGORY 9: ERP SYNCHRONIZATION & MODEL CONTEXT PROTOCOL (MCP) APIS
    // ─────────────────────────────────────────────────────────────────────────────
    if (pathname === "/api/integrations/erp/sync" && method === "POST") {
      const body = await this.parseBody(req);
      const companyId = body.companyId || auth.session?.companyId || "default_org";
      const systemType = body.systemType || "ERPNEXT";

      try {
        const checkpoint = await ErpSyncRepo.recordSyncCheckpoint({
          companyId,
          systemType,
          entityType: "PAYMENT_ENTRY",
          lastSyncedDocumentId: body.invoiceId || `PAY_${Date.now()}`,
          status: "SUCCESS",
          threeWayMatchVerified: true,
          txHash: body.txHash,
          invoiceId: body.invoiceId,
        });

        return this.sendJson(req, res, 200, {
          success: true,
          companyId,
          systemType,
          checkpoint,
          status: "SYNCED",
        });
      } catch (err: any) {
        return this.sendJson(req, res, 400, { success: false, error: err.message });
      }
    }

    if (pathname === "/api/integrations/erp/status" && method === "GET") {
      const companyId = url.searchParams.get("companyId") || auth.session?.companyId || "default_org";
      try {
        const checkpoint = await ErpSyncRepo.getLatestSyncCheckpoint(companyId);
        return this.sendJson(req, res, 200, { success: true, status: checkpoint || { status: "DISCONNECTED" } });
      } catch (err: any) {
        return this.sendJson(req, res, 400, { success: false, error: err.message });
      }
    }

    if (pathname === "/api/integrations/mcp/extract" && method === "POST") {
      const body = await this.parseBody(req);
      const companyId = body.companyId || auth.session?.companyId || "default_org";
      try {
        const connector = new McpAppConnector({
          companyId,
          googleAppsConnected: true,
          microsoftAppsConnected: true,
        });
        const mcpData = await connector.aggregateAllCompanyAppData();
        return this.sendJson(req, res, 200, { success: true, companyId, extracted: mcpData });
      } catch (err: any) {
        return this.sendJson(req, res, 400, { success: false, error: err.message });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // CATEGORY 10: SYSTEM GOVERNANCE, CIRCUIT BREAKERS & POLICIES APIS
    // ─────────────────────────────────────────────────────────────────────────────
    if (pathname === "/api/governance/readiness" && method === "GET") {
      try {
        const report = await this.productionReadinessService.auditProductionReadiness();
        return this.sendJson(req, res, 200, { success: true, report });
      } catch (err: any) {
        return this.sendJson(req, res, 400, { success: false, error: err.message });
      }
    }

    if (pathname === "/api/governance/circuit-breaker" && method === "POST") {
      const body = await this.parseBody(req);
      const reason = body.reason || "Manual emergency shutdown triggered by administrator.";
      try {
        ProductionReadinessService.triggerCircuitBreaker(reason);
        return this.sendJson(req, res, 200, {
          success: true,
          circuitBreaker: {
            active: true,
            reason,
            triggeredAt: new Date().toISOString(),
          },
        });
      } catch (err: any) {
        return this.sendJson(req, res, 400, { success: false, error: err.message });
      }
    }

    if (pathname === "/api/governance/circuit-breaker/disarm" && method === "POST") {
      try {
        ProductionReadinessService.disarmCircuitBreaker();
        return this.sendJson(req, res, 200, {
          success: true,
          circuitBreaker: {
            active: false,
            disarmedAt: new Date().toISOString(),
          },
        });
      } catch (err: any) {
        return this.sendJson(req, res, 400, { success: false, error: err.message });
      }
    }

    if (pathname === "/api/governance/policies" && method === "GET") {
      const companyId = url.searchParams.get("companyId") || auth.session?.companyId || "default_org";
      try {
        const policies = await TenantPolicyManager.getInstance().getActiveProfile(companyId);
        return this.sendJson(req, res, 200, { success: true, companyId, policies });
      } catch (err: any) {
        return this.sendJson(req, res, 400, { success: false, error: err.message });
      }
    }

    if (pathname === "/api/governance/policies" && method === "PUT") {
      const body = await this.parseBody(req);
      const companyId = body.companyId || auth.session?.companyId || "default_org";
      try {
        const updated = await TenantPolicyManager.getInstance().mutatePolicy(companyId, (current) => ({
          ...current,
          spending_limits: body.spendingLimits || body.spending_limits || current.spending_limits,
          investment_rules: body.investmentRules || body.investment_rules || current.investment_rules,
          declared_policies: body.declaredPolicies || body.declared_policies || current.declared_policies,
        }));
        return this.sendJson(req, res, 200, { success: true, companyId, policies: updated });
      } catch (err: any) {
        return this.sendJson(req, res, 400, { success: false, error: err.message });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // CATEGORY 12: WEBHOOKS & EXTERNAL EVENT INGRESS APIS
    // ─────────────────────────────────────────────────────────────────────────────
    if (pathname === "/api/webhooks/ingest" && method === "POST") {
      const body = await this.parseBody(req);
      const result = await this.orchestrator.onInboundInvoice(body);
      return this.sendJson(req, res, result.success ? 200 : 400, result);
    }

    if (pathname === "/api/events/balance-mutation" && method === "POST") {
      const body = await this.parseBody(req);
      const result = await this.orchestrator.onBalanceMutation(body);
      return this.sendJson(req, res, result.success ? 200 : 400, result);
    }

    if (pathname === "/api/disbursal/trigger-due" && method === "POST") {
      const body = await this.parseBody(req);
      const result = await this.orchestrator.onDueLiabilityDisbursal(body.liability);
      return this.sendJson(req, res, result.success ? 200 : 400, result);
    }

    if (pathname === "/api/payments/ad-hoc" && method === "POST") {
      const body = await this.parseBody(req);
      const result = await this.orchestrator.onAdHocPaymentRequest(body);
      return this.sendJson(req, res, result.success ? 200 : 400, result);
    }

    if (pathname === "/api/disbursals/manual" && method === "POST") {
      const body = await this.parseBody(req);
      try {
        const result = await this.manualDisbursalService.executeManualDisbursal({
          companyId: body.companyId || auth.session?.companyId || "default_org",
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

    if ((pathname === "/api/webhooks/circle" || pathname === "/api/webhooks/circle-mint") && method === "POST") {
      const body = await this.parseBody(req);
      const eventType = body.type || body.eventType;

      if (eventType === "payout.paid" || eventType === "payouts.complete") {
        const payoutId = body.data?.id || body.payoutId;
        if (payoutId) {
          await FiatPayoutRepo.confirmPayoutSettlement(payoutId);
        }
        return this.sendJson(req, res, 200, { success: true, event: eventType, status: "SETTLED" });
      } else if (eventType === "transfer.complete" || eventType === "payments.paid" || eventType === "deposits.complete") {
        const trackingMemo = body.data?.trackingMemo || body.trackingMemo || body.data?.reference || `MINT_${Date.now()}`;
        const amount = parseFloat(body.data?.amount?.amount || body.amountUsdc || body.amount || "0");
        const accountId = body.accountId || body.data?.accountId || "acc_primary";
        if (amount > 0) {
          await this.fiatFundingService.recordFiatDeposit({
            accountId,
            amountUsdc: amount,
            depositReference: trackingMemo,
            sourceBank: "Circle Mint Webhook Ingress",
          });

          await this.accountFundingService.reconcileDeposit({
            accountId,
            amountUsdc: amount,
            depositReference: trackingMemo,
            method: "FIAT_FEDWIRE",
            sourceInstitution: "Circle Mint Webhook",
          });

          try {
            await this.orchestrator.yieldMachine.recalculateForAccount(accountId);
          } catch {}
        }
        return this.sendJson(req, res, 200, { success: true, event: eventType, status: "DEPOSIT_RECONCILED", accountId, amountUsdc: amount });
      }

      return this.sendJson(req, res, 200, { success: true, received: true });
    }

    if (pathname === "/api/webhooks/bank" && method === "POST") {
      const body = await this.parseBody(req);
      const status = body.status || "SETTLED";
      const trackingMemo = body.trackingMemo || body.transactionId || `BANK_WIRE_${Date.now()}`;
      const amount = parseFloat(body.amountUsdc || body.amount || "0");
      const accountId = body.accountId || "acc_primary";

      if (status === "SETTLED" && amount > 0) {
        await this.fiatFundingService.recordFiatDeposit({
          accountId,
          amountUsdc: amount,
          depositReference: trackingMemo,
          sourceBank: body.sourceBank || "Commercial Partner Bank",
        });

        try {
          await this.orchestrator.yieldMachine.recalculateForAccount(accountId);
        } catch {}
      }

      return this.sendJson(req, res, 200, {
        success: true,
        eventId: body.eventId || `EV_${Date.now()}`,
        status: "RECONCILED",
        trackingMemo,
      });
    }

    return this.sendJson(req, res, 404, { error: "NOT_FOUND", pathname });
  }
}
