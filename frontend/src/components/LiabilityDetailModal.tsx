import React, { useState } from "react";
import { useTreasury } from "../context/TreasuryContext";
import { RailBadge, LiabilityStatusBadge } from "../domain";
import { Button, Banner, CopyChip, Field, Select, type Tone } from "../primitives";
import { formatUsdc } from "../money";
import type * as T from "../types";

export function LiabilityDetailModal({
  liability,
  onClose,
}: {
  liability: T.Liability;
  onClose: () => void;
}) {
  const { payLiability, updateLiabilityStatus, circuitBreakerTripped, accounts, appendJournalVoucher } = useTreasury();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [showDisputeForm, setShowDisputeForm] = useState(false);
  const [disputeReason, setDisputeReason] = useState("");

  const targetAccount = accounts.find(a => a.accountId === liability.accountId);
  const canSettle = liability.status === "SCHEDULED" || liability.status === "AWAITING_APPROVAL";

  const handlePay = async () => {
    setBusy(true);
    setErr(undefined);
    try {
      await payLiability(liability.liabilityId);
      setSuccess("Bill successfully disbursed and settled onchain!");
      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Payment failed");
    } finally {
      setBusy(false);
    }
  };

  const handleToggleFreeze = () => {
    if (liability.status === "FROZEN") {
      updateLiabilityStatus(liability.liabilityId, "SCHEDULED");
    } else {
      updateLiabilityStatus(liability.liabilityId, "FROZEN");
    }
  };

  const handleDispute = async () => {
    if (!disputeReason.trim()) {
      setErr("Please provide a dispute memo detailing the anomaly or overcharge.");
      return;
    }
    setBusy(true);
    setErr(undefined);
    try {
      updateLiabilityStatus(liability.liabilityId, "FROZEN");
      appendJournalVoucher({
        timestamp: new Date().toISOString(),
        accountId: liability.accountId,
        actionType: "INVOICE_DISPUTED",
        debitAccount: liability.vendorId,
        creditAccount: `${liability.accountId}:disputed`,
        amountUsdc: liability.amountUsdc,
        documentRef: `DISPUTE-${liability.liabilityId.slice(-6)}`,
        memo: disputeReason,
      });
      setSuccess("Formal dispute filed. Scheduled payment frozen and audit trail updated.");
      setShowDisputeForm(false);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Dispute filing failed");
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
          maxWidth: 580,
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
              {liability.title}
            </h3>
            <span className="bz-faint" style={{ fontSize: "0.85rem" }}>
              ID: {liability.liabilityId}
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
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div>
              <span className="bz-faint" style={{ fontSize: "0.8rem", display: "block" }}>
                Total Obligation
              </span>
              <span className="bz-fig bz-total" style={{ fontSize: "var(--fs-4)" }}>
                {formatUsdc(liability.amountUsdc, { symbol: true })}
              </span>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <LiabilityStatusBadge status={liability.status} />
              {liability.rail && <RailBadge rail={liability.rail} />}
            </div>
          </div>

          {liability.isOverdue && liability.status !== "SETTLED" && (
            <Banner tone="danger" title="Overdue Payment">
              Due date was {new Date(liability.dueDate).toLocaleDateString()}. Liability is currently {liability.status}.
            </Banner>
          )}

          {err && <Banner tone="danger" title="Disbursal Error">{err}</Banner>}
          {success && <Banner tone="auto" title="Settlement Confirmed">{success}</Banner>}

          <dl className="bz-kv" style={{ fontSize: "0.9rem" }}>
            <dt>Vendor</dt>
            <dd>
              <strong>{liability.vendorId.replace("vendor_", "").replace(/_/g, " ")}</strong>
            </dd>
            <dt>Paying Account</dt>
            <dd>{targetAccount?.name || liability.accountId}</dd>
            <dt>Category</dt>
            <dd>{liability.category}</dd>
            <dt>Due Date</dt>
            <dd>{new Date(liability.dueDate).toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" })}</dd>
            <dt>Payout Destination</dt>
            <dd>
              <CopyChip value={liability.payoutAddress} label="payout address" />
            </dd>
          </dl>

          {showDisputeForm ? (
            <div style={{ backgroundColor: "var(--surface-muted)", padding: 12, borderRadius: "var(--r-sm)", border: "1px solid var(--rule-strong)", display: "grid", gap: 8 }}>
              <strong style={{ fontSize: "0.9rem" }}>Formal Invoice Dispute Memo (Pillar 2)</strong>
              <textarea
                className="bz-input"
                rows={3}
                placeholder="Describe reason for dispute (e.g. rate exceeded PO contract baseline by 12%)..."
                value={disputeReason}
                onChange={e => setDisputeReason(e.target.value)}
                style={{ width: "100%", resize: "vertical", fontFamily: "var(--font-sans)", fontSize: "0.85rem" }}
              />
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <Button variant="secondary" onClick={() => setShowDisputeForm(false)}>Cancel</Button>
                <Button loading={busy} onClick={handleDispute}>Submit Formal Dispute</Button>
              </div>
            </div>
          ) : null}

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: 12,
              paddingTop: 16,
              borderTop: "1px solid var(--rule)",
            }}
          >
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {canSettle && (
                <Button loading={busy} disabled={circuitBreakerTripped} onClick={handlePay}>
                  Settle & Disburse Now
                </Button>
              )}

              {liability.status !== "SETTLED" && (
                <>
                  <Button variant="secondary" onClick={handleToggleFreeze}>
                    {liability.status === "FROZEN" ? "Unfreeze Bill" : "Freeze Bill"}
                  </Button>
                  {!showDisputeForm && (
                    <Button variant="secondary" onClick={() => setShowDisputeForm(true)}>
                      Dispute Invoice
                    </Button>
                  )}
                </>
              )}
            </div>

            <Button variant="quiet" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
