import { UserRepo, SafeUserRecord } from "../database/repos/userRepo.js";
import { TenantRepo, TenantRecord } from "../database/repos/tenantRepo.js";
import {
  TenantMembershipRepo,
  TenantRole,
  TenantMemberDetail,
  TenantMembershipRecord,
} from "../database/repos/tenantMembershipRepo.js";
import {
  TenantInvitationRepo,
  TenantInvitationRecord,
} from "../database/repos/tenantInvitationRepo.js";
import { UserSessionRepo } from "../database/repos/userSessionRepo.js";
import { PasswordHasher } from "../security/passwordHasher.js";

export class TeamService {
  /**
   * List all team members of a tenant with user profiles and assigned roles.
   */
  public static async getMembers(tenantId: string): Promise<TenantMemberDetail[]> {
    return TenantMembershipRepo.listMembers(tenantId);
  }

  /**
   * Creates an invitation to join an organization with a specific role.
   */
  public static async inviteMember(params: {
    tenantId: string;
    invitedByUserId: string;
    email: string;
    role: TenantRole;
  }): Promise<{ invitation: TenantInvitationRecord; inviteToken: string; inviteUrl: string }> {
    const email = params.email.toLowerCase().trim();
    if (!email || !email.includes("@")) {
      throw new Error("INVALID_EMAIL: A valid email address is required.");
    }

    // Check if target user is already a member
    const existingUser = await UserRepo.getUserByEmail(email);
    if (existingUser) {
      const existingMembership = await TenantMembershipRepo.getMembership(params.tenantId, existingUser.user_id);
      if (existingMembership && existingMembership.status === "ACTIVE") {
        throw new Error("USER_ALREADY_MEMBER: User is already an active member of this organization.");
      }
    }

    const tenant = await TenantRepo.getTenantById(params.tenantId);
    if (!tenant) {
      throw new Error("TENANT_NOT_FOUND: Organization does not exist.");
    }

    // Generate random invite token (valid for 7 days)
    const rawToken = PasswordHasher.generateSecureToken("inv", 32);
    const tokenHash = PasswordHasher.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + 7 * 86400 * 1000);

    const invitation = await TenantInvitationRepo.createInvitation({
      tenant_id: params.tenantId,
      email,
      role: params.role,
      invite_token_hash: tokenHash,
      invited_by_user_id: params.invitedByUserId,
      expires_at: expiresAt,
    });

    const inviteUrl = `/invite/accept?token=${rawToken}`;
    return { invitation, inviteToken: rawToken, inviteUrl };
  }

  /**
   * Accepts an invitation:
   * - If user doesn't exist, provisions user account with provided fullName and password
   * - Adds user to tenant with specified role
   * - Marks invitation as accepted
   * - Issues new session token
   */
  public static async acceptInvitation(params: {
    rawToken: string;
    password?: string;
    fullName?: string;
  }): Promise<{
    user: SafeUserRecord;
    tenant: TenantRecord;
    sessionToken: string;
    role: TenantRole;
    permissions: string[];
  }> {
    if (!params.rawToken) {
      throw new Error("TOKEN_REQUIRED: Invite token is required.");
    }

    const tokenHash = PasswordHasher.hashToken(params.rawToken);
    const invitation = await TenantInvitationRepo.getByTokenHash(tokenHash);

    if (!invitation || invitation.status !== "PENDING") {
      throw new Error("INVALID_INVITATION: Invitation is invalid, revoked, or already accepted.");
    }

    if (new Date(invitation.expires_at).getTime() < Date.now()) {
      throw new Error("INVITATION_EXPIRED: Invitation has expired.");
    }

    const tenant = await TenantRepo.getTenantById(invitation.tenant_id);
    if (!tenant || tenant.status === "SUSPENDED") {
      throw new Error("TENANT_UNAVAILABLE: Organization is unavailable.");
    }

    let user = await UserRepo.getUserByEmail(invitation.email);

    if (!user) {
      // New user signup via invite
      if (!params.password || params.password.length < 8) {
        throw new Error("PASSWORD_REQUIRED: A password of at least 8 characters is required for new accounts.");
      }
      if (!params.fullName || params.fullName.trim().length === 0) {
        throw new Error("NAME_REQUIRED: Full name is required for new accounts.");
      }

      const passwordHash = await PasswordHasher.hashPassword(params.password);
      user = await UserRepo.createUser({
        email: invitation.email,
        password_hash: passwordHash,
        full_name: params.fullName.trim(),
        status: "ACTIVE",
      });
    }

    // Add membership
    await TenantMembershipRepo.addMember({
      tenant_id: invitation.tenant_id,
      user_id: user.user_id,
      role: invitation.role,
      status: "ACTIVE",
    });

    // Mark invitation accepted
    await TenantInvitationRepo.acceptInvitation(invitation.invitation_id);

    // Issue session token
    const rawSessionToken = PasswordHasher.generateSecureToken("session_user", 32);
    const sessionTokenHash = PasswordHasher.hashToken(rawSessionToken);
    const expiresAt = new Date(Date.now() + 30 * 86400 * 1000);

    await UserSessionRepo.createSession({
      user_id: user.user_id,
      active_tenant_id: tenant.tenant_id,
      token_hash: sessionTokenHash,
      expires_at: expiresAt,
    });

    const safeUser = UserRepo.toSafeUser(user);
    const permissions = TenantMembershipRepo.getPermissionsForRole(invitation.role);

    return {
      user: safeUser,
      tenant,
      sessionToken: rawSessionToken,
      role: invitation.role,
      permissions,
    };
  }

  /**
   * Promotes or demotes a team member.
   * Enforces that at least 1 OWNER remains.
   */
  public static async updateMemberRole(params: {
    tenantId: string;
    targetUserId: string;
    newRole: TenantRole;
    actorRole: TenantRole;
  }): Promise<TenantMembershipRecord> {
    if (params.actorRole !== "OWNER") {
      throw new Error("FORBIDDEN: Only organization Owners can change member roles.");
    }

    const currentMembership = await TenantMembershipRepo.getMembership(params.tenantId, params.targetUserId);
    if (!currentMembership) {
      throw new Error("MEMBERSHIP_NOT_FOUND: User is not a member of this organization.");
    }

    // If demoting an OWNER, ensure they are not the sole remaining OWNER
    if (currentMembership.role === "OWNER" && params.newRole !== "OWNER") {
      const ownerCount = await TenantMembershipRepo.countOwners(params.tenantId);
      if (ownerCount <= 1) {
        throw new Error("SOLE_OWNER_DEMOTION: Cannot demote the sole remaining Owner of the organization.");
      }
    }

    const updated = await TenantMembershipRepo.updateRole(params.tenantId, params.targetUserId, params.newRole);
    if (!updated) {
      throw new Error("UPDATE_FAILED: Could not update member role.");
    }
    return updated;
  }

  /**
   * Removes a member from an organization.
   * Enforces that the sole remaining OWNER cannot be removed.
   */
  public static async removeMember(params: {
    tenantId: string;
    targetUserId: string;
    actorRole: TenantRole;
  }): Promise<boolean> {
    if (params.actorRole !== "OWNER") {
      throw new Error("FORBIDDEN: Only organization Owners can remove team members.");
    }

    const currentMembership = await TenantMembershipRepo.getMembership(params.tenantId, params.targetUserId);
    if (!currentMembership) {
      throw new Error("MEMBERSHIP_NOT_FOUND: Member does not exist.");
    }

    if (currentMembership.role === "OWNER") {
      const ownerCount = await TenantMembershipRepo.countOwners(params.tenantId);
      if (ownerCount <= 1) {
        throw new Error("SOLE_OWNER_REMOVAL: Cannot remove the sole remaining Owner of the organization.");
      }
    }

    return TenantMembershipRepo.removeMember(params.tenantId, params.targetUserId);
  }

  /**
   * Lists pending invitations for a tenant.
   */
  public static async listPendingInvitations(tenantId: string): Promise<TenantInvitationRecord[]> {
    return TenantInvitationRepo.listPendingForTenant(tenantId);
  }

  /**
   * Revokes a pending invitation.
   */
  public static async revokeInvitation(tenantId: string, invitationId: string, actorRole: TenantRole): Promise<boolean> {
    if (actorRole !== "OWNER") {
      throw new Error("FORBIDDEN: Only organization Owners can revoke invitations.");
    }
    return TenantInvitationRepo.revokeInvitation(invitationId, tenantId);
  }
}
