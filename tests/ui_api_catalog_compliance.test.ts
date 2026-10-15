import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { SystemHttpServer } from "../src/ingress/systemHttpServer.js";
import { AuthorizationGate } from "../src/security/authorizationGate.js";
import { privateKeyToAccount } from "viem/accounts";
import { PermissionRequestRepo } from "../src/database/repos/permissionRequestRepo.js";
import { AuditLogRepo } from "../src/database/repos/auditLogRepo.js";
import { TreasuryAccountsRepo } from "../src/database/repos/treasuryAccountsRepo.js";

function makeRequest(
  port: number,
  path: string,
  method: string,
  body?: any,
  headers: Record<string, string> = {}
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: any; rawBody: string }> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const reqHeaders: Record<string, string> = {
      ...headers,
      ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload).toString() } : {}),
    };

    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: reqHeaders,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          let parsed: any = null;
          try {
            parsed = data ? JSON.parse(data) : null;
          } catch {}
          resolve({ status: res.statusCode || 0, headers: res.headers, body: parsed, rawBody: data });
        });
      }
    );

    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

test("UI API Catalog Compliance & Remediation Test Suite", async (t) => {
  const server = new SystemHttpServer(undefined, 0);
  const port = await server.start();

  t.after(async () => {
    await server.stop();
  });

  let sessionToken = "";
  let activeTenantId = "default_org";
  const testEmail = `ui_tester_${Date.now()}@bizarc.io`;

  await TreasuryAccountsRepo.upsertAccount({
    account_id: "acc_primary",
    company_id: "default_org",
    name: "Primary Operating Account",
    role: "OPERATING",
    wallet_address: "0x1111111111111111111111111111111111111111",
    chain_id: 5042002,
    min_operating_floor_usdc: 5000,
    safety_buffer_ratio: 0.2,
    is_active: true,
  });

  await t.test("1. OPTIONS Preflight: RFC 9110 Compliant 204 with ZERO Body & PATCH Support", async () => {
    const res = await makeRequest(port, "/api/liabilities/lib_test_123", "OPTIONS", undefined, {
      Origin: "http://localhost:5173",
      "Access-Control-Request-Method": "PUT",
    });

    assert.equal(res.status, 204, "OPTIONS must return HTTP 204");
    assert.equal(res.rawBody, "", "HTTP 204 response must have ZERO body per RFC 9110");
    const allowedMethods = res.headers["access-control-allow-methods"] || "";
    assert.ok(allowedMethods.includes("PUT"), "Must allow PUT");
    assert.ok(allowedMethods.includes("PATCH"), "Must allow PATCH");
    assert.ok(allowedMethods.includes("DELETE"), "Must allow DELETE");
  });

  await t.test("2. Enhanced Health Check Probe: /api/health returns operational & breaker state", async () => {
    const res = await makeRequest(port, "/api/health", "GET");
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "HEALTHY");
    assert.ok(typeof res.body.uptime === "number");
    assert.equal(res.body.circuitBreaker?.tripped, false);
    assert.equal(res.body.dependencies?.database, "CONNECTED");
  });

  await t.test("3. System Network & Approvers Info: /api/system/network and /api/approvers", async () => {
    const netRes = await makeRequest(port, "/api/system/network", "GET");
    assert.equal(netRes.status, 200);
    assert.equal(netRes.body.name, "Arc Testnet");
    assert.equal(netRes.body.chainId, 5042002);

    const appRes = await makeRequest(port, "/api/approvers", "GET");
    assert.equal(appRes.status, 200);
    assert.ok(Array.isArray(appRes.body));
    assert.ok(appRes.body.length > 0);
    assert.ok(appRes.body[0].address.startsWith("0x"));
  });

  await t.test("4. Role-Permission Matrix: /api/team/roles", async () => {
    const rolesRes = await makeRequest(port, "/api/team/roles", "GET");
    assert.equal(rolesRes.status, 200);
    assert.ok(Array.isArray(rolesRes.body));
    const ownerRole = rolesRes.body.find((r: any) => r.role === "OWNER");
    assert.ok(ownerRole, "Role matrix must include OWNER");
    const cfoRole = rolesRes.body.find((r: any) => r.role === "CFO");
    assert.ok(cfoRole, "Role matrix must include CFO");
  });

  await t.test("5. Real-Time Push Stream: /api/events SSE handshake", async () => {
    return new Promise<void>((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: "/api/events",
          method: "GET",
          headers: { Accept: "text/event-stream" },
        },
        (res) => {
          assert.equal(res.statusCode, 200);
          assert.equal(res.headers["content-type"], "text/event-stream");
          res.on("data", (chunk) => {
            const str = chunk.toString();
            if (str.includes("Connected to BizArc Realtime Stream")) {
              req.destroy();
              resolve();
            }
          });
        }
      );
      req.on("error", (err) => {
        // Destroying the socket causes an ECONNRESET or socket error which is expected on close
        resolve();
      });
      req.end();
    });
  });

  await t.test("6. UI Route Aliases: /api/auth/signup & /api/auth/signin", async () => {
    const signupRes = await makeRequest(port, "/api/auth/signup", "POST", {
      name: "UI Engineer",
      email: testEmail,
      password: "StrongPassword_2026!",
      companyName: "Acme Treasury Corp",
    });

    assert.equal(signupRes.status, 201);
    assert.equal(signupRes.body.success, true);
    assert.ok(signupRes.body.token);

    const signinRes = await makeRequest(port, "/api/auth/signin", "POST", {
      email: testEmail,
      password: "StrongPassword_2026!",
    });

    assert.equal(signinRes.status, 200);
    assert.equal(signinRes.body.success, true);
    sessionToken = signinRes.body.token;
    assert.ok(sessionToken);

    const sessionRes = await makeRequest(port, "/api/auth/session", "GET", undefined, {
      Authorization: `Bearer ${sessionToken}`,
    });
    assert.equal(sessionRes.status, 200);
    assert.equal(sessionRes.body.success, true);
    assert.equal(sessionRes.body.user.email, testEmail);
    activeTenantId = sessionRes.body.tenant?.tenant_id || sessionRes.body.user?.tenant_id || "default_org";
    assert.ok(activeTenantId);

    await TreasuryAccountsRepo.upsertAccount({
      account_id: "acc_primary",
      company_id: activeTenantId,
      name: "Primary Operating Account",
      role: "OPERATING",
      wallet_address: "0x1111111111111111111111111111111111111111",
      chain_id: 5042002,
      min_operating_floor_usdc: 5000,
      safety_buffer_ratio: 0.2,
      is_active: true,
    });
  });

  await t.test("7. SIWE (Sign-In with Ethereum): Nonce & Signature Verification", async () => {
    // Generate test wallet
    const testApproverPk = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
    const account = privateKeyToAccount(testApproverPk);
    const address = account.address;

    // Step 1: Request SIWE Nonce
    const nonceRes = await makeRequest(port, "/api/auth/wallet/nonce", "POST", { address });
    assert.equal(nonceRes.status, 200);
    assert.ok(nonceRes.body.nonce);
    assert.ok(nonceRes.body.message.includes(nonceRes.body.nonce));

    // Step 2: Sign message using private key
    const signature = await account.signMessage({ message: nonceRes.body.message });

    // Step 3: Verify signature and establish session
    const verifyRes = await makeRequest(port, "/api/auth/wallet/verify", "POST", {
      address,
      signature,
      message: nonceRes.body.message,
    });

    assert.equal(verifyRes.status, 200);
    assert.equal(verifyRes.body.success, true);
    assert.ok(verifyRes.body.session);
    assert.equal(verifyRes.body.role, "CFO");
  });

  await t.test("8. UI Route Aliases: /api/company, /api/team/members, /api/api-keys", async () => {
    // Company Get
    const compRes = await makeRequest(port, "/api/company", "GET", undefined, {
      Authorization: `Bearer ${sessionToken}`,
    });
    assert.equal(compRes.status, 200);
    assert.equal(compRes.body.success, true);
    assert.ok(compRes.body.tenant || compRes.body.company);

    // Team Members List
    const teamRes = await makeRequest(port, "/api/team/members", "GET", undefined, {
      Authorization: `Bearer ${sessionToken}`,
    });
    assert.equal(teamRes.status, 200);
    assert.ok(Array.isArray(teamRes.body.members));

    // Scoped API Keys Create & List
    const keyCreateRes = await makeRequest(port, "/api/api-keys", "POST", { label: "CI/CD Pipeline Key", scopes: ["accounts:read"] }, {
      Authorization: `Bearer ${sessionToken}`,
    });
    assert.equal(keyCreateRes.status, 201);
    assert.ok(keyCreateRes.body.secretKey);
    const keyId = keyCreateRes.body.apiKey.key_id;

    const keyListRes = await makeRequest(port, "/api/api-keys", "GET", undefined, {
      Authorization: `Bearer ${sessionToken}`,
    });
    assert.equal(keyListRes.status, 200);
    assert.ok(keyListRes.body.apiKeys.some((k: any) => k.key_id === keyId));

    // Scoped API Key Delete
    const keyDelRes = await makeRequest(port, `/api/api-keys/${keyId}`, "DELETE", undefined, {
      Authorization: `Bearer ${sessionToken}`,
    });
    assert.equal(keyDelRes.status, 200);
  });

  await t.test("9. Treasury Endpoints: /api/treasury/distribution, /api/treasury/safe-to-invest, /api/treasury/shortfalls", async () => {
    const distRes = await makeRequest(port, "/api/treasury/distribution", "GET", undefined, {
      Authorization: `Bearer ${sessionToken}`,
    });
    assert.equal(distRes.status, 200);
    assert.equal(distRes.body.success, true);

    const safeRes = await makeRequest(port, "/api/treasury/safe-to-invest", "GET", undefined, {
      Authorization: `Bearer ${sessionToken}`,
    });
    assert.equal(safeRes.status, 200);
    assert.equal(safeRes.body.success, true);

    const shortRes = await makeRequest(port, "/api/treasury/shortfalls", "GET", undefined, {
      Authorization: `Bearer ${sessionToken}`,
    });
    assert.equal(shortRes.status, 200);
    assert.equal(shortRes.body.success, true);
  });

  await t.test("10. Notifications Inbox: /api/notifications and /api/notifications/read", async () => {
    const notifRes = await makeRequest(port, "/api/notifications", "GET", undefined, {
      Authorization: `Bearer ${sessionToken}`,
    });
    assert.equal(notifRes.status, 200);
    assert.ok(Array.isArray(notifRes.body.notifications));

    const readRes = await makeRequest(port, "/api/notifications/read", "POST", { all: true }, {
      Authorization: `Bearer ${sessionToken}`,
    });
    assert.equal(readRes.status, 200);
    assert.equal(readRes.body.markedRead, true);
  });

  await t.test("11. Liabilities Pre-flight Alerts & Route Qualification: /api/liabilities/preflight-alerts & /api/disbursals/qualify-route", async () => {
    const alertRes = await makeRequest(port, "/api/liabilities/preflight-alerts", "GET", undefined, {
      Authorization: `Bearer ${sessionToken}`,
    });
    assert.equal(alertRes.status, 200);
    assert.ok(Array.isArray(alertRes.body.data));

    const routeRes = await makeRequest(port, "/api/disbursals/qualify-route", "POST", {
      amountUsdc: "150.000000",
      category: "INFRASTRUCTURE",
    }, {
      Authorization: `Bearer ${sessionToken}`,
    });
    assert.equal(routeRes.status, 200);
    assert.equal(routeRes.body.success, true);
  });

  await t.test("12. Rule 5 Decimal Precision: Strict string validation on /api/accounts/transfer", async () => {
    // Malformed amount (too many decimals or non-numeric) should be rejected
    const badRes = await makeRequest(port, "/api/accounts/transfer", "POST", {
      fromAccountId: "acc_primary",
      toAccountId: "acc_secondary",
      amountUsdc: "100.1234567", // 7 decimals exceeds micro-USDC 6 decimals
    }, {
      Authorization: `Bearer ${sessionToken}`,
    });

    assert.equal(badRes.status, 400);
    assert.ok(badRes.body.error.includes("INVALID_DECIMAL"));
  });

  await t.test("13. Endpoint 1: /api/sprs/:id/typed-data EIP-712 Typed Data Generator", async () => {
    // Create an SPRS permission request fixture
    const sprs = await PermissionRequestRepo.createRequest({
      request_id: `SPRS_TEST_${Date.now()}`,
      company_id: activeTenantId,
      action_type: "DISBURSAL",
      amount_usdc: 5000,
      status: "PENDING",
      risk_level: "HIGH" as any,
      requires_officer_signature: true as any,
      reason: "High value contractor invoice exceeding threshold",
      payload: {
        accountId: "acc_primary",
        actionType: "DISBURSAL",
        nonce: 1,
        deadline: Math.floor(Date.now() / 1000) + 3600,
      },
    });

    const res = await makeRequest(port, `/api/sprs/${sprs.request_id}/typed-data`, "GET", undefined, {
      Authorization: `Bearer ${sessionToken}`,
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.requestId, sprs.request_id);
    assert.ok(res.body.typedData);
    assert.ok(res.body.domain);
    assert.equal(res.body.domain.name, "BizArc Authorization Gate");
    assert.equal(res.body.primaryType, "ActionAuthorization");
    assert.ok(Array.isArray(res.body.types.ActionAuthorization));
    assert.ok(Array.isArray(res.body.signerAllowlist));
    assert.ok(res.body.signerAllowlist.length > 0);
    assert.ok(res.body.signerAllowlist[0].startsWith("0x"));
  });

  await t.test("14. Endpoint 2: /api/treasury/yield/moves Yield Actions & Suppression Reasons Log", async () => {
    // Record sample yield moves in audit log
    await AuditLogRepo.appendAuditLog({
      account_id: "acc_primary",
      company_id: activeTenantId,
      action_type: "AUTONOMOUS_SWEEP",
      amount_usdc: 1500,
      is_autonomous: true,
      reason: "Operational surplus above required reserve; swept to USYC Yield Vault",
      pre_state_snapshot: { liquid: 20000 },
      post_state_snapshot: { liquid: 18500, yield: 1500 },
      actor_agent: "TreasurySentinelService",
    });

    await AuditLogRepo.appendAuditLog({
      account_id: "acc_primary",
      company_id: activeTenantId,
      action_type: "SWEEP_SUPPRESSED",
      amount_usdc: 0,
      is_autonomous: true,
      reason: "Surplus $250 is below hysteresis threshold $500 USDC. Micro-sweep suppressed.",
      pre_state_snapshot: {},
      post_state_snapshot: {},
      actor_agent: "TreasurySentinelService",
    });

    const res = await makeRequest(port, "/api/treasury/yield/moves", "GET", undefined, {
      Authorization: `Bearer ${sessionToken}`,
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.moves));
    assert.ok(res.body.moves.length >= 2);
    assert.ok(res.body.moves.some((m: any) => m.actionType === "AUTONOMOUS_SWEEP"));
    assert.ok(res.body.moves.some((m: any) => m.actionType === "SWEEP_SUPPRESSED"));
    assert.ok(res.body.shields);
    assert.equal(res.body.shields.hysteresisShieldActive, true);
    assert.equal(typeof res.body.shields.minSweepAmountUsdc, "number");
  });

  await t.test("15. Endpoint 3: /api/payments Unified Multi-Rail Payment Ledger", async () => {
    const res = await makeRequest(port, "/api/payments", "GET", undefined, {
      Authorization: `Bearer ${sessionToken}`,
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.ok(Array.isArray(res.body.data));
    assert.ok(res.body.rails);
    assert.ok(res.body.rails.rail1.includes("ARC_L1"));
    assert.ok(res.body.rails.rail2.includes("MODULAR_SESSION_KEYS"));
    assert.ok(res.body.rails.rail3.includes("ERC3009_AUTHORIZATION"));
    assert.ok(res.body.rails.rail4.includes("GATEWAY_X402"));
    assert.ok(res.body.rails.rail5.includes("FIAT_PAYOUT"));

    // Test limit filter
    const limitRes = await makeRequest(port, "/api/payments?limit=5", "GET", undefined, {
      Authorization: `Bearer ${sessionToken}`,
    });
    assert.equal(limitRes.status, 200);
    assert.ok(limitRes.body.data.length <= 5);
  });

  await t.test("16. Endpoint 4: /api/onboarding/discovery Asynchronous Intake Discovery Job", async () => {
    // POST starts async discovery job
    const postRes = await makeRequest(port, "/api/onboarding/discovery", "POST", {}, {
      Authorization: `Bearer ${sessionToken}`,
    });

    assert.equal(postRes.status, 202);
    assert.equal(postRes.body.success, true);
    assert.ok(postRes.body.jobId.startsWith("job_disc_"));
    assert.equal(postRes.body.status, "RUNNING");
    const jobId = postRes.body.jobId;

    // GET checks job status
    const getRes = await makeRequest(port, `/api/onboarding/discovery/${jobId}`, "GET", undefined, {
      Authorization: `Bearer ${sessionToken}`,
    });

    assert.equal(getRes.status, 200);
    assert.equal(getRes.body.success, true);
    assert.equal(getRes.body.jobId, jobId);
    assert.ok(["RUNNING", "COMPLETED", "FAILED"].includes(getRes.body.status));

    // GET /api/onboarding/discovery lists tenant jobs
    const listRes = await makeRequest(port, "/api/onboarding/discovery", "GET", undefined, {
      Authorization: `Bearer ${sessionToken}`,
    });
    assert.equal(listRes.status, 200);
    assert.ok(Array.isArray(listRes.body.jobs));
    assert.ok(listRes.body.jobs.some((j: any) => j.jobId === jobId));
  });

  await t.test("17. Endpoint 5: /api/liability-proposals & Decision Staging & CFO Approval", async () => {
    // 1. Submit AI Intake proposal
    const createRes = await makeRequest(port, "/api/liability-proposals", "POST", {
      actionType: "ADD",
      accountId: "acc_primary",
      vendorId: "vnd_datadog",
      proposedBy: "LiabilityRadarAgent",
      isHumanInitiated: false,
      details: {
        title: "Datadog APM & Logs Subscription",
        category: "SUBSCRIPTION",
        amountUsdc: "175.000000",
        payoutAddress: "0x5555555555555555555555555555555555555555",
        frequencyCron: "0 0 1 * *",
        dueDateIso: new Date(Date.now() + 86400 * 14 * 1000).toISOString(),
        rationale: "Discovered new recurring contract with Datadog",
      },
    }, {
      Authorization: `Bearer ${sessionToken}`,
    });

    assert.equal(createRes.status, 201);
    assert.equal(createRes.body.success, true);
    assert.ok(createRes.body.data.proposal_id.startsWith("PROP_REC_"));
    assert.equal(createRes.body.data.status, "PENDING_HUMAN_APPROVAL");
    const proposalId = createRes.body.data.proposal_id;

    // 2. Query pending proposals
    const listRes = await makeRequest(port, "/api/liability-proposals", "GET", undefined, {
      Authorization: `Bearer ${sessionToken}`,
    });
    assert.equal(listRes.status, 200);
    assert.ok(Array.isArray(listRes.body.data));
    assert.ok(listRes.body.data.some((p: any) => p.proposal_id === proposalId));

    // 3. CFO decides to approve proposal
    const decisionRes = await makeRequest(port, `/api/liability-proposals/${proposalId}/decision`, "POST", {
      decision: "APPROVE",
      adminInstruction: "Ratified and authorized by CFO for observability budget.",
    }, {
      Authorization: `Bearer ${sessionToken}`,
    });

    assert.equal(decisionRes.status, 200);
    assert.equal(decisionRes.body.success, true);
    assert.equal(decisionRes.body.status, "APPROVED");
    assert.equal(decisionRes.body.data.status, "APPROVED");
  });
});
