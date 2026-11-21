import React, { useState } from "react";
import { useTreasury } from "../context/TreasuryContext";
import { SprCard, WaterfallPlan, type SprDecision } from "../domain";
import { Panel, Tabs, Banner, EmptyState } from "../primitives";
import { ROUTE_WATERFALL, ROUTE_REJECTED } from "../fixtures";
import { formatUsdc } from "../money";

export function ApprovalsView() {
  const { pendingSprs, decidedSprs, decideSpr } = useTreasury();
  const [tab, setTab] = useState<"pending" | "waterfall" | "history">("pending");
  const [waterfallMode, setWaterfallMode] = useState<"qualified" | "rejected">("qualified");

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <header>
        <h2 style={{ font: "600 var(--fs-4)/1.1 var(--font-figure)", margin: 0 }}>
          Standardized Permission Requests (SPRS)
        </h2>
        <p className="bz-muted" style={{ margin: "4px 0 0", maxWidth: "75ch" }}>
          Human approval gates for actions outside policy boundaries: invoice anomalies, payee substitutions, single-transaction threshold exemptions, and cross-account draws.
        </p>
      </header>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "pending", label: "Pending Approvals", count: pendingSprs.length },
          { id: "waterfall", label: "Multi-Account Waterfall Simulation" },
          { id: "history", label: "Approval History", count: decidedSprs.length },
        ]}
      />

      {tab === "pending" && (
        <div style={{ display: "grid", gap: 16 }}>
          {pendingSprs.length === 0 ? (
            <EmptyState
              title="All caught up"
              children="No pending approvals. Autonomous agents are operating within designated policy caps."
            />
          ) : (
            <>
              <Banner tone="info" title="Human-in-the-Loop Safeguards Active">
                Approvals require an EIP-712 administrative signature from an authorized CFO wallet. Cancellations require a mandatory rationale saved to the immutable audit trail.
              </Banner>
              <div style={{ display: "grid", gap: 16 }}>
                {pendingSprs.map(spr => (
                  <SprCard
                    key={spr.requestId}
                    request={spr}
                    onDecide={async (d: SprDecision) => {
                      if (d.decision === "APPROVE") {
                        await decideSpr(spr.requestId, "APPROVE", undefined, d.adminSignature);
                      } else {
                        await decideSpr(spr.requestId, "CANCEL_WITH_INSTRUCTIONS", d.instructions);
                      }
                    }}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {tab === "waterfall" && (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: "var(--fs-0)", color: "var(--ink-2)", fontWeight: 600 }}>
              Test Scenario:
            </span>
            <button
              className="bz-btn"
              data-v={waterfallMode === "qualified" ? "primary" : "secondary"}
              style={{ padding: "4px 12px", fontSize: "0.85rem" }}
              onClick={() => setWaterfallMode("qualified")}
            >
              Multi-Account Waterfall (AWS $14,210.50)
            </button>
            <button
              className="bz-btn"
              data-v={waterfallMode === "rejected" ? "primary" : "secondary"}
              style={{ padding: "4px 12px", fontSize: "0.85rem" }}
              onClick={() => setWaterfallMode("rejected")}
            >
              Rejected Route (Shortfall $127,419.75)
            </button>
          </div>

          <WaterfallPlan
            route={waterfallMode === "qualified" ? ROUTE_WATERFALL : ROUTE_REJECTED}
          />
        </div>
      )}

      {tab === "history" && (
        <div style={{ display: "grid", gap: 16 }}>
          {decidedSprs.length === 0 ? (
            <EmptyState title="No historical decisions yet" />
          ) : (
            decidedSprs.map(spr => (
              <SprCard
                key={spr.requestId}
                request={spr}
                onDecide={async () => {}}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
