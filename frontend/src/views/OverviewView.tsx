import React from "react";
import { useTreasury } from "../context/TreasuryContext";
import {
  TripartiteEquation,
  AccountCard,
  SafeToInvestBadge,
  ActorTag,
  AgentChip,
  LiabilityTable,
  AGENTS,
} from "../domain";
import { Panel, Banner, Button, Badge } from "../primitives";
import { formatUsdc, toMicro } from "../money";

export function OverviewView({
  onOpenLiability,
  onOpenSweepModal,
  onOpenFundModal,
}: {
  onOpenLiability: (liability: any) => void;
  onOpenSweepModal: () => void;
  onOpenFundModal: (account: any) => void;
}) {
  const {
    accounts,
    totalLiquid,
    totalInvested,
    totalEffective,
    safeToInvestTotal,
    liabilities,
    pendingSprs,
    setActiveView,
    circuitBreakerTripped,
    circuitBreakerReason,
  } = useTreasury();

  const nextLiabilities = liabilities
    .filter(l => ["SCHEDULED", "AWAITING_APPROVAL", "FROZEN"].includes(l.status))
    .slice(0, 5);

  const pendingGatesCount = pendingSprs.length;

  return (
    <div style={{ display: "grid", gap: 24 }}>
      {/* Emergency Stop Banner if Tripped */}
      {circuitBreakerTripped && (
        <Banner tone="danger" title="EMERGENCY CIRCUIT BREAKER ACTIVATED">
          {circuitBreakerReason || "Autonomous activities across Sentinel, Radar, and Router have been halted."}
        </Banner>
      )}

      {/* Critical Attention Banner for Human Gates / SPRS */}
      {pendingGatesCount > 0 && (
        <Banner
          tone="gate"
          title={`${pendingGatesCount} Standardized Permission Requests (SPRS) Require Approval`}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
            <span>
              Out-of-policy actions (including an invoice payee address mismatch and single-tx cap escalations) are frozen waiting for CFO signature.
            </span>
            <Button
              variant="secondary"
              style={{ fontSize: "0.85rem", padding: "4px 12px" }}
              onClick={() => setActiveView("approvals")}
            >
              Review Queue
            </Button>
          </div>
        </Banner>
      )}

      {/* Primary Solvency Equation Card */}
      <Panel
        title="Halcyon Treasury Solvency & Liquidity"
        actions={
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Badge tone="auto">Invariant Verified</Badge>
            <span className="bz-faint" style={{ fontSize: "0.85rem" }}>Arc L1 Native</span>
          </div>
        }
      >
        <div style={{ display: "grid", gap: 16 }}>
          <TripartiteEquation
            liquid={totalLiquid}
            invested={totalInvested}
            total={totalEffective}
            onSweepQuick={toMicro(safeToInvestTotal) > 0n ? onOpenSweepModal : undefined}
          />

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: 16,
              paddingTop: 12,
              borderTop: "1px solid var(--rule)",
            }}
          >
            <div>
              <span className="bz-faint" style={{ fontSize: "var(--fs-0)", display: "block" }}>
                30-Day Committed Burn
              </span>
              <strong className="bz-fig" style={{ fontSize: "var(--fs-2)", color: "var(--ink)" }}>
                $133,400.63
              </strong>
            </div>

            <div>
              <span className="bz-faint" style={{ fontSize: "var(--fs-0)", display: "block" }}>
                Protected Reserve Floor
              </span>
              <strong className="bz-fig" style={{ fontSize: "var(--fs-2)", color: "var(--ink)" }}>
                $196,062.60
              </strong>
            </div>

            <div>
              <span className="bz-faint" style={{ fontSize: "var(--fs-0)", display: "block" }}>
                Surplus Ready to Invest
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <strong className="bz-fig" style={{ fontSize: "var(--fs-2)", color: "var(--invested)" }}>
                  {formatUsdc(safeToInvestTotal, { symbol: true })}
                </strong>
                <SafeToInvestBadge status="SAFE_TO_INVEST" />
              </div>
            </div>

            <div>
              <span className="bz-faint" style={{ fontSize: "var(--fs-0)", display: "block" }}>
                Active APY in USYC
              </span>
              <strong className="bz-fig" style={{ fontSize: "var(--fs-2)", color: "var(--auto)" }}>
                5.12% Net
              </strong>
            </div>
          </div>
        </div>
      </Panel>

      {/* Departmental Account Distribution Cards */}
      <section style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div>
            <h3 style={{ font: "600 var(--fs-3)/1.2 var(--font-figure)", margin: 0 }}>
              Departmental Cost Centers
            </h3>
            <p className="bz-muted" style={{ margin: "2px 0 0", fontSize: "0.9rem" }}>
              Independent operating reserves, policy thresholds, and protected payroll escrows.
            </p>
          </div>
          <Button variant="quiet" onClick={() => setActiveView("accounts")}>
            View Account Policies →
          </Button>
        </div>

        <div className="bz-grid">
          {accounts.map(acc => {
            const status =
              acc.accountId === "acc_payroll"
                ? "BALANCED"
                : toMicro(acc.safeToInvestUsdc) > 0n
                ? "SAFE_TO_INVEST"
                : "BALANCED";

            return (
              <AccountCard
                key={acc.accountId}
                account={acc}
                onFund={onOpenFundModal}
                footer={
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                    <SafeToInvestBadge status={status} />
                    <span className="bz-faint" style={{ fontSize: "0.8rem" }}>
                      Cap: {acc.role === "PAYROLL" ? "Shielded" : "$25,000/day"}
                    </span>
                  </div>
                }
              />
            );
          })}
        </div>
      </section>

      {/* Upcoming Liabilities & Disbursals */}
      <section style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <div>
            <h3 style={{ font: "600 var(--fs-3)/1.2 var(--font-figure)", margin: 0 }}>
              Upcoming Obligations & Payment Rails
            </h3>
            <p className="bz-muted" style={{ margin: "2px 0 0", fontSize: "0.9rem" }}>
              Settling via Disbursal Vault, Session Keys, ERC-3009, x402, and Fedwire/SEPA payouts.
            </p>
          </div>
          <Button variant="quiet" onClick={() => setActiveView("bills")}>
            Full Obligations Ledger ({liabilities.length}) →
          </Button>
        </div>

        <Panel>
          <LiabilityTable rows={nextLiabilities} onOpen={onOpenLiability} />
        </Panel>
      </section>

      {/* Active Autonomous Agent Swarm Strip */}
      <section style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h4 style={{ margin: 0, fontSize: "var(--fs-1)", fontWeight: 600, color: "var(--ink)" }}>
            Autonomous Agent Swarm Status
          </h4>
          <span className="bz-faint" style={{ fontSize: "0.85rem" }}>
            Swarm session #20261014 · 6 agents active
          </span>
        </div>

        <div
          style={{
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            padding: 12,
            backgroundColor: "var(--surface)",
            border: "1px solid var(--rule)",
            borderRadius: "var(--r-panel)",
            alignItems: "center",
          }}
        >
          <ActorTag autonomous={true} />
          {(Object.keys(AGENTS) as any[]).map(p => (
            <AgentChip key={p} persona={p} />
          ))}
          <div style={{ marginLeft: "auto" }}>
            <Button variant="quiet" style={{ padding: "4px 8px", fontSize: "0.8rem" }} onClick={() => setActiveView("agents")}>
              Inspect Swarm Logs →
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
