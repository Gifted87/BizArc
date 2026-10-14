import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { SystemHttpServer } from "../src/ingress/systemHttpServer.js";
import { AuthorizationGate } from "../src/security/authorizationGate.js";
import { privateKeyToAccount } from "viem/accounts";

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
  const testEmail = `ui_tester_${Date.now()}@bizarc.io`;

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
});
