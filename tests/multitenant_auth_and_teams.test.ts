import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { SystemHttpServer, DEFAULT_API_KEY } from "../src/ingress/systemHttpServer.js";
import { TreasuryStateMachineOrchestrator } from "../src/orchestration/treasuryStateMachineOrchestrator.js";
import { TreasuryAccountsRepo } from "../src/database/repos/treasuryAccountsRepo.js";
import { TenantRepo } from "../database/repos/tenantRepo.js";
import { UserRepo } from "../database/repos/userRepo.js";
import { TenantMembershipRepo } from "../database/repos/tenantMembershipRepo.js";

test("Multi-Tenant Enterprise IAM, Teams, RBAC & Isolation Test Suite", async (t) => {
  const orchestrator = new TreasuryStateMachineOrchestrator();
  const server = new SystemHttpServer(orchestrator, 0);
  const port = await server.start();
  const baseUrl = `http://localhost:${port}`;

  async function apiRequest(path: string, options: { method?: string; body?: any; token?: string; apiKey?: string } = {}) {
    const method = options.method || "GET";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (options.token) {
      headers["Authorization"] = `Bearer ${options.token}`;
    } else if (options.apiKey !== undefined) {
      if (options.apiKey) headers["x-api-key"] = options.apiKey;
    }

    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }

  const testRunId = Date.now().toString(36);
  const ownerEmail = `founder_${testRunId}@acmecorp.com`;
  const ownerPassword = "PasswordSecure2026!";
  const cfoEmail = `cfo_${testRunId}@acmecorp.com`;
  const auditorEmail = `auditor_${testRunId}@eycompliance.com`;

  let ownerToken = "";
  let cfoToken = "";
  let auditorToken = "";
  let primaryTenantId = "";
  let secondaryTenantId = "";
  let cfoUserId = "";
  let auditorUserId = "";
  let rawTenantApiKey = "";
  let createdApiKeyId = "";

  try {
    // ─────────────────────────────────────────────────────────────────────────────
    // 1. SIGN-UP FLOW: User + Primary Tenant + OWNER Membership
    // ─────────────────────────────────────────────────────────────────────────────
    await t.test("1. Sign-Up: Provisions User, Tenant, and OWNER Role", async () => {
      const res = await apiRequest("/api/v1/auth/signup", {
        method: "POST",
        body: {
          email: ownerEmail,
          password: ownerPassword,
          fullName: "Alice Founder",
          companyName: `Acme Global ${testRunId}`,
          country: "US",
        },
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.data.success, true);
      assert.ok(res.data.sessionToken.startsWith("session_user_"));
      assert.strictEqual(res.data.user.email, ownerEmail);
      assert.strictEqual(res.data.role, "OWNER");
      assert.ok(res.data.permissions.includes("TENANT_MANAGE"));
      assert.ok(res.data.permissions.includes("TEAM_MANAGE"));
      assert.ok(res.data.permissions.includes("SPRS_SIGN"));

      ownerToken = res.data.sessionToken;
      primaryTenantId = res.data.tenant.tenant_id;
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // 2. LOGIN FLOW: Password Verification & Error Handling
    // ─────────────────────────────────────────────────────────────────────────────
    await t.test("2. Login: Verifies Credentials & Rejects Bad Passwords", async () => {
      // 2a. Bad password rejected with 401
      const badRes = await apiRequest("/api/v1/auth/login", {
        method: "POST",
        body: { email: ownerEmail, password: "WrongPassword999!" },
      });
      assert.strictEqual(badRes.status, 401);
      assert.strictEqual(badRes.data.success, false);

      // 2b. Valid login succeeds and returns fresh session
      const goodRes = await apiRequest("/api/v1/auth/login", {
        method: "POST",
        body: { email: ownerEmail, password: ownerPassword },
      });
      assert.strictEqual(goodRes.status, 200);
      assert.strictEqual(goodRes.data.success, true);
      assert.strictEqual(goodRes.data.tenant.tenant_id, primaryTenantId);
      assert.strictEqual(goodRes.data.role, "OWNER");
      ownerToken = goodRes.data.sessionToken; // update to fresh token
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // 3. PERSISTENT SESSION RETRIEVAL: GET /api/v1/auth/me
    // ─────────────────────────────────────────────────────────────────────────────
    await t.test("3. Session Retrieval: GET /api/v1/auth/me returns active tenant context", async () => {
      const meRes = await apiRequest("/api/v1/auth/me", { token: ownerToken });
      assert.strictEqual(meRes.status, 200);
      assert.strictEqual(meRes.data.success, true);
      assert.strictEqual(meRes.data.user.email, ownerEmail);
      assert.strictEqual(meRes.data.tenant.tenant_id, primaryTenantId);
      assert.strictEqual(meRes.data.role, "OWNER");
      assert.ok(Array.isArray(meRes.data.availableTenants));
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // 4. TEAM INVITATIONS: Owner Invites CFO and Auditor
    // ─────────────────────────────────────────────────────────────────────────────
    await t.test("4. Team Invitations: Invite & Accept Flow with Role Provisioning", async () => {
      // 4a. Owner invites CFO
      const inviteCfoRes = await apiRequest("/api/v1/teams/invite", {
        method: "POST",
        body: { email: cfoEmail, role: "CFO" },
        token: ownerToken,
      });
      assert.strictEqual(inviteCfoRes.status, 201);
      assert.strictEqual(inviteCfoRes.data.success, true);
      assert.ok(inviteCfoRes.data.inviteToken);
      const cfoInviteToken = inviteCfoRes.data.inviteToken;

      // 4b. Owner invites Auditor
      const inviteAuditorRes = await apiRequest("/api/v1/teams/invite", {
        method: "POST",
        body: { email: auditorEmail, role: "AUDITOR_VIEWER" },
        token: ownerToken,
      });
      assert.strictEqual(inviteAuditorRes.status, 201);
      const auditorInviteToken = inviteAuditorRes.data.inviteToken;

      // 4c. Verify pending invitations list
      const listInvRes = await apiRequest("/api/v1/teams/invitations", { token: ownerToken });
      assert.strictEqual(listInvRes.status, 200);
      assert.ok(listInvRes.data.count >= 2);

      // 4d. CFO accepts invitation and sets password
      const acceptCfoRes = await apiRequest("/api/v1/teams/invitations/accept", {
        method: "POST",
        body: {
          token: cfoInviteToken,
          password: "CfoSecurePassword2026!",
          fullName: "Bob CFO",
        },
      });
      assert.strictEqual(acceptCfoRes.status, 200);
      assert.strictEqual(acceptCfoRes.data.success, true);
      assert.strictEqual(acceptCfoRes.data.role, "CFO");
      assert.strictEqual(acceptCfoRes.data.tenant.tenant_id, primaryTenantId);
      cfoToken = acceptCfoRes.data.sessionToken;
      cfoUserId = acceptCfoRes.data.user.user_id;

      // 4e. Auditor accepts invitation and sets password
      const acceptAuditorRes = await apiRequest("/api/v1/teams/invitations/accept", {
        method: "POST",
        body: {
          token: auditorInviteToken,
          password: "AuditorPassword2026!",
          fullName: "Carol Auditor",
        },
      });
      assert.strictEqual(acceptAuditorRes.status, 200);
      assert.strictEqual(acceptAuditorRes.data.role, "AUDITOR_VIEWER");
      auditorToken = acceptAuditorRes.data.sessionToken;
      auditorUserId = acceptAuditorRes.data.user.user_id;
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // 5. TEAM ROLES & SEGREGATION OF DUTIES: Members, Promotion, and Sole-Owner Protection
    // ─────────────────────────────────────────────────────────────────────────────
    await t.test("5. Team Management: List members, promote/demote, and sole-owner guard", async () => {
      // 5a. List members
      const listMembers = await apiRequest("/api/v1/teams/members", { token: ownerToken });
      assert.strictEqual(listMembers.status, 200);
      assert.strictEqual(listMembers.data.count, 3);

      // 5b. Update CFO role to TREASURY_OFFICER
      const updateRoleRes = await apiRequest(`/api/v1/teams/members/${cfoUserId}/role`, {
        method: "PUT",
        body: { role: "TREASURY_OFFICER" },
        token: ownerToken,
      });
      assert.strictEqual(updateRoleRes.status, 200);
      assert.strictEqual(updateRoleRes.data.membership.role, "TREASURY_OFFICER");

      // Change CFO back to CFO
      await apiRequest(`/api/v1/teams/members/${cfoUserId}/role`, {
        method: "PUT",
        body: { role: "CFO" },
        token: ownerToken,
      });

      // 5c. Prevent demoting sole OWNER
      const myProfile = await apiRequest("/api/v1/auth/me", { token: ownerToken });
      const myUserId = myProfile.data.user.user_id;
      const demoteOwnerRes = await apiRequest(`/api/v1/teams/members/${myUserId}/role`, {
        method: "PUT",
        body: { role: "TREASURY_OFFICER" },
        token: ownerToken,
      });
      assert.strictEqual(demoteOwnerRes.status, 400);
      assert.ok(demoteOwnerRes.data.error.includes("SOLE_OWNER"));
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // 6. MULTI-TENANT WORKSPACES: Tenant Creation & Context Switching
    // ─────────────────────────────────────────────────────────────────────────────
    await t.test("6. Multi-Tenant Workspaces: Create secondary tenant & switch context", async () => {
      // 6a. Owner creates secondary organization (subsidiary)
      const newTenantRes = await apiRequest("/api/v1/tenants", {
        method: "POST",
        body: {
          name: `Acme Logistics ${testRunId}`,
          legalName: `Acme Logistics Subsidiary LLC`,
          country: "US",
        },
        token: ownerToken,
      });
      assert.strictEqual(newTenantRes.status, 201);
      assert.strictEqual(newTenantRes.data.success, true);
      secondaryTenantId = newTenantRes.data.tenant.tenant_id;

      // 6b. Owner lists accessible tenants -> both primary and secondary appear
      const myTenants = await apiRequest("/api/v1/tenants", { token: ownerToken });
      assert.strictEqual(myTenants.status, 200);
      assert.ok(myTenants.data.count >= 2);
      assert.ok(myTenants.data.tenants.some((t: any) => t.tenant_id === primaryTenantId));
      assert.ok(myTenants.data.tenants.some((t: any) => t.tenant_id === secondaryTenantId));

      // 6c. Switch active context to secondary tenant
      const switchRes = await apiRequest("/api/v1/tenants/switch", {
        method: "POST",
        body: { tenantId: secondaryTenantId },
        token: ownerToken,
      });
      assert.strictEqual(switchRes.status, 200);
      assert.strictEqual(switchRes.data.tenant.tenant_id, secondaryTenantId);

      // 6d. GET /api/v1/auth/me reflects active secondary tenant
      const meSecondary = await apiRequest("/api/v1/auth/me", { token: ownerToken });
      assert.strictEqual(meSecondary.data.tenant.tenant_id, secondaryTenantId);

      // Switch back to primary tenant
      await apiRequest("/api/v1/tenants/switch", {
        method: "POST",
        body: { tenantId: primaryTenantId },
        token: ownerToken,
      });
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // 7. MULTI-TENANT ISOLATION: Cross-Tenant Data Access Strictly Forbidden
    // ─────────────────────────────────────────────────────────────────────────────
    await t.test("7. Tenant Isolation: Rejects Cross-Tenant Access with 403 Forbidden", async () => {
      // CFO is only in primaryTenantId. CFO tries to query secondaryTenantId accounts:
      const crossTenantRes = await apiRequest(`/api/accounts?companyId=${secondaryTenantId}`, {
        token: cfoToken,
      });
      assert.strictEqual(crossTenantRes.status, 403);
      assert.strictEqual(crossTenantRes.data.success, false);
      assert.ok(crossTenantRes.data.error.includes("FORBIDDEN_TENANT_ACCESS"));

      // CFO tries to create account in secondaryTenantId:
      const crossPostRes = await apiRequest("/api/accounts", {
        method: "POST",
        body: {
          companyId: secondaryTenantId,
          accountId: `acc_${secondaryTenantId}_hack`,
          name: "Malicious Cross-Tenant Account",
          role: "OPEX_DEV",
        },
        token: cfoToken,
      });
      assert.strictEqual(crossPostRes.status, 403);
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // 8. ROLE-BASED ACCESS CONTROL (RBAC) GUARDS: CFO vs Auditor
    // ─────────────────────────────────────────────────────────────────────────────
    await t.test("8. RBAC Enforcement: Read-only Auditor cannot mutate accounts or liabilities", async () => {
      // 8a. Auditor attempts to create account -> 403 FORBIDDEN
      const auditCreateAcc = await apiRequest("/api/accounts", {
        method: "POST",
        body: {
          accountId: `acc_${primaryTenantId}_auditor_fail`,
          name: "Unauthorized Auditor Account",
          role: "OPEX_DEV",
        },
        token: auditorToken,
      });
      assert.strictEqual(auditCreateAcc.status, 403);
      assert.ok(auditCreateAcc.data.error.includes("Read-only Auditor role"));

      // 8b. Auditor attempts to create liability -> 403 FORBIDDEN
      const auditCreateLiab = await apiRequest("/api/liabilities", {
        method: "POST",
        body: {
          vendorId: "vendor_fail",
          title: "Unauthorized Auditor Invoice",
          amountUsdc: 1000,
        },
        token: auditorToken,
      });
      assert.strictEqual(auditCreateLiab.status, 403);

      // 8c. Auditor CAN read journal entries -> 200 OK
      const journalRes = await apiRequest("/api/journal", { token: auditorToken });
      assert.strictEqual(journalRes.status, 200);
      assert.strictEqual(journalRes.data.success, true);
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // 9. TENANT-SCOPED MACHINE API KEYS: Generate, Authenticate & Revoke
    // ─────────────────────────────────────────────────────────────────────────────
    await t.test("9. Tenant-Scoped API Keys: M2M Authentication & Scoped Access", async () => {
      // 9a. Non-owner cannot create API key
      const unauthKeyRes = await apiRequest("/api/v1/settings/api-keys", {
        method: "POST",
        body: { name: "ERP Integration Key" },
        token: auditorToken,
      });
      assert.strictEqual(unauthKeyRes.status, 403);

      // 9b. Owner generates scoped API key
      const keyGenRes = await apiRequest("/api/v1/settings/api-keys", {
        method: "POST",
        body: {
          name: "ERPNext Production Sync Key",
          scopes: ["read:treasury", "write:liabilities", "read:journal"],
          expiresInDays: 90,
        },
        token: ownerToken,
      });
      assert.strictEqual(keyGenRes.status, 201);
      assert.strictEqual(keyGenRes.data.success, true);
      assert.ok(keyGenRes.data.rawKey.startsWith("biz_live_"));
      rawTenantApiKey = keyGenRes.data.rawKey;
      createdApiKeyId = keyGenRes.data.apiKey.key_id;

      // 9c. Authenticate using the newly issued tenant API key via x-api-key header
      const apiReq = await apiRequest("/api/accounts", {
        apiKey: rawTenantApiKey,
      });
      assert.strictEqual(apiReq.status, 200);
      assert.strictEqual(apiReq.data.success, true);

      // 9d. Owner revokes the API key
      const delKeyRes = await apiRequest(`/api/v1/settings/api-keys/${createdApiKeyId}`, {
        method: "DELETE",
        token: ownerToken,
      });
      assert.strictEqual(delKeyRes.status, 200);
      assert.strictEqual(delKeyRes.data.success, true);

      // 9e. Subsequent request with revoked key fails with 401
      const revokedReq = await apiRequest("/api/accounts", {
        apiKey: rawTenantApiKey,
      });
      assert.strictEqual(revokedReq.status, 401);
    });

    // ─────────────────────────────────────────────────────────────────────────────
    // 10. SESSION TERMINATION: POST /api/v1/auth/logout
    // ─────────────────────────────────────────────────────────────────────────────
    await t.test("10. Logout: Revokes session in database store", async () => {
      const logoutRes = await apiRequest("/api/v1/auth/logout", {
        method: "POST",
        token: cfoToken,
      });
      assert.strictEqual(logoutRes.status, 200);
      assert.strictEqual(logoutRes.data.success, true);

      // Subsequent request with revoked token fails with 401
      const meAfterLogout = await apiRequest("/api/v1/auth/me", { token: cfoToken });
      assert.strictEqual(meAfterLogout.status, 401);
      assert.strictEqual(meAfterLogout.data.error, "UNAUTHORIZED");
    });
  } finally {
    await server.stop();
  }
});
