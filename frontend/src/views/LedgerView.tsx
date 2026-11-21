import React, { useState } from "react";
import { useTreasury } from "../context/TreasuryContext";
import { JournalChain, CircuitBreaker, ReadinessPillars, ActorTag, AgentChip } from "../domain";
import { Panel, Tabs, DataTable, CopyChip, type Column } from "../primitives";
import { READINESS_PILLARS, READINESS, AUDIT_SUMMARY } from "../fixtures";
import { formatUsdc } from "../money";
import type * as T from "../types";

export function LedgerView() {
  const {
    journal,
    isChainTampered,
    toggleChainTamper,
    circuitBreakerTripped,
    circuitBreakerReason,
    tripCircuitBreaker,
    resetCircuitBreaker,
    auditEvents,
  } = useTreasury();

  const [activeTab, setActiveTab] = useState<"journal" | "audit" | "readiness">("journal");

  const auditColumns: Column<T.AuditEvent>[] = [
    {
      key: "a",
      header: "Action & Reason",
      render: e => (
        <div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <strong>{e.actionType.replace(/_/g, " ")}</strong>
            <ActorTag autonomous={e.isAutonomous} />
            {e.actorAgent && <AgentChip persona={e.actorAgent} />}
          </div>
          <p style={{ margin: "4px 0 0", fontSize: "0.85rem", color: "var(--ink-2)" }}>{e.reason}</p>
        </div>
      ),
    },
    {
      key: "t",
      header: "Timestamp",
      render: e => (
        <span className="bz-faint" style={{ fontSize: "0.85rem", whiteSpace: "nowrap" }}>
          {new Date(e.createdAt).toLocaleString()}
        </span>
      ),
    },
    {
      key: "c",
      header: "Cost Center",
      render: e => <span className="bz-muted">{e.accountId.replace("acc_", "")}</span>,
    },
    {
      key: "v",
      header: "Amount (USDC)",
      align: "r",
      render: e => (
        <span className="bz-fig" style={{ fontWeight: 600 }}>
          {formatUsdc(e.amountUsdc)}
        </span>
      ),
    },
  ];

  return (
    <div style={{ display: "grid", gap: 24 }}>
      <header>
        <h2 style={{ font: "600 var(--fs-4)/1.1 var(--font-figure)", margin: 0 }}>
          Master Journal & Cryptographic Audit
        </h2>
        <p className="bz-muted" style={{ margin: "4px 0 0", maxWidth: "75ch" }}>
          Every cash sweep, yield recall, and disbursement is witnessed and appended by the Ledger Witness Agent (#105) into an immutable SHA-256 hash chain.
        </p>
      </header>

      {/* Emergency Control Breaker */}
      <CircuitBreaker
        tripped={circuitBreakerTripped}
        reason={circuitBreakerReason}
        onTrip={tripCircuitBreaker}
        onReset={resetCircuitBreaker}
      />

      <Tabs
        value={activeTab}
        onChange={setActiveTab}
        tabs={[
          { id: "journal", label: "Cryptographic Journal Chain", count: journal.length },
          { id: "audit", label: "Immutable Audit Trail", count: auditEvents.length },
          { id: "readiness", label: "Production Readiness Verification" },
        ]}
      />

      {activeTab === "journal" && (
        <Panel title="Journal Vouchers & Block Hashes">
          <JournalChain
            vouchers={journal}
            onTamperSimulate={toggleChainTamper}
            tamperedIndex={isChainTampered ? 5 : undefined}
          />
        </Panel>
      )}

      {activeTab === "audit" && (
        <div style={{ display: "grid", gap: 16 }}>
          <div
            style={{
              display: "flex",
              gap: 16,
              padding: "12px 16px",
              backgroundColor: "var(--surface)",
              border: "1px solid var(--rule)",
              borderRadius: "var(--r-sm)",
              fontSize: "0.85rem",
              flexWrap: "wrap",
            }}
          >
            <div>
              <span className="bz-faint">Verified Logs: </span>
              <strong>{AUDIT_SUMMARY.totalEventsLogged || auditEvents.length}</strong>
              <span className="bz-faint">Total Vouchers: </span>
              <strong>{AUDIT_SUMMARY.totalVouchers}</strong>
            </div>
            <div>
              <span className="bz-faint">Autonomous Actions: </span>
              <strong>{AUDIT_SUMMARY.autonomousActions}</strong>
            </div>
            <div>
              <span className="bz-faint">Human Approvals: </span>
              <strong>{AUDIT_SUMMARY.humanApprovals}</strong>
              <strong>{AUDIT_SUMMARY.humanActions}</strong>
            </div>
            <div>
              <span className="bz-faint">Head Sequence: </span>
              <strong>#{AUDIT_SUMMARY.headSequence}</strong>
            </div>
            <div>
              <span className="bz-faint">SHA-256 Anchor: </span>
              <span className="bz-mono">{AUDIT_SUMMARY.merkleRootAnchor?.slice(0, 16)}...</span>
              <span className="bz-mono">{AUDIT_SUMMARY.headHash?.slice(0, 16)}...</span>
            </div>
          </div>
          <Panel title="Autonomous & Human Audit Stream">
            <DataTable columns={auditColumns} rows={auditEvents} rowKey={e => e.logId || e.createdAt} />
          </Panel>
        </div>
      )}

      {activeTab === "readiness" && (
        <ReadinessPillars pillars={READINESS.pillars || READINESS_PILLARS} overallScore={READINESS.overallScore} />
      )}
    </div>
  );
}
