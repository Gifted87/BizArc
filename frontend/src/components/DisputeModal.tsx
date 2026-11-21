import React, { useState } from "react";
import { useTreasury } from "../context/TreasuryContext";
import { Button, Banner, Field, Select, TextInput } from "../primitives";
import { formatUsdc } from "../money";
import type * as T from "../types";

export function DisputeModal({
  liability,
  onClose,
}: {
  liability?: T.Liability | null;
  onClose: () => void;
}) {
  const { liabilities, disputeLiability } = useTreasury();

  const disputableLiabilities = liabilities.filter(
    (l) => l.status !== "SETTLED" && l.status !== "CANCELLED"
  );

  const [selectedLiabilityId, setSelectedLiabilityId] = useState<string>(
    liability?.liabilityId || disputableLiabilities[0]?.liabilityId || ""
  );
  const [disputeCategory, setDisputeCategory] = useState<string>("OVERBILLING");
  const [justification, setJustification] = useState<string>("");
  const [evidenceRef, setEvidenceRef] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [success, setSuccess] = useState<string>();

  const activeLiab =
    liabilities.find((l) => l.liabilityId === selectedLiabilityId) ||
    liability ||
    disputableLiabilities[0];

  const handleDispute = async () => {
    if (!selectedLiabilityId) {
      setErr("Please select a liability to dispute.");
      return;
    }
    if (!justification.trim()) {
      setErr("Please provide a detailed justification for the dispute.");
      return;
    }

    setBusy(true);
    setErr(undefined);
    setSuccess(undefined);

    try {
      const fullMemo = `[${disputeCategory}] ${justification}${
        evidenceRef ? ` (Ref: ${evidenceRef})` : ""
      }`;
      await disputeLiability(selectedLiabilityId, fullMemo);
      setSuccess("Formal dispute lodged successfully. Payment frozen and audit trail updated.");
      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (e: any) {
      setErr(e.message || "Failed to submit dispute.");
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
          maxWidth: 540,
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
              File Formal Liability Dispute
            </h3>
            <span className="bz-faint" style={{ fontSize: "0.85rem" }}>
              Three-Way Matching Exception & Payment Freeze (Pillar 2)
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
          {err && <Banner tone="danger" title="Dispute Error">{err}</Banner>}
          {success && <Banner tone="auto" title="Dispute Lodged">{success}</Banner>}

          <Field label="Select Liability / Invoice">
            {(id) => (
              <Select
                id={id}
                value={selectedLiabilityId}
                onChange={(val) => setSelectedLiabilityId(val)}
                options={disputableLiabilities.map((l) => ({
                  value: l.liabilityId,
                  label: `${l.title} (${formatUsdc(l.amountUsdc, { symbol: true })}) - Due ${new Date(
                    l.dueDate
                  ).toLocaleDateString()}`,
                }))}
              />
            )}
          </Field>

          {activeLiab && (
            <div
              style={{
                backgroundColor: "var(--surface-muted)",
                padding: "10px 14px",
                borderRadius: "var(--r-sm)",
                fontSize: "0.85rem",
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 8,
              }}
            >
              <div>
                <span className="bz-faint" style={{ display: "block" }}>Vendor:</span>
                <strong>{activeLiab.vendorId.replace("vendor_", "").replace(/_/g, " ")}</strong>
              </div>
              <div>
                <span className="bz-faint" style={{ display: "block" }}>Amount:</span>
                <strong className="bz-fig">{formatUsdc(activeLiab.amountUsdc, { symbol: true })}</strong>
              </div>
              <div>
                <span className="bz-faint" style={{ display: "block" }}>Current Status:</span>
                <span>{activeLiab.status}</span>
              </div>
              <div>
                <span className="bz-faint" style={{ display: "block" }}>Target Rail:</span>
                <span>{activeLiab.rail || "Default Vault"}</span>
              </div>
            </div>
          )}

          <Field label="Dispute Reason Category">
            {(id) => (
              <Select
                id={id}
                value={disputeCategory}
                onChange={setDisputeCategory}
                options={[
                  { value: "OVERBILLING", label: "Rate Exceeds Contract Baseline / Overbilled" },
                  { value: "UNRENDERED_SERVICES", label: "Goods / Services Not Received (No GRN)" },
                  { value: "DUPLICATE_CHARGE", label: "Duplicate Billing or Double Charge" },
                  { value: "UNKNOWN_VENDOR", label: "Unverified Vendor / Payee Substitution Risk" },
                  { value: "CONTRACT_BREACH", label: "SLA Failure or Vendor Contract Breach" },
                ]}
              />
            )}
          </Field>

          <Field label="Evidence Document / Ticket Ref (Optional)">
            {(id) => (
              <TextInput
                id={id}
                type="text"
                placeholder="e.g. JIRA-4092, PO-2026-081-REV, Zendesk #1102"
                value={evidenceRef}
                onChange={(e) => setEvidenceRef(e.target.value)}
              />
            )}
          </Field>

          <Field label="Mandatory Audit Justification">
            {(id) => (
              <textarea
                id={id}
                className="bz-input"
                rows={3}
                placeholder="Detail the discrepancy between invoice and purchase order/receipt..."
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                style={{
                  width: "100%",
                  resize: "vertical",
                  fontFamily: "var(--font-sans)",
                  fontSize: "0.85rem",
                }}
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
            variant="danger"
            onClick={handleDispute}
            disabled={busy || !justification.trim() || !selectedLiabilityId}
          >
            {busy ? "Submitting Dispute..." : "Submit Dispute & Freeze"}
          </Button>
        </footer>
      </div>
    </div>
  );
}
