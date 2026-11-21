import React, { useState } from "react";
import { useTreasury } from "../context/TreasuryContext";
import { Button, Field, UsdcInput, Select, Banner, TextInput } from "../primitives";
import { formatUsdc, isUsdc } from "../money";
import { treasuryApi } from "../api/treasuryApi";

export function TransferModal({ onClose }: { onClose: () => void }) {
  const { accounts, refreshData } = useTreasury();

  const [fromAccountId, setFromAccountId] = useState(accounts[0]?.accountId || "acc_treasury");
  const [toAccountId, setToAccountId] = useState(accounts[1]?.accountId || "acc_dev");
  const [amountUsdc, setAmountUsdc] = useState("5000.000000");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [success, setSuccess] = useState<string>();

  const sourceAccount = accounts.find((a) => a.accountId === fromAccountId) || accounts[0];
  const targetAccount = accounts.find((a) => a.accountId === toAccountId) || accounts[1];

  const sourceLiquid = parseFloat(sourceAccount?.liquidUsdc || "0");
  const sourceFloor = parseFloat(sourceAccount?.protectedReserveUsdc || "0");
  const transferAmount = parseFloat(amountUsdc || "0");
  const postBalance = sourceLiquid - transferAmount;
  const breachesFloor = postBalance < sourceFloor;

  const handleExecute = async () => {
    setBusy(true);
    setErr(undefined);
    setSuccess(undefined);

    try {
      if (fromAccountId === toAccountId) {
        throw new Error("Source and destination accounts must be different.");
      }
      if (!isUsdc(amountUsdc) || transferAmount <= 0) {
        throw new Error("Enter a valid positive USDC amount with max 6 decimal places (Rule 5).");
      }
      if (transferAmount > sourceLiquid) {
        throw new Error(
          `Insufficient funds: ${sourceAccount?.name} has only ${formatUsdc(sourceAccount?.liquidUsdc || "0", { symbol: true })} available.`
        );
      }

      const res = await treasuryApi.transferFunds({
        fromAccountId,
        toAccountId,
        amountUsdc,
        reason: memo || `Internal reallocation from ${sourceAccount?.name} to ${targetAccount?.name}`,
        memo: memo || `Internal reallocation from ${sourceAccount?.name} to ${targetAccount?.name}`,
      });

      if (!res.success) {
        throw new Error(res.error || "Transfer failed");
      }

      await refreshData();
      setSuccess(`Successfully transferred ${formatUsdc(amountUsdc, { symbol: true })} to ${targetAccount?.name}!`);
      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (e: any) {
      setErr(e.message || "Transfer failed");
    } finally {
      setBusy(false);
    }
  };

  const accountOptions = accounts.map((a) => ({
    value: a.accountId,
    label: `${a.name} (${formatUsdc(a.liquidUsdc, { compact: true })})`,
    label: `${a.name} (${formatUsdc(a.liquidUsdc, { symbol: true })})`,
  }));

  const destinationOptions = accounts
    .filter((a) => a.accountId !== fromAccountId)
    .map((a) => ({
      value: a.accountId,
      label: `${a.name} (${formatUsdc(a.liquidUsdc, { compact: true })})`,
      label: `${a.name} (${formatUsdc(a.liquidUsdc, { symbol: true })})`,
    }));

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
          maxWidth: 540,
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
          <div>
            <h2 style={{ margin: 0, fontSize: "1.1rem", fontFamily: "var(--font-serif)" }}>
              Intra-Account Internal Transfer
            </h2>
            <p style={{ margin: 0, fontSize: "0.8rem", color: "var(--muted)" }}>
              Rule 5 strict 6-decimal USDC precision with double-entry ledger settlement
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

        <div style={{ padding: 20 }}>
          {err && (
            <div style={{ marginBottom: 16 }}>
              <Banner tone="danger" title="Transfer Blocked">
                {err}
              </Banner>
            </div>
          )}

          {success && (
            <div style={{ marginBottom: 16 }}>
              <Banner tone="auto" title="Settled on Arc L1">
                {success}
              </Banner>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
            <Field label="From Source Account">
              {(id) => (
                <Select
                  id={id}
                  value={fromAccountId}
                  onChange={(v) => setFromAccountId(v)}
                  options={accountOptions}
                />
              )}
            </Field>

            <Field label="To Destination Account">
              {(id) => (
                <Select
                  id={id}
                  value={toAccountId}
                  onChange={(v) => setToAccountId(v)}
                  options={destinationOptions}
                />
              )}
            </Field>
          </div>

          <Field
            label="Transfer Amount (USDC)"
            hint="Rule 5: Exact string matching ^\d+(\.\d{1,6})?$"
          >
            {(id, d) => (
              <UsdcInput
                id={id}
                value={amountUsdc}
                onChange={(v) => setAmountUsdc(v)}
                describedBy={d}
              />
            )}
          </Field>

          {/* Quick Amount Chips */}
          <div style={{ display: "flex", gap: 8, marginTop: 8, marginBottom: 16 }}>
            <button
              type="button"
              onClick={() => setAmountUsdc(Math.max(0, sourceLiquid - sourceFloor).toFixed(6))}
              style={{
                fontSize: "0.75rem",
                padding: "2px 8px",
                borderRadius: 4,
                border: "1px solid var(--rule)",
                background: "var(--surface-muted)",
                cursor: "pointer",
              }}
            >
              Max Above Floor ({formatUsdc(Math.max(0, sourceLiquid - sourceFloor).toFixed(6))})
            </button>
            <button
              type="button"
              onClick={() => setAmountUsdc(sourceLiquid.toFixed(6))}
              style={{
                fontSize: "0.75rem",
                padding: "2px 8px",
                borderRadius: 4,
                border: "1px solid var(--rule)",
                background: "var(--surface-muted)",
                cursor: "pointer",
              }}
            >
              Max Liquid ({formatUsdc(sourceLiquid.toFixed(6))})
            </button>
          </div>

          {/* Solvency & Floor Preview */}
          <div
            style={{
              padding: 12,
              borderRadius: 6,
              backgroundColor: breachesFloor ? "rgba(168, 42, 34, 0.08)" : "var(--surface-muted)",
              border: `1px solid ${breachesFloor ? "var(--c-danger)" : "var(--rule)"}`,
              fontSize: "0.85rem",
              marginBottom: 16,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ color: "var(--muted)" }}>Current Source Balance:</span>
              <span style={{ fontFamily: "var(--font-mono)" }}>
                {formatUsdc(sourceAccount?.liquidUsdc || "0", { symbol: true })}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ color: "var(--muted)" }}>Post-Transfer Balance:</span>
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontWeight: 600,
                  color: breachesFloor ? "var(--c-danger)" : "inherit",
                }}
              >
                {formatUsdc(Math.max(0, postBalance).toFixed(6), { symbol: true })}
              </span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--muted)" }}>Configured Minimum Floor:</span>
              <span style={{ fontFamily: "var(--font-mono)" }}>
                {formatUsdc(sourceAccount?.protectedReserveUsdc || "0", { symbol: true })}
              </span>
            </div>
            {breachesFloor && (
              <p style={{ margin: "8px 0 0", color: "var(--c-danger)", fontSize: "0.8rem" }}>
                ⚠️ Warning: This transfer will dip {sourceAccount?.name} below its required operating floor!
              </p>
            )}
          </div>

          <Field label="Business Purpose / Memo (Optional)">
            {(id) => (
              <TextInput
                id={id}
                type="text"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                placeholder="e.g. Q4 Compute Budget allocation"
              />
            )}
          </Field>
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
          <Button
            variant="primary"
            onClick={handleExecute}
            disabled={busy || !amountUsdc || transferAmount <= 0}
          >
            {busy ? "Settling on Ledger..." : "Execute Transfer"}
          </Button>
        </footer>
      </div>
    </div>
  );
}
