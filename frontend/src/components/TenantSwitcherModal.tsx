import React, { useState } from "react";
import { useTreasury } from "../context/TreasuryContext";
import { Button, Badge, Panel } from "../primitives";
import { MEMBERSHIPS } from "../fixtures";
import type * as T from "../types";

export function TenantSwitcherModal({ onClose }: { onClose: () => void }) {
  const { company, switchCompany, setActiveView } = useTreasury();
  const [busyCompanyId, setBusyCompanyId] = useState<string | null>(null);

  const handleSelectCompany = async (companyId: string) => {
    setBusyCompanyId(companyId);
    try {
      await switchCompany(companyId);
      onClose();
    } catch (e) {
      console.error("Failed to switch company:", e);
    } finally {
      setBusyCompanyId(null);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0, 0, 0, 0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 520,
          backgroundColor: "var(--surface)",
          border: "1px solid var(--rule-strong)",
          borderRadius: "var(--r-panel)",
          boxShadow: "0 20px 40px rgba(0, 0, 0, 0.2)",
          overflow: "hidden",
        }}
      >
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "16px 20px",
            borderBottom: "1px solid var(--rule)",
          }}
        >
          <div>
            <h3 style={{ margin: 0, font: "600 var(--fs-2) var(--font-figure)" }}>
              Switch Organization & Tenant
            </h3>
            <span className="bz-faint" style={{ fontSize: "0.85rem" }}>
              Multi-Company Sovereign Treasury Context
            </span>
          </div>
          <button
            type="button"
            className="bz-btn"
            data-v="quiet"
            onClick={onClose}
            style={{ padding: "4px 8px" }}
          >
            ✕
          </button>
        </header>

        <div style={{ padding: 20, display: "grid", gap: 12 }}>
          <p className="bz-muted" style={{ margin: "0 0 8px", fontSize: "0.85rem" }}>
            Select an authorized enterprise entity to switch ledger context, active signing keys, and autonomous policy profiles:
          </p>

          <div style={{ display: "grid", gap: 10 }}>
            {MEMBERSHIPS.map((m) => {
              const isActive = company.companyId === m.companyId;
              const isSwitching = busyCompanyId === m.companyId;

              return (
                <div
                  key={m.companyId}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "14px 16px",
                    borderRadius: "var(--r-sm)",
                    border: isActive
                      ? "2px solid var(--ink)"
                      : "1px solid var(--rule)",
                    backgroundColor: isActive
                      ? "var(--surface-muted)"
                      : "var(--paper)",
                    transition: "all 0.15s ease",
                  }}
                >
                  <div style={{ display: "grid", gap: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <strong style={{ fontSize: "0.95rem", color: "var(--ink)" }}>
                        {m.companyName}
                      </strong>
                      {isActive && <Badge tone="gate">Active Entity</Badge>}
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        fontSize: "0.8rem",
                        color: "var(--ink-2)",
                      }}
                    >
                      <span>Role: <strong>{m.role}</strong></span>
                      <span>•</span>
                      <span>Network: {m.network}</span>
                      <span>•</span>
                      <span className="bz-mono bz-faint">{m.companyId}</span>
                    </div>
                  </div>

                  <div>
                    {isActive ? (
                      <span
                        style={{
                          fontSize: "0.85rem",
                          fontWeight: 600,
                          color: "var(--ink-2)",
                          padding: "6px 12px",
                        }}
                      >
                        Current
                      </span>
                    ) : (
                      <Button
                        variant="secondary"
                        loading={isSwitching}
                        onClick={() => handleSelectCompany(m.companyId)}
                        style={{ fontSize: "0.85rem", padding: "6px 14px" }}
                      >
                        Switch
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div
            style={{
              marginTop: 12,
              padding: 14,
              backgroundColor: "var(--surface-muted)",
              borderRadius: "var(--r-sm)",
              border: "1px dashed var(--rule-strong)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div>
              <strong style={{ fontSize: "0.85rem", display: "block" }}>
                Add New Corporate Entity
              </strong>
              <span className="bz-faint" style={{ fontSize: "0.8rem" }}>
                Launch Enterprise Onboarding Wizard for a new legal entity.
              </span>
            </div>
            <Button
              variant="quiet"
              style={{ fontSize: "0.85rem" }}
              onClick={() => {
                onClose();
                setActiveView("onboarding");
              }}
            >
              + Onboard Entity
            </Button>
          </div>
        </div>

        <footer
          style={{
            display: "flex",
            justifyContent: "flex-end",
            padding: "14px 20px",
            borderTop: "1px solid var(--rule)",
            backgroundColor: "var(--surface-muted)",
          }}
        >
          <Button variant="quiet" onClick={onClose}>
            Close
          </Button>
        </footer>
      </div>
    </div>
  );
}
