import React, { useState } from "react";
import { useTreasury } from "../context/TreasuryContext";
import { AccountCard, SafeToInvestBadge } from "../domain";
import { Panel, Button, Badge, DataTable, CopyChip, type Column } from "../primitives";
import { ACCOUNT_POLICIES, FUNDING_OPTIONS_HALCYON } from "../fixtures";
import { formatUsdc } from "../money";
import type * as T from "../types";

export function AccountsView({
  onOpenFundModal,
  onOpenTransferModal,
  onOpenCreateAccount,
  onOpenConfigAccount,
}: {
  onOpenFundModal: (account: T.AccountDistribution) => void;
  onOpenTransferModal?: () => void;
  onOpenCreateAccount?: () => void;
  onOpenConfigAccount?: (account: T.AccountDistribution) => void;
}) {
  const { accounts, shortfalls, hasShortfalls, runShortfallRebalance } = useTreasury();
  const [selectedAccountId, setSelectedAccountId] = useState<string>("acc_treasury");
  const [rebalancing, setRebalancing] = useState(false);

  const selectedAccount = accounts.find(a => a.accountId === selectedAccountId) || accounts[0];
  const selectedPolicy = ACCOUNT_POLICIES[selectedAccountId] || {
    floor: "500.000000",
    buffer: "1.20",
    perTx: "5000.000000",
    daily: "25000.000000",
    weekly: "100000.000000",
    monthly: "250000.000000",
    sweepMax: "25000.000000",
  };

  const policyColumns: Column<{ label: string; value: string; hint: string }>[] = [
    { key: "l", header: "Policy Guardrail", render: x => <strong>{x.label}</strong> },
    { key: "v", header: "Configured Threshold", align: "r", render: x => <span className="bz-fig">{x.value}</span> },
    { key: "h", header: "Enforcement Rationale", render: x => <span className="bz-faint">{x.hint}</span> },
  ];

  const policyRows = [
    { label: "Minimum Operating Floor", value: formatUsdc(selectedPolicy.floor, { symbol: true }), hint: "Sweeps halt if liquid balance breaches this floor." },
    { label: "Cash Safety Buffer Multiplier", value: `${selectedPolicy.buffer}x`, hint: "Safety cushion above committed 30-day obligations." },
    { label: "Single-Tx Human Approval Gate", value: formatUsdc(selectedPolicy.perTx, { symbol: true }), hint: "Any single transaction above this requires CFO EIP-712 signoff." },
    { label: "Daily Spending Hard Cap", value: formatUsdc(selectedPolicy.daily, { symbol: true }), hint: "Maximum cumulative daily autonomous disbursal ceiling." },
    { label: "Monthly Operating Budget", value: formatUsdc(selectedPolicy.monthly, { symbol: true }), hint: "Total authorized calendar month outflow limit." },
    { label: "Max Autonomous Sweep to USYC", value: formatUsdc(selectedPolicy.sweepMax, { symbol: true }), hint: "Sentinel single-batch limit into yield vaults." },
  ];

  return (
    <div style={{ display: "grid", gap: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h2 style={{ font: "600 var(--fs-4)/1.1 var(--font-figure)", margin: 0 }}>
            Departmental Accounts & Policy Floors
          </h2>
          <p className="bz-muted" style={{ margin: "4px 0 0", maxWidth: "75ch" }}>
            Each cost center operates on isolated onchain accounts with immutable policy rules, dedicated reserve floors, and strict spending ceilings.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {onOpenTransferModal && (
            <Button variant="secondary" onClick={onOpenTransferModal}>
              ⇄ Internal Transfer
            </Button>
          )}
          {onOpenCreateAccount && (
            <Button variant="primary" onClick={onOpenCreateAccount}>
              + New Operating Account
            </Button>
          )}
        </div>
      </div>

      {hasShortfalls && (
        <Panel
          title="⚠️ Account Shortfalls Detected"
          tone="danger"
          actions={
            <Button
              variant="primary"
              loading={rebalancing}
              onClick={async () => {
                setRebalancing(true);
                try {
                  await runShortfallRebalance();
                } finally {
                  setRebalancing(false);
                }
              }}
            >
              Auto-Recall USYC to Cover Deficit
            </Button>
          }
        >
          <p style={{ margin: 0 }}>
            One or more operating accounts have fallen below their configured reserve floor. Sentinel can autonomously liquidate invested USYC to restore liquidity.
          </p>
        </Panel>
      )}

      {/* Account Selector Cards */}
      <div className="bz-grid">
        {accounts.map(acc => {
          const isSelected = acc.accountId === selectedAccountId;
          return (
            <div
              key={acc.accountId}
              style={{
                outline: isSelected ? "2px solid var(--ink)" : "none",
                borderRadius: "var(--r-panel)",
                cursor: "pointer",
              }}
              onClick={() => setSelectedAccountId(acc.accountId)}
            >
              <AccountCard
                account={acc}
                onFund={onOpenFundModal}
                footer={
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Badge tone={isSelected ? "auto" : "neutral"}>
                      {isSelected ? "Active Inspection" : "Inspect Policies"}
                    </Badge>
                    <span className="bz-faint" style={{ fontSize: "0.8rem" }}>
                      {acc.authorizedCategories.join(", ")}
                    </span>
                  </div>
                }
              />
            </div>
          );
        })}
      </div>

      {/* Selected Account Policy Detail */}
      <Panel
        title={`Policy Specifications: ${selectedAccount.name}`}
        actions={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span className="bz-faint">{selectedAccount.role}</span>
            {onOpenConfigAccount && (
              <Button
                variant="secondary"
                style={{ padding: "4px 10px", fontSize: "0.85rem" }}
                onClick={() => onOpenConfigAccount(selectedAccount)}
              >
                ⚙ Configure Policy
              </Button>
            )}
            <Button
              variant="secondary"
              style={{ padding: "4px 10px", fontSize: "0.85rem" }}
              onClick={() => onOpenFundModal(selectedAccount)}
            >
              Deposit Instructions
            </Button>
          </div>
        }
      >
        <div style={{ display: "grid", gap: 16 }}>
          <p className="bz-muted" style={{ margin: 0 }}>
            Policy parameters derived during initial intake with Amara Okafor. Enforced in real time by the Policy Compliance Agent (#104).
          </p>
          <DataTable columns={policyColumns} rows={policyRows} rowKey={x => x.label} />
        </div>
      </Panel>
    </div>
  );
}
