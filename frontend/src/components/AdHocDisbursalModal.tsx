import React, { useState } from "react";
import { useTreasury } from "../context/TreasuryContext";
import { Button, Banner, Field, Select, UsdcInput, TextInput } from "../primitives";
import { formatUsdc, isUsdc } from "../money";
import { VENDORS } from "../fixtures";
import { treasuryApi } from "../api/treasuryApi";
import type * as T from "../types";

export function AdHocDisbursalModal({ onClose }: { onClose: () => void }) {
  const { accounts, refreshData, appendJournalVoucher, circuitBreakerTripped } = useTreasury();

  const [vendorId, setVendorId] = useState<string>(VENDORS[0]?.vendorId || "vendor_anthropic");
  const [sourceAccountId, setSourceAccountId] = useState<string>(
    accounts[0]?.accountId || "acc_treasury"
  );
  const [rail, setRail] = useState<T.DisbursalRail>("DISBURSAL_VAULT");
  const [rail, setRail] = useState<T.PaymentRail>("DISBURSAL_VAULT");
  const [category, setCategory] = useState<string>("Cloud & AI");
  const [amountUsdc, setAmountUsdc] = useState<string>("2500.000000");
  const [invoiceId, setInvoiceId] = useState<string>(`INV-${Date.now().toString().slice(-6)}`);
  const [poReference, setPoReference] = useState<string>("PO-2026-ADHOC");
  const [rationale, setRationale] = useState<string>("");

  const [routingNumber, setRoutingNumber] = useState<string>("021000021");
  const [accountNumber, setAccountNumber] = useState<string>("123456789012");
  const [fiatMethod, setFiatMethod] = useState<"WIRE" | "ACH">("ACH");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [success, setSuccess] = useState<string>();

  const selectedVendor = VENDORS.find((v) => v.vendorId === vendorId) || VENDORS[0];
  const sourceAccount = accounts.find((a) => a.accountId === sourceAccountId) || accounts[0];

  const sourceLiquid = parseFloat(sourceAccount?.liquidUsdc || "0");
  const sourceFloor = parseFloat(sourceAccount?.protectedReserveUsdc || "0");
  const disbursalAmount = parseFloat(amountUsdc || "0");
  const postBalance = sourceLiquid - disbursalAmount;
  const breachesFloor = postBalance < sourceFloor;

  const handleDisburse = async () => {
    if (circuitBreakerTripped) {
      setErr("Emergency stop is active. Disbursals are blocked.");
      return;
    }
    if (!isUsdc(amountUsdc) || disbursalAmount <= 0) {
      setErr("Enter a valid positive USDC amount with max 6 decimal places.");
      return;
    }
    if (disbursalAmount > sourceLiquid) {
      setErr(
        `Insufficient liquid funds: ${sourceAccount?.name} has only ${formatUsdc(
          sourceAccount?.liquidUsdc || "0",
          { symbol: true }
        )} available.`
      );
      return;
    }
    if (!rationale.trim()) {
      setErr("Please provide a business rationale for this disbursal.");
      return;
    }

    setBusy(true);
    setErr(undefined);
    setSuccess(undefined);

    try {
      const payload: any = {
        sourceAccountId,
        vendorId,
        vendorName: selectedVendor.name,
        amountUsdc: disbursalAmount,
        paymentRail: rail,
        category,
        invoiceId,
        poReference,
        declaredReason: rationale,
      };

      if (rail === "FIAT_PAYOUT") {
        payload.fiatDetails = {
          bankName: "Commercial Clearing Bank",
          routingNumber,
          accountNumber,
          subMethod: fiatMethod,
          memo: `Inv ${invoiceId}`,
        };
      }

      const res = await treasuryApi.disburseManual(payload);
      if (!res.success) {
        throw new Error(res.error || "Disbursal rejected by router/policy gate.");
      }

      const txHash = res.data?.txHash || res.data?.payoutReference || `0x${Date.now().toString(16)}`;

      appendJournalVoucher({
        timestamp: new Date().toISOString(),
        accountId: sourceAccountId,
        actionType: "DISBURSEMENT",
        debitAccount: `${sourceAccountId}:liquid`,
        creditAccount: selectedVendor.vendorId,
        amountUsdc,
        documentRef: invoiceId,
        txHash,
        memo: `Ad-hoc payment to ${selectedVendor.name}: ${rationale}`,
      });

      setSuccess(`Disbursal executed! Settlement ref: ${txHash.slice(0, 18)}...`);
      await refreshData();
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (e: any) {
      setErr(e.message || "Failed to execute disbursal.");
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
          maxWidth: 600,
          backgroundColor: "var(--surface)",
          border: "1px solid var(--rule-strong)",
          borderRadius: "var(--r-panel)",
          boxShadow: "0 20px 40px rgba(0, 0, 0, 0.2)",
          overflow: "hidden",
          maxHeight: "92vh",
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
            <h3 style={{ margin: 0, font: "600 var(--fs-2) var(--font-figure)" }}>
              Pay Vendor Now (Ad-Hoc Disbursal)
            </h3>
            <span className="bz-faint" style={{ fontSize: "0.85rem" }}>
              Multi-Rail Settlement Router with Three-Way Verification
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

        <div style={{ padding: 20, display: "grid", gap: 14, overflowY: "auto" }}>
          {err && <Banner tone="danger" title="Disbursal Rejected">{err}</Banner>}
          {success && <Banner tone="auto" title="Settlement Confirmed">{success}</Banner>}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Beneficiary Vendor">
              {(id) => (
                <Select
                  id={id}
                  value={vendorId}
                  onChange={setVendorId}
                  options={VENDORS.map((v) => ({
                    value: v.vendorId,
                    label: `${v.name} (${v.category})`,
                    label: `${v.name} (${v.authorizedCategory})`,
                  }))}
                />
              )}
            </Field>

            <Field label="Debiting Treasury Account">
              {(id) => (
                <Select
                  id={id}
                  value={sourceAccountId}
                  onChange={setSourceAccountId}
                  options={accounts.map((a) => ({
                    value: a.accountId,
                    label: `${a.name} (${formatUsdc(a.liquidUsdc, { symbol: true })})`,
                  }))}
                />
              )}
            </Field>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Settlement Rail">
              {(id) => (
                <Select
                  id={id}
                  value={rail}
                  onChange={(val) => setRail(val as T.DisbursalRail)}
                  onChange={(val) => setRail(val as T.PaymentRail)}
                  options={[
                    { value: "DISBURSAL_VAULT", label: "Disbursal Vault (Arc L1 Native)" },
                    { value: "GATEWAY_X402", label: "Gateway x402 Nanopayments" },
                    { value: "MODULAR_SESSION_KEYS", label: "Modular Session Keys (ERC-6900)" },
                    { value: "ERC3009_AUTHORIZATION", label: "ERC-3009 Gasless Transfer" },
                    { value: "FIAT_PAYOUT", label: "Circle Mint Payout (ACH / Wire)" },
                  ]}
                />
              )}
            </Field>

            <Field label="Budget Category">
              {(id) => (
                <Select
                  id={id}
                  value={category}
                  onChange={setCategory}
                  options={[
                    { value: "Cloud & AI", label: "Cloud & AI Infrastructure" },
                    { value: "Payroll & Talent", label: "Payroll & Engineering Contractors" },
                    { value: "Hardware", label: "Hardware & Lab Equipment" },
                    { value: "Legal", label: "Legal, IP & Corporate Counsel" },
                    { value: "Taxes", label: "Tax Reserves & Statutory Withholding" },
                    { value: "Operations", label: "General Operations & SaaS" },
                  ]}
                />
              )}
            </Field>
          </div>

          <Field label="Disbursal Amount (USDC)">
            {() => (
              <div>
                <UsdcInput value={amountUsdc} onChange={setAmountUsdc} />
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginTop: 4,
                    fontSize: "0.8rem",
                    color: breachesFloor ? "var(--c-danger)" : "var(--ink-3)",
                  }}
                >
                  <span>
                    Liquid Balance: {formatUsdc(sourceAccount?.liquidUsdc || "0", { symbol: true })}
                  </span>
                  <span>
                    Floor Reserve: {formatUsdc(sourceAccount?.protectedReserveUsdc || "0", { symbol: true })}
                  </span>
                </div>
                {breachesFloor && (
                  <p style={{ margin: "4px 0 0", color: "var(--c-danger)", fontSize: "0.8rem" }}>
                    ⚠️ Warning: This payment dips {sourceAccount?.name} below its required operating floor!
                  </p>
                )}
              </div>
            )}
          </Field>

          {rail === "FIAT_PAYOUT" && (
            <div
              style={{
                backgroundColor: "var(--surface-muted)",
                padding: "12px",
                borderRadius: "var(--r-sm)",
                border: "1px solid var(--rule-strong)",
                display: "grid",
                gap: 10,
              }}
            >
              <strong style={{ fontSize: "0.85rem" }}>Circle Mint Banking Details</strong>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                <Field label="Method">
                  {(id) => (
                    <Select
                      id={id}
                      value={fiatMethod}
                      onChange={(v) => setFiatMethod(v as "WIRE" | "ACH")}
                      options={[
                        { value: "ACH", label: "FedACH Direct" },
                        { value: "WIRE", label: "Fedwire Same-Day" },
                      ]}
                    />
                  )}
                </Field>
                <Field label="Routing (ABA)">
                  {(id) => (
                    <TextInput
                      id={id}
                      value={routingNumber}
                      onChange={(e) => setRoutingNumber(e.target.value)}
                    />
                  )}
                </Field>
                <Field label="Account #">
                  {(id) => (
                    <TextInput
                      id={id}
                      value={accountNumber}
                      onChange={(e) => setAccountNumber(e.target.value)}
                    />
                  )}
                </Field>
              </div>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Invoice Ref #">
              {(id) => (
                <TextInput
                  id={id}
                  value={invoiceId}
                  onChange={(e) => setInvoiceId(e.target.value)}
                />
              )}
            </Field>
            <Field label="PO Reference">
              {(id) => (
                <TextInput
                  id={id}
                  value={poReference}
                  onChange={(e) => setPoReference(e.target.value)}
                />
              )}
            </Field>
          </div>

          <Field label="Business Rationale (Mandatory Audit Trail)">
            {(id) => (
              <TextInput
                id={id}
                type="text"
                placeholder="e.g. Expedited compute cluster renewal for Q4 rollout"
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
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
            onClick={handleDisburse}
            disabled={busy || !amountUsdc || disbursalAmount <= 0 || !rationale.trim()}
          >
            {busy ? "Routing Disbursal..." : "Disburse Payment Now"}
          </Button>
        </footer>
      </div>
    </div>
  );
}
