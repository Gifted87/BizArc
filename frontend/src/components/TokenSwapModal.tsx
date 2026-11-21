import React, { useState } from "react";
import { useTreasury } from "../context/TreasuryContext";
import { Button, Banner, Field, Select, UsdcInput, TextInput } from "../primitives";
import { formatUsdc, isUsdc } from "../money";
import { treasuryApi } from "../api/treasuryApi";

export function TokenSwapModal({ onClose }: { onClose: () => void }) {
  const { accounts, refreshData, appendJournalVoucher } = useTreasury();

  const [fromAsset, setFromAsset] = useState<string>("USDT");
  const [toAsset, setToAsset] = useState<string>("USDC");
  const [accountId, setAccountId] = useState<string>(accounts[0]?.accountId || "acc_treasury");
  const [amount, setAmount] = useState<string>("1000.000000");

  const [quote, setQuote] = useState<{
    estimatedOutputUsdc: string;
    rate: number;
    feeUsdc: string;
    guaranteedDurationSeconds: number;
  } | null>(null);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [success, setSuccess] = useState<string>();

  const selectedAccount = accounts.find((a) => a.accountId === accountId) || accounts[0];

  const handleGetQuote = async () => {
    setBusy(true);
    setErr(undefined);
    setQuote(null);
    try {
      if (!amount || parseFloat(amount) <= 0) {
        throw new Error("Enter a valid swap amount.");
      }
      const res = await treasuryApi.estimateSwap({
        fromToken: fromAsset,
        toToken: toAsset,
        amount: parseFloat(amount),
      });

      if (!res.success) {
        throw new Error(res.error || "Failed to obtain swap quote.");
      }

      setQuote({
        estimatedOutputUsdc: res.data?.estimatedOutputUsdc || res.data?.outputAmount || amount,
        rate: res.data?.rate || 1.0,
        feeUsdc: res.data?.feeUsdc || "0.500000",
        guaranteedDurationSeconds: res.data?.guaranteedDurationSeconds || 30,
      });
    } catch (e: any) {
      setErr(e.message || "Pricing estimate failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleExecuteSwap = async () => {
    setBusy(true);
    setErr(undefined);
    setSuccess(undefined);
    try {
      const res = await treasuryApi.executeSwap({
        accountId,
        fromToken: fromAsset,
        toToken: toAsset,
        amount: parseFloat(amount),
        quoteId: `quote-${Date.now()}`,
      });

      if (!res.success) {
        throw new Error(res.error || "Swap execution failed.");
      }

      appendJournalVoucher({
        timestamp: new Date().toISOString(),
        accountId,
        actionType: "TOKEN_SWAP",
        debitAccount: `${accountId}:liquid`,
        creditAccount: `swap:${fromAsset.toLowerCase()}`,
        amountUsdc: quote?.estimatedOutputUsdc || amount,
        documentRef: `SWAP-${Date.now().toString().slice(-6)}`,
        memo: `Swapped ${amount} ${fromAsset} for ${quote?.estimatedOutputUsdc || amount} ${toAsset} via Circle SwapKit`,
      });

      setSuccess(`Successfully swapped ${amount} ${fromAsset} to ${toAsset}!`);
      await refreshData();
      setTimeout(() => {
        onClose();
      }, 1400);
    } catch (e: any) {
      setErr(e.message || "Swap execution failed.");
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
          maxWidth: 500,
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
              Atomic Token Swap
            </h3>
            <span className="bz-faint" style={{ fontSize: "0.85rem" }}>
              Circle SwapKit & Arc L1 Liquidity Pool
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

        <div style={{ padding: 20, display: "grid", gap: 16 }}>
          {err && <Banner tone="danger" title="Swap Error">{err}</Banner>}
          {success && <Banner tone="auto" title="Swap Complete">{success}</Banner>}

          <Field label="Settlement Treasury Account">
            {(id) => (
              <Select
                id={id}
                value={accountId}
                onChange={setAccountId}
                options={accounts.map((a) => ({
                  value: a.accountId,
                  label: `${a.name} (${formatUsdc(a.liquidUsdc, { symbol: true })} liquid)`,
                }))}
              />
            )}
          </Field>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="From Asset">
              {(id) => (
                <Select
                  id={id}
                  value={fromAsset}
                  onChange={setFromAsset}
                  options={[
                    { value: "USDT", label: "USDT (Tether USD)" },
                    { value: "EURC", label: "EURC (Circle Euro)" },
                    { value: "ETH", label: "WETH (Wrapped Ether)" },
                    { value: "SOL", label: "SOL (Solana)" },
                    { value: "USDC", label: "USDC (Native Arc)" },
                  ]}
                />
              )}
            </Field>

            <Field label="To Asset">
              {(id) => (
                <Select
                  id={id}
                  value={toAsset}
                  onChange={setToAsset}
                  options={[
                    { value: "USDC", label: "USDC (Arc Native)" },
                    { value: "USYC", label: "USYC (Yield Token)" },
                    { value: "EURC", label: "EURC (Circle Euro)" },
                  ]}
                />
              )}
            </Field>
          </div>

          <Field label={`Amount (${fromAsset})`}>
            {() => (
              <UsdcInput
                value={amount}
                onChange={(val) => {
                  setAmount(val);
                  setQuote(null);
                }}
              />
            )}
          </Field>

          {quote ? (
            <div
              style={{
                backgroundColor: "var(--surface-muted)",
                padding: "12px 14px",
                borderRadius: "var(--r-sm)",
                border: "1px solid var(--rule-strong)",
                display: "grid",
                gap: 6,
                fontSize: "0.85rem",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span className="bz-faint">Estimated Output:</span>
                <strong className="bz-fig" style={{ color: "var(--auto)", fontSize: "1rem" }}>
                  {formatUsdc(quote.estimatedOutputUsdc, { symbol: true })} {toAsset}
                </strong>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span className="bz-faint">Indicative Rate:</span>
                <span>1 {fromAsset} ≈ {quote.rate.toFixed(4)} {toAsset}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span className="bz-faint">Swap Fee:</span>
                <span>{quote.feeUsdc} USDC</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span className="bz-faint">Quote Guaranteed:</span>
                <span>{quote.guaranteedDurationSeconds}s</span>
              </div>
            </div>
          ) : (
            <Button variant="secondary" onClick={handleGetQuote} loading={busy}>
              Get Swap Quote
            </Button>
          )}
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
            onClick={handleExecuteSwap}
            disabled={busy || !quote || parseFloat(amount) <= 0}
          >
            {busy ? "Executing On-Chain..." : `Execute Swap (${fromAsset} → ${toAsset})`}
          </Button>
        </footer>
      </div>
    </div>
  );
}
