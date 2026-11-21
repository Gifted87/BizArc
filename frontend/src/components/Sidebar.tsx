import React from "react";
import { useTreasury } from "../context/TreasuryContext";
import { Badge, CopyChip } from "../primitives";

export function Sidebar({
  onOpenTenantSwitcher,
  onOpenAuthModal,
}: {
  onOpenTenantSwitcher?: () => void;
  onOpenAuthModal?: () => void;
}) {
  const {
    activeView,
    setActiveView,
    theme,
    toggleTheme,
    pendingSprs,
    liabilities,
    isChainTampered,
    circuitBreakerTripped,
    currentUser,
    company,
  } = useTreasury();

  const overdueCount = liabilities.filter(l => l.isOverdue && l.status !== "SETTLED").length;
  const pendingCount = pendingSprs.length;

  const navItems = [
    { id: "overview", label: "Executive Overview", badge: null },
    {
      id: "approvals",
      label: "Approvals (SPRS)",
      badge: pendingCount > 0 ? { count: pendingCount, tone: "gate" as const } : null,
    },
    { id: "accounts", label: "Department Accounts", badge: null },
    {
      id: "bills",
      label: "Bills & Rails",
      badge: overdueCount > 0 ? { count: overdueCount, tone: "danger" as const } : null,
    },
    { id: "vendors", label: "Vendor Master", badge: null },
    {
      id: "ledger",
      label: "Master Journal & Audit",
      badge: isChainTampered ? { count: "ALERT", tone: "danger" as const } : null,
    },
    { id: "agents", label: "Autonomous Swarm", badge: null },
    { id: "integrations", label: "Apps & MCP", badge: null },
    { id: "team", label: "Team & RBAC", badge: null },
    { id: "api-keys", label: "API Keys", badge: null },
    { id: "onboarding", label: "Setup Wizard", badge: null },
  ];

  return (
    <aside
      style={{
        width: 260,
        backgroundColor: "var(--surface)",
        borderRight: "1px solid var(--rule)",
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        height: "100vh",
        position: "sticky",
        top: 0,
      }}
    >
      {/* Brand Header */}
      <div
        style={{
          padding: "20px 16px 16px",
          borderBottom: "1px solid var(--rule)",
        }}
      >
        <button
          type="button"
          onClick={onOpenTenantSwitcher}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            textAlign: "left",
          }}
          title="Click to switch organization or tenant"
        >
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: 4,
              backgroundColor: "var(--ink)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--paper)",
              fontFamily: "var(--font-figure)",
              fontWeight: 700,
              fontSize: "1rem",
            }}
          >
            {company.name.charAt(0) || "H"}
          </div>
          <span
            style={{
              font: "700 var(--fs-2) var(--font-figure)",
              letterSpacing: "-0.02em",
              color: "var(--ink)",
              flex: 1,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {company.name}
          </span>
          <span style={{ fontSize: "0.7rem", color: "var(--ink-3)" }}>▼</span>
        </button>
        <div
          style={{
            fontSize: "var(--fs-0)",
            color: "var(--ink-3)",
            marginTop: 4,
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <span>{company.jurisdiction}</span>
          <span>·</span>
          <span>Tax: {company.taxId}</span>
        </div>

        {circuitBreakerTripped && (
          <div style={{ marginTop: 8 }}>
            <Badge tone="danger">EMERGENCY STOP ON</Badge>
          </div>
        )}
      </div>

      {/* Navigation Menu */}
      <nav style={{ padding: "12px 8px", flex: 1, overflowY: "auto" }}>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 2 }}>
          {navItems.map(item => {
            const active = activeView === item.id;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setActiveView(item.id)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "9px 12px",
                    borderRadius: "var(--r-ctl)",
                    border: "none",
                    background: active ? "var(--sunken)" : "transparent",
                    color: active ? "var(--ink)" : "var(--ink-2)",
                    fontWeight: active ? 600 : 500,
                    fontSize: "var(--fs-1)",
                    fontFamily: "var(--font-sans)",
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "background 0.12s var(--ease)",
                  }}
                  onMouseEnter={e => {
                    if (!active) e.currentTarget.style.backgroundColor = "var(--paper)";
                  }}
                  onMouseLeave={e => {
                    if (!active) e.currentTarget.style.backgroundColor = "transparent";
                  }}
                >
                  <span style={{ whiteSpace: "nowrap" }}>{item.label}</span>
                  {item.badge && (
                    <Badge tone={item.badge.tone}>
                      {item.badge.count}
                    </Badge>
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        {/* Ledger Invariant Anchor Box */}
        <div
          style={{
            margin: "24px 4px 8px",
            padding: 12,
            borderRadius: "var(--r-ctl)",
            border: "1px solid var(--rule)",
            backgroundColor: "var(--paper)",
            fontSize: "var(--fs-0)",
          }}
        >
          <strong style={{ display: "block", color: "var(--ink)", marginBottom: 2 }}>
            Solvency Invariant
          </strong>
          <div style={{ color: "var(--ink-2)", fontVariantNumeric: "tabular-nums" }}>
            B_E = B_L + B_Y
          </div>
          <div
            style={{
              marginTop: 6,
              display: "flex",
              alignItems: "center",
              gap: 4,
              color: isChainTampered ? "var(--danger)" : "var(--auto)",
              fontWeight: 600,
            }}
          >
            <span>{isChainTampered ? "⚠️ Chain Tampered" : "✓ Invariant Verified"}</span>
          </div>
        </div>
      </nav>

      {/* User & Network Footer */}
      <div
        style={{
          padding: "12px 16px",
          borderTop: "1px solid var(--rule)",
          backgroundColor: "var(--surface)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div
            onClick={onOpenAuthModal}
            style={{ cursor: "pointer" }}
            title="Switch user persona or sign with Web3 wallet"
          >
            <div style={{ fontWeight: 600, fontSize: "var(--fs-0)", color: "var(--ink)", display: "flex", alignItems: "center", gap: 4 }}>
              <span>{currentUser.name}</span>
              <span style={{ fontSize: "0.65rem", color: "var(--ink-3)" }}>⇄</span>
            </div>
            <div style={{ fontSize: "var(--fs-0)", color: "var(--ink-3)" }}>
              {currentUser.role} · {company.network}
            </div>
          </div>
          <button
            type="button"
            onClick={toggleTheme}
            className="bz-btn"
            data-v="quiet"
            style={{ padding: "4px 8px", fontSize: "0.8rem" }}
            title={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
          >
            {theme === "light" ? "Dark" : "Light"}
          </button>
        </div>

        {currentUser.approverWallet && (
          <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: "var(--fs-0)" }}>
            <span className="bz-faint">Wallet:</span>
            <CopyChip value={currentUser.approverWallet} label="approver wallet" />
          </div>
        )}
      </div>
    </aside>
  );
}
