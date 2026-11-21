import React, { useState } from "react";
import { useTreasury } from "../context/TreasuryContext";
import { AgentChip, ActorTag, AGENTS } from "../domain";
import { Panel, Tabs, Badge, DataTable, CopyChip, type Column } from "../primitives";
import { AGENT_STATUS, AGENT_EVENTS, EPISODES, HEALTH_OK } from "../fixtures";
import { formatUsdc } from "../money";
import type * as T from "../types";

export function AgentsView() {
  const [activeTab, setActiveTab] = useState<"agents" | "events" | "episodes">("agents");

  const eventColumns: Column<T.AgentEvent>[] = [
    {
      key: "s",
      header: "Seq & Time",
      render: e => (
        <div>
          <strong className="bz-fig">#{e.eventSeq}</strong>
          <div className="bz-faint" style={{ fontSize: "0.75rem" }}>
            {new Date(e.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </div>
        </div>
      ),
    },
    {
      key: "a",
      header: "Agent Persona",
      render: e => <AgentChip persona={e.agentName as T.AgentPersona} />,
    },
    {
      key: "t",
      header: "Event Type",
      render: e => {
        const toneMap: Record<string, any> = {
          LLM_DELIBERATION: "info",
          TOOL_CALLED: "neutral",
          TOOL_RESULT: "auto",
          INVARIANT_CHECK: "auto",
          SYSTEM_INTERRUPT: "danger",
          STATE_MUTATION: "invested",
        };
        return <Badge tone={toneMap[e.eventType] || "neutral"}>{e.eventType}</Badge>;
      },
    },
    {
      key: "c",
      header: "Content & Deliberation",
      render: e => (
        <div style={{ maxWidth: "60ch" }}>
          <span style={{ fontSize: "0.85rem", color: "var(--ink)" }}>{e.content}</span>
          {e.txHash && (
            <div style={{ marginTop: 4 }}>
              <CopyChip value={e.txHash} label="tx hash" />
            </div>
          )}
        </div>
      ),
    },
    {
      key: "v",
      header: "Amount",
      align: "r",
      render: e => (e.amountUsdc ? <strong className="bz-fig">{formatUsdc(e.amountUsdc)}</strong> : <span className="bz-faint">—</span>),
    },
  ];

  return (
    <div style={{ display: "grid", gap: 24 }}>
      <header>
        <h2 style={{ font: "600 var(--fs-4)/1.1 var(--font-figure)", margin: 0 }}>
          Autonomous Agent Swarm Monitor
        </h2>
        <p className="bz-muted" style={{ margin: "4px 0 0", maxWidth: "75ch" }}>
          Six specialized agents operate under strict mathematical policies. Ledger Witness (#105) holds exclusive ledger write authority; only Sentinel, Onboarding, and Router possess signing keys.
        </p>
      </header>

      {/* Operational Health Status */}
      <div
        style={{
          display: "flex",
          gap: 16,
          padding: "12px 16px",
          backgroundColor: "var(--surface)",
          border: "1px solid var(--rule)",
          borderRadius: "var(--r-sm)",
          fontSize: "0.85rem",
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontWeight: 600, color: "var(--ink)" }}>System Health:</span>
        <Badge tone={HEALTH_OK.status === "HEALTHY" ? "auto" : "danger"}>
          {HEALTH_OK.status}
        </Badge>
        <span className="bz-faint">
          Uptime: {Math.floor(HEALTH_OK.uptimeSeconds / 86400)}d {Math.floor((HEALTH_OK.uptimeSeconds % 86400) / 3600)}h
        </span>
        {HEALTH_OK.checks.map(c => (
          <div key={c.name} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span className="bz-faint">{c.name}:</span>
            <Badge tone={c.ok ? "auto" : "danger"}>
              {c.ok ? (c.latencyMs ? `${c.latencyMs}ms` : "OK") : "FAIL"}
            </Badge>
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="bz-faint">Arc L1 RPC:</span>
          <Badge tone="auto">{HEALTH_OK.arcRpcFinality}</Badge>
          <span className="bz-faint">Circuit Breaker:</span>
          <Badge tone={HEALTH_OK.circuitBreaker.tripped ? "danger" : "auto"}>
            {HEALTH_OK.circuitBreaker.tripped ? "TRIPPED" : "ARMED"}
          </Badge>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="bz-faint">Circle Mint API:</span>
          <Badge tone="auto">{HEALTH_OK.circleMintApi}</Badge>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="bz-faint">DB Pool:</span>
          <Badge tone="auto">{HEALTH_OK.dbConnectionPool}</Badge>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="bz-faint">MCP Connectors:</span>
          <Badge tone="neutral">{HEALTH_OK.mcpRegistry}</Badge>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span className="bz-faint">Solvency Status:</span>
          <Badge tone="invested">{HEALTH_OK.solvencyStatus}</Badge>
        </div>
      </div>

      <Tabs
        value={activeTab}
        onChange={setActiveTab}
        tabs={[
          { id: "agents", label: "Agent Personas & Authorities", count: AGENT_STATUS.length },
          { id: "events", label: "Swarm Event Stream", count: AGENT_EVENTS.length },
          { id: "episodes", label: "Compaction Episodes & Memory", count: EPISODES.length },
        ]}
      />

      {activeTab === "agents" && (
        <div className="bz-grid">
          {AGENT_STATUS.map(s => {
            const meta = AGENTS[s.persona];
            const stateTone: Record<string, any> = {
              WORKING: "auto",
              IDLE: "neutral",
              BLOCKED: "danger",
              OFFLINE: "neutral",
            };

            return (
              <Panel
                key={s.persona}
                title={
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span>{meta.label}</span>
                    <span className="bz-faint" style={{ fontSize: "0.8rem" }}>
                      #{meta.id}
                    </span>
                  </div>
                }
                actions={<Badge tone={stateTone[s.state]}>{s.state}</Badge>}
              >
                <div style={{ display: "grid", gap: 12 }}>
                  <p className="bz-muted" style={{ margin: 0, fontSize: "0.9rem" }}>
                    {meta.role}
                  </p>

                  <div
                    style={{
                      display: "flex",
                      gap: 6,
                      flexWrap: "wrap",
                      fontSize: "0.8rem",
                      padding: "8px 0",
                      borderTop: "1px solid var(--rule)",
                      borderBottom: "1px solid var(--rule)",
                    }}
                  >
                    <Badge tone={meta.signs ? "gate" : "neutral"} hollow>
                      {meta.signs ? "Can Sign Transactions" : "Cannot Sign"}
                    </Badge>
                    <Badge tone={meta.writesLedger ? "invested" : "neutral"} hollow>
                      {meta.writesLedger ? "Writes Ledger" : "Read-Only Ledger"}
                    </Badge>
                  </div>

                  <dl className="bz-kv" style={{ fontSize: "0.85rem" }}>
                    <dt>Actions (24h)</dt>
                    <dd>{s.actions24h}</dd>
                    <dt>Last Action</dt>
                    <dd style={{ maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {s.lastAction}
                    </dd>
                    <dt>Active State</dt>
                    <dd>{s.state}</dd>
                  </dl>
                </div>
              </Panel>
            );
          })}
        </div>
      )}

      {activeTab === "events" && (
        <Panel title="Swarm Real-Time Telemetry & LLM Deliberations">
          <DataTable columns={eventColumns} rows={AGENT_EVENTS} rowKey={e => e.id} />
        </Panel>
      )}

      {activeTab === "episodes" && (
        <div style={{ display: "grid", gap: 16 }}>
          {EPISODES.map(ep => (
            <Panel
              key={ep.episodeIndex}
              title={`Episode #${ep.episodeIndex}: Events ${ep.startSeq}–${ep.endSeq}`}
              actions={
                <span className="bz-faint" style={{ fontSize: "0.85rem" }}>
                  {new Date(ep.createdAt).toLocaleString()}
                </span>
              }
            >
              <div style={{ display: "grid", gap: 12 }}>
                <p style={{ margin: 0, fontSize: "0.95rem", color: "var(--ink)" }}>{ep.narrativeSummary}</p>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                    gap: 12,
                    padding: 12,
                    backgroundColor: "var(--sunken)",
                    borderRadius: "var(--r-ctl)",
                  }}
                >
                  <div>
                    <span className="bz-faint" style={{ fontSize: "0.75rem", display: "block" }}>
                      Cash Anchor (B_L)
                    </span>
                    <strong className="bz-fig">{formatUsdc(ep.anchors.liquidCashUsdc)}</strong>
                  </div>
                  <div>
                    <span className="bz-faint" style={{ fontSize: "0.75rem", display: "block" }}>
                      Yield Anchor (B_Y)
                    </span>
                    <strong className="bz-fig">{formatUsdc(ep.anchors.investedYieldUsdc)}</strong>
                  </div>
                  <div>
                    <span className="bz-faint" style={{ fontSize: "0.75rem", display: "block" }}>
                      Effective Anchor (B_E)
                    </span>
                    <strong className="bz-fig">{formatUsdc(ep.anchors.availableBalanceUsdc)}</strong>
                  </div>
                  <div>
                    <span className="bz-faint" style={{ fontSize: "0.75rem", display: "block" }}>
                      Invariant Solvency
                    </span>
                    <span style={{ color: "var(--auto)", fontWeight: 600 }}>
                      {ep.anchors.invariantCheckPassed ? "✓ Verified" : "Failed"}
                    </span>
                  </div>
                </div>
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
