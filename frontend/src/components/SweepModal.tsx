import React, { useState } from "react";
import { useTreasury } from "../context/TreasuryContext";
import { Button, Field, UsdcInput, Select, Banner } from "../primitives";
import { formatUsdc, isUsdc } from "../money";

export function SweepModal({ onClose }: { onClose: () => void }) {
  const { accounts, sweepExcessLiquidity, recallLiquidity, circuitBreakerTripped } = useTreasury();

  const [mode, setMode] = useState<"SWEEP" | "RECALL">("SWEEP");
  const [accountId, setAccountId] = useState("acc_treasury");
  const [amountUsdc, setAmountUsdc] = useState("25000.000000");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [success, setSuccess] = useState<string>();

  const selectedAccount = accounts.find(a => a.accountId === accountId) || accounts[0];

  const handleExecute = async () => {
    setBusy(true);
    setErr(undefined);
    setSuccess(undefined);

    try {
      if (!isUsdc(amountUsdc) || parseFloat(amountUsdc) <= 0) {
        throw new Error("Enter a valid positive USDC amount with max 6 decimals.");
      }

      if (mode === "SWEEP") {
        await sweepExcessLiquidity(accountId, amountUsdc);
        setSuccess(`Successfully swept ${formatUsdc(amountUsdc, { symbol: true })} into tokenized USYC yield vault!`);
      } else {
        await recallLiquidity(accountId, amountUsdc);
        setSuccess(`Successfully recalled ${formatUsdc(amountUsdc, { symbol: true })} from USYC vault back to liquid cash.`);
      }

      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Operation failed");
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
      onClick={e => {
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
          <h3 style={{ margin: 0, font: "600 var(--fs-2) var(--font-figure)" }}>
            Treasury Sentinel: Yield Sweeps & Recalls
          </h3>
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

        <div style={{ padding: 20, display: "grid", gap: 16 }}>
          {circuitBreakerTripped && (
            <Banner tone="danger" title="Emergency Stop Active">
              Autonomous and manual yield sweeps are currently locked out by the emergency circuit breaker.
            </Banner>
          )}

          {err && <Banner tone="danger" title="Execution Error">{err}</Banner>}
          {success && <Banner tone="auto" title="Success">{success}</Banner>}

          <div style={{ display: "flex", gap: 8, padding: 4, background: "var(--sunken)", borderRadius: 6 }}>
            <button
              type="button"
              className="bz-btn"
              data-v={mode === "SWEEP" ? "primary" : "quiet"}
              style={{ flex: 1, padding: "6px 12px", fontSize: "0.85rem" }}
              onClick={() => {
                setMode("SWEEP");
                setAmountUsdc("25000.000000");
              }}
            >
              Sweep Idle Cash → USYC
            </button>
            <button
              type="button"
              className="bz-btn"
              data-v={mode === "RECALL" ? "primary" : "quiet"}
              style={{ flex: 1, padding: "6px 12px", fontSize: "0.85rem" }}
              onClick={() => {
                setMode("RECALL");
                setAmountUsdc("10000.000000");
              }}
            >
              Recall USYC → Liquid Cash
            </button>
          </div>

          <Field label="Cost Center Account">
            {id => (
              <Select
                id={id}
                value={accountId}
                onChange={setAccountId}
                options={accounts.map(a => ({
                  value: a.accountId,
                  label: `${a.name} (Liquid: ${formatUsdc(a.liquidUsdc)}, USYC: ${formatUsdc(a.investedUsyc)})`,
                }))}
              />
            )}
          </Field>

          <Field
            label={`Amount to ${mode === "SWEEP" ? "Sweep" : "Recall"} in USDC`}
            hint={
              mode === "SWEEP"
                ? `Safe-to-invest surplus in this account: ${formatUsdc(selectedAccount.safeToInvestUsdc, { symbol: true })}`
                : `Currently earning yield in USYC: ${formatUsdc(selectedAccount.investedUsyc, { symbol: true })}`
            }
          >
            {(id, d) => (
              <UsdcInput
                id={id}
                describedBy={d}
                value={amountUsdc}
                onChange={v => setAmountUsdc(v)}
              />
            )}
          </Field>

          <div
            style={{
              padding: 12,
              borderRadius: 6,
              backgroundColor: "var(--sunken)",
              fontSize: "0.85rem",
              display: "grid",
              gap: 4,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="bz-muted">Target Yield Asset:</span>
              <strong>Hashnote USYC (Tokenized US Treasuries)</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="bz-muted">Autonomous Sweep Cap:</span>
              <strong>$25,000.00 per batch</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span className="bz-muted">Current Annualized Yield:</span>
              <strong style={{ color: "var(--auto)" }}>5.12% Net APR</strong>
            </div>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
              paddingTop: 12,
              borderTop: "1px solid var(--rule)",
            }}
          >
            <Button variant="quiet" onClick={onClose}>
              Cancel
            </Button>
            <Button loading={busy} disabled={circuitBreakerTripped} onClick={handleExecute}>
              {mode === "SWEEP" ? "Execute Sweep to USYC" : "Execute Recall from USYC"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
