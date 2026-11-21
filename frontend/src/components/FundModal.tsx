import React, { useState } from "react";
import { useTreasury } from "../context/TreasuryContext";
import { Button, Banner, CopyChip, Tabs, Field, UsdcInput } from "../primitives";
import { FUNDING_OPTIONS_HALCYON } from "../fixtures";
import { formatUsdc } from "../money";
import type * as T from "../types";

export function FundModal({
  account,
  onClose,
}: {
  account: T.AccountDistribution;
  onClose: () => void;
}) {
  const { fundAccount } = useTreasury();
  const [tab, setTab] = useState<"fedwire" | "ach" | "sepa" | "crypto">("fedwire");
  const [depositAmt, setDepositAmt] = useState("10000.000000");
  const [simulated, setSimulated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const funding = FUNDING_OPTIONS_HALCYON;
  const memo = `BIZARC-MINT-${account.accountId.toUpperCase()}-01`;

  const handleSimulateDeposit = async () => {
    try {
      setLoading(true);
      setError(null);
      await fundAccount(account.accountId, depositAmt, tab.toUpperCase());
      setSimulated(true);
      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err: any) {
      setError(err.message || "Failed to execute deposit.");
    } finally {
      setLoading(false);
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
          <div>
            <h3 style={{ margin: 0, font: "600 var(--fs-2) var(--font-figure)" }}>
              Fund Cost Center: {account.name}
            </h3>
            <span className="bz-faint" style={{ fontSize: "0.85rem" }}>
              Circle Mint & Arc L1 Gateway
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
          {error && (
            <Banner tone="danger" title="Deposit Failed">
              {error}
            </Banner>
          )}

          {simulated && (
            <Banner tone="auto" title="Inbound Deposit Ingested">
              Inbound transfer credited to {account.name}.
            </Banner>
          )}

          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "fedwire", label: "Fedwire (USD)" },
              { id: "ach", label: "ACH (USD)" },
              { id: "sepa", label: "SEPA (EUR)" },
              { id: "crypto", label: "Arc L1 Native" },
            ]}
          />

          {tab === "fedwire" && (
            <div style={{ display: "grid", gap: 12 }}>
              <Banner tone="info" title="Mandatory Wire Memo">
                You MUST include the tracking memo below in field 10 of your wire instructions. Incoming wires are automatically minted as USDC directly into {account.name}.
              </Banner>
              <dl className="bz-kv" style={{ fontSize: "0.9rem" }}>
                <dt>Beneficiary</dt>
                <dd>{funding.fiat.fedwire.beneficiary}</dd>
                <dt>Bank Name</dt>
                <dd>{funding.fiat.fedwire.bank}</dd>
                <dt>Routing (ABA)</dt>
                <dd><CopyChip value={funding.fiat.fedwire.routing} label="routing number" /></dd>
                <dt>Account Number</dt>
                <dd><CopyChip value={funding.fiat.fedwire.account} label="account number" /></dd>
                <dt>Tracking Memo</dt>
                <dd><CopyChip value={memo} label="tracking memo" /></dd>
                <dt>Settlement Speed</dt>
                <dd>{funding.fiat.fedwire.speed}</dd>
              </dl>
            </div>
          )}

          {tab === "ach" && (
            <div style={{ display: "grid", gap: 12 }}>
              <dl className="bz-kv" style={{ fontSize: "0.9rem" }}>
                <dt>Beneficiary</dt>
                <dd>{funding.fiat.fedwire.beneficiary}</dd>
                <dt>Routing (ABA)</dt>
                <dd><CopyChip value={funding.fiat.ach.routing} label="routing number" /></dd>
                <dt>Account Number</dt>
                <dd><CopyChip value={funding.fiat.ach.account} label="account number" /></dd>
                <dt>Memo</dt>
                <dd><CopyChip value={memo} label="memo" /></dd>
                <dt>Settlement Speed</dt>
                <dd>{funding.fiat.ach.speed}</dd>
              </dl>
            </div>
          )}

          {tab === "sepa" && (
            <div style={{ display: "grid", gap: 12 }}>
              <dl className="bz-kv" style={{ fontSize: "0.9rem" }}>
                <dt>IBAN</dt>
                <dd><CopyChip value={funding.fiat.sepa.iban} label="IBAN" /></dd>
                <dt>BIC / SWIFT</dt>
                <dd>{funding.fiat.sepa.bic}</dd>
                <dt>Payment Reference</dt>
                <dd><CopyChip value={memo} label="reference" /></dd>
                <dt>Settlement Speed</dt>
                <dd>{funding.fiat.sepa.speed}</dd>
              </dl>
            </div>
          )}

          {tab === "crypto" && (
            <div style={{ display: "grid", gap: 12 }}>
              <Banner tone="info" title="Arc L1 Network Direct Deposit">
                Send native USDC on Arc Testnet (Chain ID 5042002). Transactions settle in sub-second blocks with zero gas volatility.
              </Banner>
              <dl className="bz-kv" style={{ fontSize: "0.9rem" }}>
                <dt>Network</dt>
                <dd>Arc L1 Testnet</dd>
                <dt>Account Wallet</dt>
                <dd><CopyChip value={account.address} label="account address" /></dd>
                <dt>Accepted Asset</dt>
                <dd>USDC (Native Gas)</dd>
              </dl>
            </div>
          )}

          <div
            style={{
              paddingTop: 14,
              borderTop: "1px solid var(--rule)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <Button variant="secondary" onClick={handleSimulateDeposit}>
              Simulate Inbound Deposit (+{formatUsdc(depositAmt, { symbol: true })})
            </Button>
            <Button variant="quiet" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
