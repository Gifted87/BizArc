import React, { useState } from "react";
import { Panel, Button, Badge, DataTable, CopyChip, Banner, Field, TextInput, Select } from "../primitives";
import { VENDORS } from "../fixtures";
import type * as T from "../types";

export function VendorsView() {
  const [vendors, setVendors] = useState<T.Vendor[]>(VENDORS);
  const [showAddVendor, setShowAddVendor] = useState(false);
  const [newVendorName, setNewVendorName] = useState("");
  const [newVendorCategory, setNewVendorCategory] = useState("INFRASTRUCTURE");
  const [newVendorAddress, setNewVendorAddress] = useState("");
  const [newVendorRail, setNewVendorRail] = useState<T.PaymentRail>("DISBURSAL_VAULT");
  const [bannerMsg, setBannerMsg] = useState<string | null>(null);

  const handleAddVendor = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVendorName) return;

    const newVendor: T.Vendor = {
      vendorId: `vendor_${newVendorName.toLowerCase().replace(/[^a-z0-9]/g, "_")}`,
      name: newVendorName,
      verifiedPayoutAddress: newVendorAddress ? (newVendorAddress as T.Hex) : undefined,
      changeLock: true,
      verifiedByAdmin: "s.connor@halcyon.ai",
      lastVerifiedAt: new Date().toISOString(),
      authorizedCategory: newVendorCategory,
      preferredRail: newVendorRail,
      banks: [],
      openLiabilities: 0,
      trailing30dUsdc: "0.000000",
    };

    setVendors([newVendor, ...vendors]);
    setBannerMsg(`Vendor '${newVendorName}' registered with immutable changeLock protection.`);
    setNewVendorName("");
    setNewVendorAddress("");
    setShowAddVendor(false);
  };

  return (
    <div style={{ display: "grid", gap: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ fontSize: "var(--fs-3)", fontWeight: 700, margin: 0, color: "var(--ink)" }}>
            Vendor Master Registry & Verified Beneficiary Banking
          </h1>
          <p className="bz-faint" style={{ margin: "4px 0 0", fontSize: "0.9rem" }}>
            Maintain verified payout addresses and banking credentials to prevent payee substitution attacks (Rule 3).
          </p>
        </div>
        <Button variant="primary" onClick={() => setShowAddVendor(true)}>
          + Add Verified Vendor
        </Button>
      </div>

      {bannerMsg && (
        <Banner tone="auto">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
            <span>{bannerMsg}</span>
            <Button variant="quiet" onClick={() => setBannerMsg(null)} style={{ padding: "2px 8px" }}>
              Dismiss
            </Button>
          </div>
        </Banner>
      )}

      <Panel
        title="Verified Vendors Master"
        action={<Badge tone="neutral">{vendors.length} Vendors Registered</Badge>}
      >
        <DataTable
          columns={[
            {
              key: "name",
              header: "Vendor Entity",
              render: (v: T.Vendor) => (
                <div>
                  <div style={{ fontWeight: 600, color: "var(--ink)" }}>{v.name}</div>
                  <div className="bz-faint" style={{ fontSize: "0.8rem", fontFamily: "var(--font-mono)" }}>
                    {v.vendorId}
                  </div>
                </div>
              ),
            },
            {
              key: "category",
              header: "Category",
              render: (v: T.Vendor) => <Badge tone="neutral">{v.authorizedCategory}</Badge>,
            },
            {
              key: "preferredRail",
              header: "Settlement Rail",
              render: (v: T.Vendor) => (
                <Badge tone={v.preferredRail === "FIAT_PAYOUT" ? "gate" : "liquid"}>
                  {v.preferredRail}
                </Badge>
              ),
            },
            {
              key: "payoutAddress",
              header: "Verified Payout Address / Bank",
              render: (v: T.Vendor) =>
                v.verifiedPayoutAddress ? (
                  <CopyChip text={v.verifiedPayoutAddress} label={v.verifiedPayoutAddress} />
                ) : (
                  <Badge tone="gate">Linked Traditional Bank</Badge>
                ),
            },
            {
              key: "changeLock",
              header: "Payee Substitution Lock",
              render: (v: T.Vendor) => (
                <Badge tone={v.changeLock ? "liquid" : "danger"}>
                  {v.changeLock ? "Change-Locked (Rule 3)" : "Unlocked"}
                </Badge>
              ),
            },
            {
              key: "verifiedBy",
              header: "Verified By",
              render: (v: T.Vendor) => (
                <span className="bz-faint" style={{ fontSize: "0.8rem" }}>
                  {v.verifiedByAdmin || "Auto-Onboarded"}
                </span>
              ),
            },
          ]}
          rows={vendors}
          rowKey={(v) => v.vendorId}
        />
      </Panel>

      {/* Add Vendor Modal */}
      {showAddVendor && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
          }}
          onClick={() => setShowAddVendor(false)}
        >
          <div
            style={{
              backgroundColor: "var(--surface)",
              borderRadius: "var(--r-panel)",
              padding: 24,
              maxWidth: 480,
              width: "100%",
              boxShadow: "0 20px 40px rgba(0,0,0,0.2)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: "0 0 16px", fontSize: "var(--fs-2)" }}>Register Verified Vendor</h3>
            <form onSubmit={handleAddVendor} style={{ display: "grid", gap: 16 }}>
              <Field label="Vendor Legal Name">
                {(id) => (
                  <TextInput
                    id={id}
                    value={newVendorName}
                    onChange={(e) => setNewVendorName(e.target.value)}
                    placeholder="e.g. Datadog Inc."
                    required
                  />
                )}
              </Field>

              <Field label="Authorized Category">
                {(id) => (
                  <Select
                    id={id}
                    value={newVendorCategory}
                    onChange={(v) => setNewVendorCategory(v)}
                    options={[
                      { value: "INFRASTRUCTURE", label: "Cloud & Infrastructure" },
                      { value: "SAAS", label: "Software & Subscriptions" },
                      { value: "PAYROLL", label: "Payroll & Compensation" },
                      { value: "LEGAL", label: "Legal & Regulatory" },
                      { value: "MARKETING", label: "Marketing & Growth" },
                      { value: "GENERAL_OPEX", label: "General Operating Expenses" },
                    ]}
                  />
                )}
              </Field>

              <Field label="Preferred Settlement Rail">
                {(id) => (
                  <Select
                    id={id}
                    value={newVendorRail}
                    onChange={(v) => setNewVendorRail(v as T.PaymentRail)}
                    options={[
                      { value: "DISBURSAL_VAULT", label: "DisbursalVault (Arc L1 Smart Contract)" },
                      { value: "GATEWAY_X402", label: "Circle Gateway x402 (Instant HTTP 402 Micropayments)" },
                      { value: "MODULAR_SESSION_KEYS", label: "Modular Session Keys (ERC-4337 / ERC-6900)" },
                      { value: "ERC3009_AUTHORIZATION", label: "ERC-3009 Gasless Transfer With Authorization" },
                      { value: "FIAT_PAYOUT", label: "Circle Mint Fiat Payout (Fedwire / ACH / Push-to-Card)" },
                    ]}
                  />
                )}
              </Field>

              <Field label="Verified On-Chain Payout Address (Optional if Fiat)">
                {(id) => (
                  <TextInput
                    id={id}
                    value={newVendorAddress}
                    onChange={(e) => setNewVendorAddress(e.target.value)}
                    placeholder="0x..."
                  />
                )}
              </Field>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 8 }}>
                <Button variant="quiet" onClick={() => setShowAddVendor(false)}>
                  Cancel
                </Button>
                <Button variant="primary" type="submit">
                  Save to Registry
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
