import React, { useState } from "react";
import { useTreasury } from "../context/TreasuryContext";
import { LiabilityTable, RailBadge, LiabilityStatusBadge, RAIL_LABEL } from "../domain";
import { Panel, Tabs, Button, TextInput, Select, Banner, EmptyState, Badge, CopyChip, DataTable, type Column } from "../primitives";
import { formatUsdc } from "../money";
import { VENDORS } from "../fixtures";
import type * as T from "../types";

export function LiabilitiesView({
  onOpenLiability,
  onOpenAddBill,
  onOpenDispute,
}: {
  onOpenLiability: (liability: T.Liability) => void;
  onOpenAddBill: () => void;
  onOpenDispute?: (liability?: T.Liability) => void;
}) {
  const { liabilities, payLiability, updateLiabilityStatus } = useTreasury();
  const [filterStatus, setFilterStatus] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"bills" | "rails" | "vendors">("bills");

  const filteredBills = liabilities.filter(l => {
    const matchesStatus = filterStatus === "ALL" || l.status === filterStatus;
    const matchesSearch =
      searchQuery === "" ||
      l.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      l.vendorId.toLowerCase().includes(searchQuery.toLowerCase()) ||
      l.category.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  const overdueCount = liabilities.filter(l => l.isOverdue && l.status !== "SETTLED").length;

  return (
    <div style={{ display: "grid", gap: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ font: "600 var(--fs-4)/1.1 var(--font-figure)", margin: 0 }}>
            Accounts Payable & Payment Rails
          </h2>
          <p className="bz-muted" style={{ margin: "4px 0 0", maxWidth: "75ch" }}>
            Scheduled liabilities, subscriptions, and contractor retainers monitored continuously by the Liability Radar Agent (#102).
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {onOpenDispute && (
            <Button variant="secondary" onClick={() => onOpenDispute()}>
              File Dispute
            </Button>
          )}
          <Button variant="primary" onClick={onOpenAddBill}>
            + Add New Bill
          </Button>
        </div>
      </div>

      <Tabs
        value={activeTab}
        onChange={setActiveTab}
        tabs={[
          { id: "bills", label: "Liabilities Ledger", count: liabilities.length },
          { id: "rails", label: "Disbursal Rails Architecture" },
          { id: "vendors", label: "Vendor Master (Rule 3)", count: VENDORS.length },
        ]}
      />

      {activeTab === "bills" && (
        <div style={{ display: "grid", gap: 16 }}>
          {overdueCount > 0 && (
            <Banner tone="danger" title={`${overdueCount} Overdue Liability Flagged`}>
              Datadog Pro usage true-up is currently FROZEN due to an unverified invoice payout address. Radar Agent has halted automated disbursal.
            </Banner>
          )}

          {/* Filter Bar */}
          <div
            style={{
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              padding: 12,
              backgroundColor: "var(--surface)",
              border: "1px solid var(--rule)",
              borderRadius: "var(--r-panel)",
            }}
          >
            <div style={{ display: "flex", gap: 8, alignItems: "center", flex: 1, minWidth: 260 }}>
              <TextInput
                placeholder="Search by vendor, title, or category…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span className="bz-faint" style={{ fontSize: "var(--fs-0)", fontWeight: 600 }}>
                Status:
              </span>
              <Select
                value={filterStatus}
                onChange={setFilterStatus}
                options={[
                  { value: "ALL", label: "All Statuses" },
                  { value: "SCHEDULED", label: "Scheduled" },
                  { value: "AWAITING_APPROVAL", label: "Awaiting Approval" },
                  { value: "FROZEN", label: "Frozen" },
                  { value: "DISBURSED", label: "Disbursed" },
                  { value: "SETTLED", label: "Settled" },
                  { value: "CANCELLED", label: "Cancelled" },
                ]}
              />
            </div>
          </div>

          <Panel>
            <LiabilityTable rows={filteredBills} onOpen={onOpenLiability} />
          </Panel>
        </div>
      )}

      {activeTab === "rails" && (
        <div style={{ display: "grid", gap: 16 }}>
          <Panel title="Configured Autonomous Payment Rails">
            <div style={{ display: "grid", gap: 16 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
                  gap: 16,
                }}
              >
                <div style={{ padding: 14, border: "1px solid var(--rule)", borderRadius: "var(--r-ctl)", backgroundColor: "var(--surface)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <strong>Disbursal Vault</strong>
                    <RailBadge rail="DISBURSAL_VAULT" />
                  </div>
                  <p className="bz-muted" style={{ fontSize: "0.85rem", margin: "0 0 10px" }}>
                    Onchain smart vault settling AWS ($14,210.50) and Deel Payroll ($88,400.00). Whitelisted payees only.
                  </p>
                  <dl className="bz-kv" style={{ fontSize: "0.85rem" }}>
                    <dt>Daily Hard Cap</dt>
                    <dd>$100,000.00</dd>
                    <dt>Per-Tx Cap</dt>
                    <dd>$25,000.00</dd>
                    <dt>Change Lock</dt>
                    <dd>Enforced</dd>
                  </dl>
                </div>

                <div style={{ padding: 14, border: "1px solid var(--rule)", borderRadius: "var(--r-ctl)", backgroundColor: "var(--surface)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <strong>Modular Session Key</strong>
                    <RailBadge rail="MODULAR_SESSION_KEY" />
                  </div>
                  <p className="bz-muted" style={{ fontSize: "0.85rem", margin: "0 0 10px" }}>
                    Scoped key authorized for GitHub Enterprise renewals without needing monthly officer signatures.
                  </p>
                  <dl className="bz-kv" style={{ fontSize: "0.85rem" }}>
                    <dt>Max Cycle Spend</dt>
                    <dd>$2,500.00</dd>
                    <dt>Spent This Cycle</dt>
                    <dd>$760.00</dd>
                    <dt>Validity</dt>
                    <dd>180 Days Active</dd>
                  </dl>
                </div>

                <div style={{ padding: 14, border: "1px solid var(--rule)", borderRadius: "var(--r-ctl)", backgroundColor: "var(--surface)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <strong>Gateway x402 (Pay-per-call)</strong>
                    <RailBadge rail="GATEWAY_X402" />
                  </div>
                  <p className="bz-muted" style={{ fontSize: "0.85rem", margin: "0 0 10px" }}>
                    Micro-settlements paying OpenAI API Tier 5 per batch ($0.002500 per 1k tokens) over native Arc L1.
                  </p>
                  <dl className="bz-kv" style={{ fontSize: "0.85rem" }}>
                    <dt>Monthly Average</dt>
                    <dd>$3,875.13</dd>
                    <dt>Stealth Creep Cap</dt>
                    <dd>+5% / Year</dd>
                    <dt>Endpoint</dt>
                    <dd>api.openai.example</dd>
                  </dl>
                </div>

                <div style={{ padding: 14, border: "1px solid var(--rule)", borderRadius: "var(--r-ctl)", backgroundColor: "var(--surface)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                    <strong>Fiat Bank Payout (Circle Mint)</strong>
                    <RailBadge rail="FIAT_PAYOUT" sub="FEDWIRE" />
                  </div>
                  <p className="bz-muted" style={{ fontSize: "0.85rem", margin: "0 0 10px" }}>
                    Fedwire payouts to Morrison & Foerster LLP ($5,200.00) and SEPA transfers to Büro Berlin Coworking ($2,100.00).
                  </p>
                  <dl className="bz-kv" style={{ fontSize: "0.85rem" }}>
                    <dt>Fedwire Speed</dt>
                    <dd>Same-day IMAD/OMAD</dd>
                    <dt>SEPA Speed</dt>
                    <dd>Instant (&lt; 30s)</dd>
                    <dt>3-Way Match</dt>
                    <dd>PO + Receipt + Inv</dd>
                  </dl>
                </div>
              </div>
            </div>
          </Panel>
        </div>
      )}
      {activeTab === "vendors" && (
        <div style={{ display: "grid", gap: 16 }}>
          <Banner tone="info" title="Rule 3: Cryptographic Payee Defense Active">
            To prevent payee substitution attacks, disbursals can only proceed to immutably locked addresses or commercial banking coordinates. Any payout modification requires an out-of-band administrative override (SPRS).
          </Banner>

          <Panel title="Verified Commercial Payees Directory">
            <DataTable
              columns={[
                {
                  key: "name",
                  header: "Vendor & Entity",
                  render: (v: T.Vendor) => (
                    <div>
                      <strong>{v.name}</strong>
                      <div className="bz-faint" style={{ fontSize: "0.8rem" }}>
                        ID: {v.vendorId} {v.taxId ? `• Tax ID: ${v.taxId}` : ""}
                      </div>
                    </div>
                  ),
                },
                {
                  key: "category",
                  header: "Category",
                  render: (v: T.Vendor) => <span className="bz-muted">{v.authorizedCategory}</span>,
                },
                {
                  key: "defense",
                  header: "Payee Defense",
                  render: (v: T.Vendor) =>
                    v.changeLock ? (
                      <Badge tone="auto">🔒 Change Locked</Badge>
                    ) : (
                      <Badge tone="danger">Unlocked</Badge>
                    ),
                },
                {
                  key: "payout",
                  header: "Verified Payout Coordinates",
                  render: (v: T.Vendor) => {
                    if (v.verifiedPayoutAddress) {
                      return <CopyChip value={v.verifiedPayoutAddress} label="onchain address" />;
                    }
                    if (v.banks && v.banks.length > 0) {
                      const b = v.banks[0];
                      return (
                        <div style={{ fontSize: "0.8rem" }}>
                          <div><strong>{b.bankName}</strong> ({b.routingMethod})</div>
                          <div className="bz-faint">Account: ••••{b.accountNumber.slice(-4)}</div>
                          <div><strong>{b.bankName}</strong> ({b.subMethod})</div>
                          <div className="bz-faint">Account: {b.accountMasked}</div>
                        </div>
                      );
                    }
                    return <span className="bz-faint">No payout coordinates</span>;
                  },
                },
                {
                  key: "rail",
                  header: "Default Rail",
                  render: (v: T.Vendor) => <RailBadge rail={v.preferredRail} />,
                },
                {
                  key: "volume",
                  header: "Trailing 30d",
                  align: "r",
                  render: (v: T.Vendor) => (
                    <span className="bz-fig" style={{ fontWeight: 600 }}>
                      {formatUsdc(v.trailing30dUsdc, { symbol: true })}
                    </span>
                  ),
                },
              ]}
              rows={VENDORS}
              rowKey={v => v.vendorId}
            />
          </Panel>
        </div>
      )}
    </div>
  );
}
