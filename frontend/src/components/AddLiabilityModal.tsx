import React, { useState } from "react";
import { useTreasury } from "../context/TreasuryContext";
import { RailPicker } from "../domain";
import { Button, Field, TextInput, UsdcInput, Select, Banner } from "../primitives";
import { isUsdc } from "../money";
import type * as T from "../types";

export function AddLiabilityModal({ onClose }: { onClose: () => void }) {
  const { accounts, addLiability } = useTreasury();

  const [title, setTitle] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.accountId || "acc_engineering");
  const [vendorId, setVendorId] = useState("vendor_custom");
  const [customVendorName, setCustomVendorName] = useState("");
  const [category, setCategory] = useState<T.LiabilityCategory>("INFRASTRUCTURE");
  const [amountUsdc, setAmountUsdc] = useState("1500.000000");
  const [amountValid, setAmountValid] = useState(true);
  const [dueDate, setDueDate] = useState(
    new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
  );
  const [rail, setRail] = useState<T.PaymentRail>("DISBURSAL_VAULT");
  const [subMethod, setSubMethod] = useState<T.FiatSubMethod>("FEDWIRE");
  const [payoutAddress, setPayoutAddress] = useState("0x4444555566667777888899990000111122223333");
  const [err, setErr] = useState<string>();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErr(undefined);

    if (!title.trim()) {
      setErr("Bill title is required.");
      return;
    }

    if (!isUsdc(amountUsdc) || parseFloat(amountUsdc) <= 0) {
      setErr("Please enter a valid positive USDC amount with at most 6 decimal places.");
      return;
    }

    const finalVendor = vendorId === "vendor_custom" ? `vendor_${customVendorName.toLowerCase().replace(/\s+/g, "_")}` : vendorId;

    addLiability({
      title: title.trim(),
      accountId,
      vendorId: finalVendor,
      category,
      amountUsdc,
      dueDate: new Date(dueDate).toISOString(),
      status: "SCHEDULED",
      payoutAddress,
      rail,
    });

    onClose();
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
          maxWidth: 620,
          backgroundColor: "var(--surface)",
          border: "1px solid var(--rule-strong)",
          borderRadius: "var(--r-panel)",
          boxShadow: "0 20px 40px rgba(0, 0, 0, 0.2)",
          maxHeight: "90vh",
          overflowY: "auto",
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
            Schedule New Recurring or Ad-Hoc Bill
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

        <form onSubmit={handleSubmit} style={{ padding: 20, display: "grid", gap: 16 }}>
          {err && <Banner tone="danger" title="Validation Error">{err}</Banner>}

          <Field label="Bill Description / Title">
            {id => (
              <TextInput
                id={id}
                placeholder="e.g. Snowflake Data Cloud Quarterly"
                value={title}
                onChange={e => setTitle(e.target.value)}
              />
            )}
          </Field>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Debited Cost Center">
              {id => (
                <Select
                  id={id}
                  value={accountId}
                  onChange={setAccountId}
                  options={accounts.map(a => ({ value: a.accountId, label: `${a.name} (${a.role})` }))}
                />
              )}
            </Field>

            <Field label="Category">
              {id => (
                <Select
                  id={id}
                  value={category}
                  onChange={v => setCategory(v as T.LiabilityCategory)}
                  options={[
                    { value: "INFRASTRUCTURE", label: "Infrastructure" },
                    { value: "DEVELOPER_TOOLS", label: "Developer Tools" },
                    { value: "SAAS", label: "SaaS / Subscriptions" },
                    { value: "CONTRACTOR", label: "Contractor / Legal" },
                    { value: "MARKETING", label: "Marketing / Growth" },
                    { value: "GENERAL_OPERATIONS", label: "General Operations" },
                  ]}
                />
              )}
            </Field>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field
              label="Amount in USDC"
              hint="Max 6 decimals. Never rounded."
              error={!amountValid ? "Invalid USDC amount: exact 6 decimals max." : undefined}
            >
              {(id, d) => (
                <UsdcInput
                  id={id}
                  describedBy={d}
                  value={amountUsdc}
                  onChange={(v, valid) => {
                    setAmountUsdc(v);
                    setAmountValid(valid);
                  }}
                />
              )}
            </Field>

            <Field label="Due Date">
              {id => (
                <TextInput
                  id={id}
                  type="date"
                  value={dueDate}
                  onChange={e => setDueDate(e.target.value)}
                />
              )}
            </Field>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="Vendor Directory">
              {id => (
                <Select
                  id={id}
                  value={vendorId}
                  onChange={setVendorId}
                  options={[
                    { value: "vendor_aws", label: "Amazon Web Services" },
                    { value: "vendor_github", label: "GitHub Enterprise" },
                    { value: "vendor_openai", label: "OpenAI API" },
                    { value: "vendor_figma", label: "Figma" },
                    { value: "vendor_mofo", label: "Morrison & Foerster LLP" },
                    { value: "vendor_berlin_gmbh", label: "Büro Berlin Coworking" },
                    { value: "vendor_custom", label: "+ Custom Vendor" },
                  ]}
                />
              )}
            </Field>

            {vendorId === "vendor_custom" && (
              <Field label="Custom Vendor Name">
                {id => (
                  <TextInput
                    id={id}
                    placeholder="e.g. Datadog Inc."
                    value={customVendorName}
                    onChange={e => setCustomVendorName(e.target.value)}
                  />
                )}
              </Field>
            )}
          </div>

          <Field label="Payout Destination (Wallet or Bank Memo)">
            {id => (
              <TextInput
                id={id}
                value={payoutAddress}
                onChange={e => setPayoutAddress(e.target.value)}
              />
            )}
          </Field>

          <RailPicker
            rail={rail}
            sub={subMethod}
            onChange={(r, s) => {
              setRail(r);
              if (s) setSubMethod(s);
            }}
          />

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
              paddingTop: 12,
              borderTop: "1px solid var(--rule)",
            }}
          >
            <Button variant="quiet" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Schedule Bill</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
