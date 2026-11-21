import React, { useState } from "react";
import { useTreasury } from "../context/TreasuryContext";
import { Button, Badge, Banner } from "../primitives";
import { formatUsdc, toMicro } from "../money";

export function TopHeader({
  onOpenAddBill,
  onOpenSweepModal,
  onOpenPayVendor,
  onOpenTokenSwap,
  onOpenTenantSwitcher,
}: {
  onOpenAddBill?: () => void;
  onOpenSweepModal?: () => void;
  onOpenPayVendor?: () => void;
  onOpenTokenSwap?: () => void;
  onOpenTenantSwitcher?: () => void;
}) {
  const {
    activeView,
    circuitBreakerTripped,
    circuitBreakerReason,
    resetCircuitBreaker,
    notifications,
    markNotificationRead,
    safeToInvestTotal,
    company,
  } = useTreasury();

  const [showNotifs, setShowNotifs] = useState(false);
  const unreadCount = notifications.filter(n => !n.read).length;

  const viewTitles: Record<string, string> = {
    overview: "Executive Overview & Solvency",
    approvals: "Approvals & Standardized Permission Requests (SPRS)",
    accounts: "Departmental Accounts & Policy Floors",
    bills: "Accounts Payable & Payment Rails",
    vendors: "Vendor Master Registry & ChangeLocks",
    ledger: "Cryptographic Master Journal & System Audit",
    agents: "Autonomous Agent Swarm Monitor",
    integrations: "Connected Apps, ERP Sync & MCP Directory",
    team: "Team Roles & Key Approver Governance",
    "api-keys": "Developer API Keys & Machine Access",
    onboarding: "Setup Wizard & Declarative Policies",
  };

  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 24px",
        backgroundColor: "var(--surface)",
        borderBottom: "1px solid var(--rule)",
        position: "sticky",
        top: 0,
        zIndex: 20,
      }}
    >
      {/* Breadcrumb Trail */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          type="button"
          onClick={onOpenTenantSwitcher}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            color: "var(--ink-3)",
            fontSize: "var(--fs-0)",
            fontWeight: 500,
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
          title="Switch Tenant Organization"
        >
          <span>{company.name}</span>
          <span style={{ fontSize: "0.65rem" }}>▼</span>
        </button>
        <span style={{ color: "var(--rule-strong)", fontSize: "var(--fs-0)" }}>/</span>
        <h2
          style={{
            margin: 0,
            fontSize: "var(--fs-1)",
            fontWeight: 600,
            color: "var(--ink)",
            fontFamily: "var(--font-sans)",
          }}
        >
          {viewTitles[activeView] || activeView}
        </h2>
      </div>

      {/* Action Zone */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {circuitBreakerTripped ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Badge tone="danger">EMERGENCY STOPPED</Badge>
            <Button
              variant="secondary"
              style={{ padding: "4px 10px", fontSize: "0.85rem" }}
              onClick={resetCircuitBreaker}
            >
              Resume Swarm
            </Button>
          </div>
        ) : (
          <>
            {onOpenTokenSwap && (
              <Button
                variant="quiet"
                style={{ fontSize: "0.85rem", padding: "6px 12px" }}
                onClick={onOpenTokenSwap}
              >
                Swap Tokens
              </Button>
            )}

            {toMicro(safeToInvestTotal) > 0n && onOpenSweepModal && (
              <Button
                variant="secondary"
                style={{ fontSize: "0.85rem", padding: "6px 12px" }}
                onClick={onOpenSweepModal}
              >
                Sweep Idle Surplus ({formatUsdc(safeToInvestTotal, { symbol: true })})
              </Button>
            )}

            {onOpenPayVendor && (
              <Button
                variant="secondary"
                style={{ fontSize: "0.85rem", padding: "6px 12px" }}
                onClick={onOpenPayVendor}
              >
                Pay Vendor Now
              </Button>
            )}

            {onOpenAddBill && (
              <Button
                variant="primary"
                style={{ fontSize: "0.85rem", padding: "6px 12px" }}
                onClick={onOpenAddBill}
              >
                + New Bill
              </Button>
            )}
          </>
        )}

        {/* Notifications Trigger */}
        <div style={{ position: "relative" }}>
          <button
            type="button"
            className="bz-btn"
            data-v="quiet"
            style={{ padding: "6px 10px", position: "relative" }}
            onClick={() => setShowNotifs(!showNotifs)}
            aria-label="Open notifications"
          >
            <span>Alerts</span>
            {unreadCount > 0 && (
              <span
                style={{
                  background: "var(--danger)",
                  color: "#fff",
                  borderRadius: 10,
                  fontSize: "0.75rem",
                  padding: "1px 5px",
                  fontWeight: 700,
                }}
              >
                {unreadCount}
              </span>
            )}
          </button>

          {/* Notifications Dropdown Panel */}
          {showNotifs && (
            <div
              style={{
                position: "absolute",
                right: 0,
                top: 42,
                width: 380,
                maxHeight: 460,
                backgroundColor: "var(--surface)",
                border: "1px solid var(--rule-strong)",
                borderRadius: "var(--r-panel)",
                boxShadow: "0 10px 25px rgba(0,0,0,0.15)",
                overflowY: "auto",
                zIndex: 50,
                padding: 12,
                display: "grid",
                gap: 8,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  paddingBottom: 8,
                  borderBottom: "1px solid var(--rule)",
                }}
              >
                <strong>System Alerts & Triggers</strong>
                <span className="bz-faint" style={{ fontSize: "0.8rem" }}>
                  {unreadCount} unread
                </span>
              </div>

              {notifications.map(n => (
                <div
                  key={n.id}
                  onClick={() => markNotificationRead(n.id)}
                  style={{
                    padding: 8,
                    borderRadius: 4,
                    backgroundColor: n.read ? "transparent" : "var(--sunken)",
                    borderLeft: `3px solid var(--${n.tone})`,
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <strong style={{ fontSize: "0.85rem", color: "var(--ink)" }}>{n.title}</strong>
                    <span className="bz-faint" style={{ fontSize: "0.75rem" }}>
                      {new Date(n.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <p style={{ margin: "4px 0 0", fontSize: "0.8rem", color: "var(--ink-2)" }}>{n.body}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
