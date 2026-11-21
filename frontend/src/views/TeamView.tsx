import React, { useState } from "react";
import { Panel, Button, Badge, DataTable, CopyChip, Banner, Field, TextInput, Select } from "../primitives";
import { MEMBERS, APPROVERS, DEVICE_SESSIONS } from "../fixtures";
import type * as T from "../types";

export function TeamView() {
  const [members, setMembers] = useState<T.Member[]>(MEMBERS);
  const [approvers] = useState<T.ApproverWallet[]>(APPROVERS);
  const [sessions] = useState<T.DeviceSession[]>(DEVICE_SESSIONS);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<T.Member["role"]>("OPERATOR");
  const [inviteName, setInviteName] = useState("");
  const [bannerMsg, setBannerMsg] = useState<string | null>(null);

  const handleInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail || !inviteName) return;

    const newMember: T.Member = {
      userId: `usr_${Date.now()}`,
      name: inviteName,
      email: inviteEmail,
      role: inviteRole,
      status: "INVITED",
      emailVerified: false,
      mfaEnabled: false,
      lastActiveAt: new Date().toISOString(),
    };

    setMembers([newMember, ...members]);
    setBannerMsg(`Invitation successfully dispatched to ${inviteEmail} as role ${inviteRole}.`);
    setInviteEmail("");
    setInviteName("");
    setShowInviteModal(false);
  };

  const getRoleBadgeTone = (role: string) => {
    switch (role) {
      case "CFO":
      case "ADMIN":
        return "danger";
      case "APPROVER":
        return "gate";
      case "OPERATOR":
        return "liquid";
      default:
        return "neutral";
    }
  };

  return (
    <div style={{ display: "grid", gap: 24 }}>
      {/* Header bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ fontSize: "var(--fs-3)", fontWeight: 700, margin: 0, color: "var(--ink)" }}>
            Team Management & Role-Based Access Control
          </h1>
          <p className="bz-faint" style={{ margin: "4px 0 0", fontSize: "0.9rem" }}>
            Manage organization members, EIP-712 approver signing keys, multi-sig quorum, and active device sessions.
          </p>
        </div>
        <Button variant="primary" onClick={() => setShowInviteModal(true)}>
          + Invite Member
        </Button>
      </div>

      {bannerMsg && (
        <Banner tone="auto">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
            <span>{bannerMsg}</span>
            <Button variant="quiet" onClick={() => setBannerMsg(null)} style={{ padding: "2px 8px" }}>
              Dismiss
            </Button>
          </div>
        </Banner>
      )}

      {/* Members Panel */}
      <Panel
        title="Organization Members"
        action={<Badge tone="neutral">{members.length} Members</Badge>}
      >
        <DataTable
          columns={[
            {
              key: "name",
              header: "Member",
              render: (m: T.Member) => (
                <div>
                  <div style={{ fontWeight: 600, color: "var(--ink)" }}>{m.name}</div>
                  <div className="bz-faint" style={{ fontSize: "0.8rem" }}>{m.email}</div>
                </div>
              ),
            },
            {
              key: "role",
              header: "Role (RBAC)",
              render: (m: T.Member) => <Badge tone={getRoleBadgeTone(m.role)}>{m.role}</Badge>,
            },
            {
              key: "status",
              header: "Status",
              render: (m: T.Member) => (
                <Badge tone={m.status === "ACTIVE" ? "liquid" : m.status === "INVITED" ? "gate" : "danger"}>
                  {m.status}
                </Badge>
              ),
            },
            {
              key: "security",
              header: "Security Verification",
              render: (m: T.Member) => (
                <div style={{ display: "flex", gap: 6, fontSize: "0.75rem" }}>
                  <Badge tone={m.emailVerified ? "liquid" : "neutral"}>
                    {m.emailVerified ? "Email Verified" : "Unverified"}
                  </Badge>
                  <Badge tone={m.mfaEnabled ? "liquid" : "danger"}>
                    {m.mfaEnabled ? "MFA Active" : "No MFA"}
                  </Badge>
                </div>
              ),
            },
            {
              key: "wallet",
              header: "Approver Signing Key",
              render: (m: T.Member) =>
                m.approverWallet ? (
                  <CopyChip text={m.approverWallet} label={m.approverWallet.slice(0, 10) + "..."} />
                ) : (
                  <span className="bz-faint">—</span>
                ),
            },
            {
              key: "lastActive",
              header: "Last Active",
              render: (m: T.Member) => (
                <span className="bz-faint" style={{ fontSize: "0.8rem" }}>
                  {m.lastActiveAt ? new Date(m.lastActiveAt).toLocaleDateString() : "Never"}
                </span>
              ),
            },
          ]}
          rows={members}
          rowKey={(m) => m.userId}
        />
      </Panel>

      {/* Approver Wallets & Multi-Sig Quorum */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        <Panel
          title="Authorized EIP-712 Signers"
          action={<Badge tone="gate">{approvers.length} Keys Configured</Badge>}
        >
          <div style={{ display: "grid", gap: 12 }}>
            <p className="bz-faint" style={{ fontSize: "0.85rem", margin: 0 }}>
              Cryptographic keys authorized to co-sign high-value Standardized Permission Requests (SPRS).
            </p>
            {approvers.map((app) => (
              <div
                key={app.address}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 12px",
                  borderRadius: 6,
                  border: "1px solid var(--rule)",
                  backgroundColor: "var(--sunken)",
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{app.label}</div>
                  <CopyChip text={app.address} label={app.address} />
                </div>
                <div style={{ textAlign: "right" }}>
                  <Badge tone="gate">Weight: {app.weight}</Badge>
                  <Badge tone={app.status === "ACTIVE" ? "auto" : "gate"}>{app.status}</Badge>
                  <div className="bz-faint" style={{ fontSize: "0.75rem", marginTop: 4 }}>
                    Added {new Date(app.addedAt).toLocaleDateString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        {/* Active Device Sessions */}
        <Panel
          title="Active Device Sessions"
          action={<Badge tone="neutral">{sessions.length} Active</Badge>}
        >
          <div style={{ display: "grid", gap: 10 }}>
            {sessions.map((s) => (
              <div
                key={s.sessionId}
                style={{
                  padding: "10px 12px",
                  borderRadius: 6,
                  border: "1px solid var(--rule)",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <div>
                  <div style={{ fontWeight: 600, fontSize: "0.85rem" }}>
                    {s.browser} on {s.os}
                    {s.device}
                  </div>
                  <div className="bz-faint" style={{ fontSize: "0.75rem" }}>
                    IP: {s.ipAddress} · {s.location}
                    IP: {s.ip} · {s.location}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  {s.isCurrent ? <Badge tone="liquid">Current Device</Badge> : <Badge tone="neutral">Active</Badge>}
                  {s.current ? <Badge tone="invested">Current Device</Badge> : <Badge tone="neutral">Active</Badge>}
                  <div className="bz-faint" style={{ fontSize: "0.75rem", marginTop: 4 }}>
                    {new Date(s.lastSeenAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {/* Invite Member Modal */}
      {showInviteModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
          }}
          onClick={() => setShowInviteModal(false)}
        >
          <div
            style={{
              backgroundColor: "var(--surface)",
              borderRadius: "var(--r-panel)",
              padding: 24,
              maxWidth: 480,
              width: "100%",
              boxShadow: "0 20px 40px rgba(0,0,0,0.2)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 16px", fontSize: "var(--fs-2)" }}>Invite New Team Member</h3>
            <form onSubmit={handleInvite} style={{ display: "grid", gap: 16 }}>
              <Field label="Full Name">
                {(id) => (
                  <TextInput
                    id={id}
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                    placeholder="e.g. Sarah Connor"
                    required
                  />
                )}
              </Field>

              <Field label="Corporate Email Address">
                {(id) => (
                  <TextInput
                    id={id}
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="s.connor@halcyon.ai"
                    required
                  />
                )}
              </Field>

              <Field label="Organization Role (RBAC)">
                {(id) => (
                  <Select
                    id={id}
                    value={inviteRole}
                    onChange={(v) => setInviteRole(v as T.Member["role"])}
                    options={[
                      { value: "CFO", label: "CFO / Executive (Full Treasury & SPRS Authority)" },
                      { value: "ADMIN", label: "Admin (Policy, Accounts & Integrations Management)" },
                      { value: "APPROVER", label: "Approver (EIP-712 Multi-Sig Signer)" },
                      { value: "OPERATOR", label: "Operator (Initiate Disbursals & View Accounts)" },
                      { value: "VIEWER", label: "Viewer / Auditor (Read-Only Access)" },
                    ]}
                  />
                )}
              </Field>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 8 }}>
                <Button variant="quiet" onClick={() => setShowInviteModal(false)}>
                  Cancel
                </Button>
                <Button variant="primary" type="submit">
                  Send Invitation
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
