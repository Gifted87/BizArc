import { UserRepo, SafeUserRecord, UserRecord } from "../database/repos/userRepo.js";
import { TenantRepo, TenantRecord } from "../database/repos/tenantRepo.js";
import { TenantMembershipRepo, TenantRole } from "../database/repos/tenantMembershipRepo.js";
import { UserSessionRepo, PopulatedSession } from "../database/repos/userSessionRepo.js";
import { PasswordHasher } from "../security/passwordHasher.js";

export interface SignUpParams {
  email: string;
  password: string;
  fullName: string;
  companyName: string;
  slug?: string;
  country?: string;
}

export interface AuthResponse {
  user: SafeUserRecord;
  tenant: TenantRecord;
  sessionToken: string;
  role: TenantRole;
  permissions: string[];
  availableTenants?: Array<TenantRecord & { role: string }>;
}

export class AuthService {
  /**
   * Complete B2B Sign-Up Flow:
   * 1. Validates inputs
   * 2. Hashes password with scrypt
   * 3. Creates User
   * 4. Provisions primary Tenant
   * 5. Assigns OWNER role in TenantMembership
   * 6. Generates persistent database-backed Session token
   */
  public static async signUp(params: SignUpParams): Promise<AuthResponse> {
    const email = params.email?.toLowerCase().trim();
    if (!email || !email.includes("@")) {
      throw new Error("INVALID_EMAIL: A valid email address is required.");
    }
    if (!params.password || params.password.length < 8) {
      throw new Error("PASSWORD_TOO_SHORT: Password must be at least 8 characters.");
    }
    if (!params.fullName || params.fullName.trim().length === 0) {
      throw new Error("NAME_REQUIRED: Full name is required.");
    }
    if (!params.companyName || params.companyName.trim().length === 0) {
      throw new Error("COMPANY_NAME_REQUIRED: Company name is required.");
    }

    const existingUser = await UserRepo.getUserByEmail(email);
    if (existingUser) {
      throw new Error("EMAIL_ALREADY_EXISTS: An account with this email already exists.");
    }

    // Generate clean unique tenant slug
    const baseSlug = (params.slug || params.companyName)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    
    let slug = baseSlug || "corp";
    const existingSlug = await TenantRepo.getTenantBySlug(slug);
    if (existingSlug) {
      slug = `${slug}-${Math.random().toString(36).substring(2, 6)}`;
    }

    // 1. Hash password securely
    const passwordHash = await PasswordHasher.hashPassword(params.password);

    // 2. Create User
    const user = await UserRepo.createUser({
      email,
      password_hash: passwordHash,
      full_name: params.fullName.trim(),
      status: "ACTIVE",
    });

    // 3. Provision Tenant
    const tenant = await TenantRepo.createTenant({
      slug,
      name: params.companyName.trim(),
      legal_name: params.companyName.trim(),
      country: params.country || "US",
      status: "ACTIVE",
    });

    // 4. Assign OWNER role
    await TenantMembershipRepo.addMember({
      tenant_id: tenant.tenant_id,
      user_id: user.user_id,
      role: "OWNER",
      status: "ACTIVE",
    });

    // 5. Create persistent session (30 days validity)
    const rawSessionToken = PasswordHasher.generateSecureToken("session_user", 32);
    const tokenHash = PasswordHasher.hashToken(rawSessionToken);
    const expiresAt = new Date(Date.now() + 30 * 86400 * 1000);

    await UserSessionRepo.createSession({
      user_id: user.user_id,
      active_tenant_id: tenant.tenant_id,
      token_hash: tokenHash,
      expires_at: expiresAt,
    });

    const safeUser = UserRepo.toSafeUser(user);
    const permissions = TenantMembershipRepo.getPermissionsForRole("OWNER");
    const availableTenants = await TenantRepo.listTenantsForUser(user.user_id);

    return {
      user: safeUser,
      tenant,
      sessionToken: rawSessionToken,
      role: "OWNER",
      permissions,
      availableTenants,
    };
  }

  /**
   * B2B Login Flow:
   * 1. Looks up user by email
   * 2. Verifies password hash
   * 3. Resolves accessible tenant memberships
   * 4. Issues persistent session token bound to default tenant
   */
  public static async login(params: {
    email: string;
    password: string;
    userAgent?: string;
    ipAddress?: string;
  }): Promise<AuthResponse> {
    const email = params.email?.toLowerCase().trim();
    if (!email || !params.password) {
      throw new Error("INVALID_CREDENTIALS: Email and password are required.");
    }

    const user = await UserRepo.getUserByEmail(email);
    if (!user) {
      throw new Error("INVALID_CREDENTIALS: Invalid email or password.");
    }

    if (user.status !== "ACTIVE") {
      throw new Error(`ACCOUNT_DISABLED: User account is ${user.status.toLowerCase()}. Contact support.`);
    }

    const isPasswordValid = await PasswordHasher.verifyPassword(params.password, user.password_hash);
    if (!isPasswordValid) {
      throw new Error("INVALID_CREDENTIALS: Invalid email or password.");
    }

    // Resolve user's accessible tenants
    const availableTenants = await TenantRepo.listTenantsForUser(user.user_id);
    if (availableTenants.length === 0) {
      throw new Error("NO_TENANT_ACCESS: You do not belong to any active organization.");
    }

    // Default to the first available organization (prioritizing OWNER or CFO)
    const activeTenantSummary =
      availableTenants.find((t) => t.role === "OWNER") ||
      availableTenants.find((t) => t.role === "CFO") ||
      availableTenants[0];

    const tenant = await TenantRepo.getTenantById(activeTenantSummary.tenant_id);
    if (!tenant) {
      throw new Error("TENANT_NOT_FOUND: Active organization could not be loaded.");
    }

    const role = activeTenantSummary.role as TenantRole;
    const permissions = TenantMembershipRepo.getPermissionsForRole(role);

    // Create session
    const rawSessionToken = PasswordHasher.generateSecureToken("session_user", 32);
    const tokenHash = PasswordHasher.hashToken(rawSessionToken);
    const expiresAt = new Date(Date.now() + 30 * 86400 * 1000);

    await UserSessionRepo.createSession({
      user_id: user.user_id,
      active_tenant_id: tenant.tenant_id,
      token_hash: tokenHash,
      user_agent: params.userAgent,
      ip_address: params.ipAddress,
      expires_at: expiresAt,
    });

    const safeUser = UserRepo.toSafeUser(user);

    return {
      user: safeUser,
      tenant,
      sessionToken: rawSessionToken,
      role,
      permissions,
      availableTenants,
    };
  }

  /**
   * Validates a session token against the persistent database store.
   */
  public static async validateSession(sessionToken: string): Promise<PopulatedSession | null> {
    if (!sessionToken || sessionToken.length < 16) return null;
    const tokenHash = PasswordHasher.hashToken(sessionToken);
    const populated = await UserSessionRepo.getPopulatedSessionByTokenHash(tokenHash);
    if (populated) {
      // Touch session activity timestamp
      UserSessionRepo.touchSession(populated.session.session_id);
    }
    return populated;
  }

  /**
   * Switches the active workspace on an existing session token.
   */
  public static async switchTenant(
    sessionToken: string,
    targetTenantId: string
  ): Promise<AuthResponse> {
    const currentSession = await this.validateSession(sessionToken);
    if (!currentSession) {
      throw new Error("UNAUTHORIZED: Invalid or expired session.");
    }

    const membership = await TenantMembershipRepo.getMembership(targetTenantId, currentSession.user.user_id);
    if (!membership || membership.status !== "ACTIVE") {
      throw new Error("FORBIDDEN: You do not have access to this organization.");
    }

    const targetTenant = await TenantRepo.getTenantById(targetTenantId);
    if (!targetTenant || targetTenant.status === "SUSPENDED") {
      throw new Error("TENANT_UNAVAILABLE: Organization is inactive or suspended.");
    }

    await UserSessionRepo.updateActiveTenant(currentSession.session.session_id, targetTenantId);

    const availableTenants = await TenantRepo.listTenantsForUser(currentSession.user.user_id);
    const permissions = TenantMembershipRepo.getPermissionsForRole(membership.role);

    return {
      user: currentSession.user,
      tenant: targetTenant,
      sessionToken,
      role: membership.role,
      permissions,
      availableTenants,
    };
  }

  /**
   * Revokes a session token from the database.
   */
  public static async logout(sessionToken: string): Promise<boolean> {
    if (!sessionToken) return false;
    const tokenHash = PasswordHasher.hashToken(sessionToken);
    return UserSessionRepo.revokeSession(tokenHash);
  }
}
