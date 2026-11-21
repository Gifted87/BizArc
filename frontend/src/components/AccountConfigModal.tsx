import React, { useState } from "react";
import { Button, Field, UsdcInput, Select, Banner, TextInput } from "../primitives";
import { treasuryApi } from "../api/treasuryApi";
import type * as T from "../types";

interface AccountConfigModalProps {
  account?: T.AccountDistribution | null;
  onClose: () => void;
  onSaved: () => void;
}

const ROLE_OPTIONS = [
  { value: "OPEX_DEV", label: "OPEX_DEV — Engineering, Infrastructure & Tooling" },
  { value: "OPEX_GROWTH", label: "OPEX_GROWTH — Marketing, Ad Spend & Growth" },
  { value: "OPEX_LEGAL", label: "OPEX_LEGAL — Legal Retainers & Compliance" },
  { value: "PAYROLL", label: "PAYROLL — Personnel Compensation (Protected Shield)" },
  { value: "TAX_ESCROW", label: "TAX_ESCROW — Estimated Taxes & Regulatory Fees" },
  { value: "TREASURY_RESERVE", label: "TREASURY_RESERVE — Master Corporate Pool" },
];

export function AccountConfigModal({ account, onClose, onSaved }: AccountConfigModalProps) {
  const isEditing = Boolean(account);

  const [accountId, setAccountId] = useState(account?.accountId || "");
  const [name, setName] = useState(account?.name || "");
  const [role, setRole] = useState(account?.role || "OPEX_DEV");
  const [minFloorUsdc, setMinFloorUsdc] = useState(account?.protectedReserveUsdc || "1000.000000");
  const [safetyBufferRatio, setSafetyBufferRatio] = useState("1.20");
  const [perTxCapUsdc, setPerTxCapUsdc] = useState("5000.000000");
  const [dailyCapUsdc, setDailyCapUsdc] = useState("20000.000000");
  const [maxSweepLimit, setMaxSweepLimit] = useState(
    account?.excludeFromWaterfall ? "0.000000" : "50000.000000"
  );
  const [excludeFromWaterfall, setExcludeFromWaterfall] = useState(
    Boolean(account?.excludeFromWaterfall)
  );

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();

  const handleSubmit = async () => {
    setBusy(true);
    setErr(undefined);

    try {
      if (!isEditing && !accountId.trim()) {
        throw new Error("Account ID is required (e.g. acc_ai_compute).");
      }
      if (!name.trim()) {
        throw new Error("Display Name is required.");
      }

      const floor = parseFloat(minFloorUsdc);
      const buffer = parseFloat(safetyBufferRatio);

      if (isNaN(floor) || floor < 0) {
        throw new Error("Minimum floor must be non-negative.");
      }
      if (isNaN(buffer) || buffer < 1.0) {
        throw new Error("Safety buffer ratio must be at least 1.0x.");
      }

      if (isEditing && account) {
        const res = await treasuryApi.updateAccount(account.accountId, {
          minOperatingFloorUsdc: floor,
          safetyBufferRatio: buffer,
          perTxCapUsdc: parseFloat(perTxCapUsdc),
          dailyCapUsdc: parseFloat(dailyCapUsdc),
          maxAutonomousSweepUsdc: parseFloat(maxSweepLimit),
          maxAutonomousSweepLimit: parseFloat(maxSweepLimit),
          excludeFromWaterfall,
        });
        if (!res.success) throw new Error(res.error || "Update failed");
      } else {
        const res = await treasuryApi.createAccount({
          accountId: accountId.trim(),
          name: name.trim(),
          role,
          minOperatingFloorUsdc: floor,
          safetyBufferRatio: buffer,
          perTxCapUsdc: parseFloat(perTxCapUsdc),
          dailyCapUsdc: parseFloat(dailyCapUsdc),
          maxAutonomousSweepUsdc: parseFloat(maxSweepLimit),
          maxAutonomousSweepLimit: parseFloat(maxSweepLimit),
          excludeFromWaterfall,
        });
        if (!res.success) throw new Error(res.error || "Creation failed");
      }

      onSaved();
      onClose();
    } catch (e: any) {
      setErr(e.message || "Failed to save account");
    } finally {
      setBusy(false);
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
          maxWidth: 580,
          backgroundColor: "var(--surface)",
          border: "1px solid var(--rule-strong)",
          borderRadius: "var(--r-panel)",
          boxShadow: "0 20px 40px rgba(0, 0, 0, 0.2)",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
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
            <h2 style={{ margin: 0, fontSize: "1.1rem", fontFamily: "var(--font-serif)" }}>
              {isEditing ? `Configure ${account?.name}` : "Create Operating Account"}
            </h2>
            <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--muted)" }}>
              Configure departmental reserve floors, spending caps, and corporate shields
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: "1.2rem",
              color: "var(--muted)",
            }}
          >
            ✕
          </button>
        </header>

        <div style={{ padding: 20, overflowY: "auto", flex: 1 }}>
          {err && (
            <div style={{ marginBottom: 16 }}>
              <Banner tone="danger" title="Validation Error">
                {err}
              </Banner>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
            <Field label="Account ID" hint={isEditing ? "Immutable" : "e.g. acc_ai_infra"}>
              {(id) => (
                <TextInput
                  id={id}
                  type="text"
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value.toLowerCase().replace(/\s+/g, "_"))}
                  disabled={isEditing}
                  placeholder="acc_cost_center"
                  style={{
                    background: isEditing ? "var(--surface-muted)" : "var(--surface)",
                    fontFamily: "var(--font-mono)",
                  }}
                />
              )}
            </Field>

            <Field label="Display Name">
              {(id) => (
                <TextInput
                  id={id}
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. AI Cloud Infrastructure"
                />
              )}
            </Field>
          </div>

          <Field label="Standard Account Role">
            {(id) => (
              <Select
                id={id}
                value={role}
                onChange={(v) => setRole(v as any)}
                options={ROLE_OPTIONS}
              />
            )}
          </Field>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16, marginBottom: 16 }}>
            <Field label="Minimum Operating Floor (USDC)">
              {(id, d) => (
                <UsdcInput
                  id={id}
                  value={minFloorUsdc}
                  onChange={(v) => setMinFloorUsdc(v)}
                  describedBy={d}
                />
              )}
            </Field>

            <Field label="Safety Buffer Ratio" hint="Multiplier over upcoming liabilities">
              {(id) => (
                <TextInput
                  id={id}
                  type="number"
                  step="0.05"
                  min="1.0"
                  max="3.0"
                  value={safetyBufferRatio}
                  onChange={(e) => setSafetyBufferRatio(e.target.value)}
                />
              )}
            </Field>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
            <Field label="Per-Transaction Cap (USDC)">
              {(id, d) => (
                <UsdcInput
                  id={id}
                  value={perTxCapUsdc}
                  onChange={(v) => setPerTxCapUsdc(v)}
                  describedBy={d}
                />
              )}
            </Field>

            <Field label="Daily Velocity Cap (USDC)">
              {(id, d) => (
                <UsdcInput
                  id={id}
                  value={dailyCapUsdc}
                  onChange={(v) => setDailyCapUsdc(v)}
                  describedBy={d}
                />
              )}
            </Field>
          </div>

          {/* Corporate Shield & Protection Toggles */}
          <div
            style={{
              padding: 16,
              borderRadius: 6,
              backgroundColor: "var(--surface-muted)",
              border: "1px solid var(--rule)",
              marginTop: 8,
            }}
          >
            <h4 style={{ margin: "0 0 8px", fontSize: "0.9rem" }}>Corporate Shielding & Waterfall Rules</h4>

            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, cursor: "pointer", marginBottom: 12 }}>
              <input
                type="checkbox"
                checked={excludeFromWaterfall}
                onChange={(e) => setExcludeFromWaterfall(e.target.checked)}
                style={{ marginTop: 3 }}
              />
              <span style={{ fontSize: "0.85rem" }}>
                <strong>Exclude from Waterfall Drains:</strong> Inviolable shield preventing other corporate accounts from pulling funds from this wallet during shortfalls.
              </span>
            </label>

            <Field label="Max Autonomous Sweep Limit (USDC)" hint="Set to 0.00 to completely block automated USYC sweeps">
              {(id, d) => (
                <UsdcInput
                  id={id}
                  value={maxSweepLimit}
                  onChange={(v) => setMaxSweepLimit(v)}
                  describedBy={d}
                />
              )}
            </Field>
          </div>
        </div>

        <footer
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 12,
            padding: "16px 20px",
            borderTop: "1px solid var(--rule)",
            backgroundColor: "var(--surface-muted)",
          }}
        >
          <Button variant="quiet" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={busy}>
            {busy ? "Saving Account..." : isEditing ? "Save Configuration" : "Create Account"}
          </Button>
        </footer>
      </div>
    </div>
  );
}
