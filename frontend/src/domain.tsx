import { useState, type ReactNode } from "react";
import {
  Badge,
  Banner,
  Button,
  CopyChip,
  DataTable,
  Field,
  Meter,
  Panel,
  Select,
  Switch,
  TextInput,
  UsdcInput,
  type Column,
  type Tone,
} from "./primitives";
import { formatUsdc, pctOf, toMicro, fromMicro } from "./money";
import type * as T from "./types";

/* ───────── Status vocabulary ───────── */
const LIAB: Record<T.LiabilityStatus, [Tone, string]> = {
  SCHEDULED: ["info", "Scheduled"],
  AWAITING_APPROVAL: ["gate", "Needs approval"],
  DISBURSED: ["liquid", "Paid, settling"],
  SETTLED: ["auto", "Settled"],
  CANCELLED: ["neutral", "Cancelled"],
  FROZEN: ["danger", "Frozen"],
  UNMATCHED_DISPUTED: ["danger", "Disputed: no match"],
};

const SPR: Record<T.SprStatus, [Tone, string]> = {
  PENDING: ["gate", "Waiting for you"],
  APPROVED: ["auto", "Approved"],
  REJECTED: ["danger", "Rejected"],
  CANCELLED_WITH_INSTRUCTIONS: ["neutral", "Cancelled with instructions"],
  EXECUTED: ["auto", "Executed"],
};

export const LiabilityStatusBadge = ({ status }: { status: T.LiabilityStatus }) => (
  <Badge tone={LIAB[status]?.[0] ?? "neutral"}>{LIAB[status]?.[1] ?? status}</Badge>
);

export const SprStatusBadge = ({ status }: { status: T.SprStatus }) => (
  <Badge tone={SPR[status]?.[0] ?? "neutral"}>{SPR[status]?.[1] ?? status}</Badge>
);

export const SPR_ACTION_LABEL: Record<T.SprActionType, string> = {
  DISBURSEMENT_PAYMENT: "Payment to vendor",
  MULTI_HOP_SUBSCRIPTION_SETTLEMENT: "Subscription settlement",
  CROSS_ACCOUNT_REBALANCE: "Move money between accounts",
  UNREGISTERED_VENDOR_ADDITION: "Add a new vendor",
  HIGH_VALUE_SWEEP_EXEMPTION: "Large sweep to yield",
};

/** Every action in the product is either the agent acting alone (inside the rules) or a human gate (outside them). */
export const ActorTag = ({ autonomous }: { autonomous: boolean }) =>
  autonomous ? (
    <Badge tone="auto">Agent acted alone</Badge>
  ) : (
    <Badge tone="gate" hollow>
      Human approved
    </Badge>
  );

export const RAIL_LABEL: Record<T.PaymentRail, string> = {
  DISBURSAL_VAULT: "Disbursal vault",
  MODULAR_SESSION_KEY: "Session key",
  ERC3009_AUTHORIZATION: "Signed authorization",
  GATEWAY_X402: "Pay-per-call (x402)",
  FIAT_PAYOUT: "Bank payout",
};

export const FIAT_LABEL: Record<T.FiatSubMethod, string> = {
  FEDWIRE: "Fedwire",
  ACH: "ACH",
  PUSH_TO_CARD: "Push to card",
  SEPA: "SEPA",
  SWIFT: "SWIFT",
};

export const RailBadge = ({ rail, sub }: { rail: T.PaymentRail; sub?: T.FiatSubMethod }) => (
  <Badge tone={rail === "FIAT_PAYOUT" ? "info" : "neutral"} hollow>
    {RAIL_LABEL[rail]}
    {sub ? ` · ${FIAT_LABEL[sub]}` : ""}
  </Badge>
);

export const AGENTS: Record<
  T.AgentPersona,
  { id: number; label: string; role: string; signs: boolean; writesLedger: boolean }
> = {
  OnboardingAgent: { id: 100, label: "Onboarding", role: "Sets up accounts and policies", signs: true, writesLedger: false },
  TreasurySentinelAgent: { id: 101, label: "Sentinel", role: "Sweeps idle cash to yield, recalls it when needed", signs: true, writesLedger: false },
  LiabilityRadarAgent: { id: 102, label: "Radar", role: "Watches subscriptions and bills", signs: false, writesLedger: false },
  DisbursalRouterAgent: { id: 103, label: "Router", role: "Chooses which accounts pay a bill", signs: true, writesLedger: false },
  PolicyComplianceAgent: { id: 104, label: "Compliance", role: "Issues clearances, asks humans when out of policy", signs: false, writesLedger: false },
  LedgerWitnessAgent: { id: 105, label: "Witness", role: "Independently verifies and records every entry", signs: false, writesLedger: true },
};

export function AgentChip({ persona }: { persona: T.AgentPersona }) {
  const a = AGENTS[persona] ?? { id: 999, label: persona, role: "Agent", signs: false, writesLedger: false };
  return (
    <span
      title={`${a.role}. ${a.signs ? "Can sign transactions." : "Cannot sign."} ${
        a.writesLedger ? "Only agent that writes the ledger." : ""
      }`}
    >
      <Badge tone="neutral" hollow>
        {a.label} #{a.id}
      </Badge>
    </span>
  );
}

/* ───────── Balances: B_E = B_L + B_Y ───────── */
export function TripartiteEquation({
  liquid,
  invested,
  total,
  onSweepQuick,
}: {
  liquid: string;
  invested: string;
  total: string;
  onSweepQuick?: () => void;
}) {
  const sum = fromMicro(toMicro(liquid) + toMicro(invested));
  const ok = toMicro(sum) === toMicro(total);
  const liquidPct = pctOf(liquid, total);
  const investedPct = pctOf(invested, total);

  return (
    <div className="bz-eq">
      {!ok && (
        <Banner tone="danger" title="Balances do not reconcile">
          Available ({formatUsdc(total)}) differs from cash on hand ({formatUsdc(liquid)}) + invested in USYC ({formatUsdc(invested)}). Autonomous sweeps are halted until discrepancy is resolved.
        </Banner>
      )}
      <div className="bz-eq-row">
        <div className="bz-eq-term">
          <small>Total effective available (B_E)</small>
          <span className="v bz-fig bz-total">{formatUsdc(total, { symbol: true })}</span>
        </div>
        <span className="bz-eq-op" aria-hidden="true">
          =
        </span>
        <div className="bz-eq-term">
          <small>Liquid cash on hand (B_L)</small>
          <span className="v bz-fig" style={{ color: "var(--liquid)" }}>
            {formatUsdc(liquid, { symbol: true })}
          </span>
        </div>
        <span className="bz-eq-op" aria-hidden="true">
          +
        </span>
        <div className="bz-eq-term">
          <small>Earning yield in USYC (B_Y)</small>
          <span className="v bz-fig" style={{ color: "var(--invested)" }}>
            {formatUsdc(invested, { symbol: true })}
          </span>
        </div>
        {onSweepQuick && (
          <div style={{ marginLeft: "auto", alignSelf: "flex-end" }}>
            <Button variant="secondary" onClick={onSweepQuick}>
              Simulate Sweep to Yield
            </Button>
          </div>
        )}
      </div>

      <div
        className="bz-bar"
        role="img"
        aria-label={`${liquidPct.toFixed(1)}% cash, ${investedPct.toFixed(1)}% invested`}
      >
        <i style={{ width: `${liquidPct}%` }} />
        <i style={{ width: `${investedPct}%` }} />
      </div>

      <div className="bz-legend">
        <span>
          <i style={{ background: "var(--liquid)" }} />
          Cash ({liquidPct.toFixed(1)}%)
        </span>
        <span>
          <i style={{ background: "var(--invested)" }} />
          Invested USYC ({investedPct.toFixed(1)}%)
        </span>
        <span style={{ marginLeft: "auto", color: "var(--ink-3)" }}>
          Network: Arc L1 Testnet (5042002)
        </span>
      </div>
    </div>
  );
}

export const SafeToInvestBadge = ({ status }: { status: T.SafeToInvestStatus }) =>
  status === "SAFE_TO_INVEST" ? (
    <Badge tone="invested">Surplus ready to invest</Badge>
  ) : status === "RECALL_REQUIRED" ? (
    <Badge tone="gate">Needs cash recalled</Badge>
  ) : (
    <Badge tone="auto">Balanced</Badge>
  );

export function AccountCard({
  account: a,
  footer,
  onFund,
}: {
  account: T.AccountDistribution;
  footer?: ReactNode;
  onFund?: (account: T.AccountDistribution) => void;
}) {
  return (
    <Panel
      title={a.name}
      actions={
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span className="bz-faint">{a.role.replace(/_/g, " ").toLowerCase()}</span>
          {onFund && (
            <Button variant="quiet" style={{ padding: "2px 8px", fontSize: "0.8rem" }} onClick={() => onFund(a)}>
              Fund
            </Button>
          )}
        </div>
      }
    >
      <div style={{ display: "grid", gap: 14 }}>
        <TripartiteEquation liquid={a.liquidUsdc} invested={a.investedUsyc} total={a.totalEffectiveUsdc} />
        <dl className="bz-kv">
          <dt>Due in 30 days</dt>
          <dd>{formatUsdc(a.committedLiabilities30dUsdc)}</dd>
          <dt>Held back as reserve</dt>
          <dd>{formatUsdc(a.protectedReserveUsdc)}</dd>
          <dt>Free to use</dt>
          <dd>
            <strong>{formatUsdc(a.freeCapitalUsdc)}</strong>
          </dd>
          <dt>Safe to invest</dt>
          <dd>{formatUsdc(a.safeToInvestUsdc)}</dd>
        </dl>
        {a.excludeFromWaterfall && (
          <div className="bz-shield">
            <strong>Payroll shield active.</strong>{" "}
            <span className="bz-muted">Other bills can never draw from this escrow account.</span>
          </div>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span className="bz-muted">{a.chain}</span>
          <CopyChip value={a.address} label="wallet address" />
          {!a.isActive && <Badge tone="danger">Inactive</Badge>}
        </div>
        {footer}
      </div>
    </Panel>
  );
}

/* ───────── Liabilities Table ───────── */
export function LiabilityTable({
  rows,
  onOpen,
}: {
  rows: T.Liability[];
  onOpen?: (l: T.Liability) => void;
}) {
  const cols: Column<T.Liability>[] = [
    {
      key: "t",
      header: "Bill & Vendor",
      render: l => (
        <>
          <button
            className="bz-btn"
            data-v="quiet"
            style={{ padding: 0, fontWeight: 600, color: "var(--ink)", textAlign: "left" }}
            onClick={() => onOpen?.(l)}
          >
            {l.title}
          </button>
          <div className="bz-faint" style={{ fontSize: "0.8rem" }}>
            {l.vendorId.replace("vendor_", "").replace(/_/g, " ")} · {l.category}
          </div>
        </>
      ),
    },
    {
      key: "d",
      header: "Due Date",
      render: l => (
        <span style={{ color: l.isOverdue ? "var(--danger)" : undefined, fontWeight: l.isOverdue ? 600 : 400 }}>
          {new Date(l.dueDate).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
          {l.isOverdue && " (overdue)"}
        </span>
      ),
    },
    {
      key: "r",
      header: "Payment Rail",
      render: l => (l.rail ? <RailBadge rail={l.rail} /> : <span className="bz-faint">Not set</span>),
    },
    {
      key: "s",
      header: "Status",
      render: l => <LiabilityStatusBadge status={l.status} />,
    },
    {
      key: "a",
      header: "Amount (USDC)",
      align: "r",
      render: l => <span className="bz-fig">{formatUsdc(l.amountUsdc)}</span>,
    },
  ];
  return <DataTable columns={cols} rows={rows} rowKey={l => l.liabilityId} />;
}

/* ───────── Human Gate: Standardized Permission Request (SPRS) ───────── */
export type SprDecision =
  | { decision: "APPROVE"; adminSignature?: string }
  | { decision: "CANCEL_WITH_INSTRUCTIONS"; instructions: string };

export function SprCard({
  request: r,
  onDecide,
}: {
  request: T.PermissionRequest;
  onDecide: (d: SprDecision) => Promise<void>;
}) {
  const [mode, setMode] = useState<"idle" | "cancel">("idle");
  const [memo, setMemo] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [approvedSig, setApprovedSig] = useState<string>();

  const run = async (d: SprDecision) => {
    setBusy(true);
    setErr(undefined);
    try {
      if (d.decision === "APPROVE") {
        let signature = d.adminSignature;
        // Request cryptographic EIP-712 signature from user's connected Web3 wallet
        if (!signature && typeof window !== "undefined" && (window as any).ethereum) {
          try {
            const accounts = await (window as any).ethereum.request({ method: "eth_requestAccounts" });
            const from = accounts[0];
            const domain = {
              name: "BizArc Autonomous Treasury",
              version: "1",
              chainId: 5042,
              verifyingContract: "0x5555555555555555555555555555555555555555",
            };
            const types = {
              EIP712Domain: [
                { name: "name", type: "string" },
                { name: "version", type: "string" },
                { name: "chainId", type: "uint256" },
                { name: "verifyingContract", type: "address" },
              ],
              PermissionDecision: [
                { name: "requestId", type: "string" },
                { name: "actionType", type: "string" },
                { name: "amountUsdc", type: "string" },
                { name: "decision", type: "string" },
              ],
            };
            const message = {
              requestId: r.requestId,
              actionType: r.action,
              amountUsdc: r.amountUsdc,
              decision: "APPROVE",
            };
            const msgParams = JSON.stringify({ types, domain, primaryType: "PermissionDecision", message });
            signature = await (window as any).ethereum.request({
              method: "eth_signTypedData_v4",
              params: [from, msgParams],
            });
          } catch (ethErr: any) {
            throw new Error(`Web3 wallet signing failed: ${ethErr.message}`);
          }
        }
        setApprovedSig(signature);
        await onDecide({ decision: "APPROVE", adminSignature: signature });
      } else {
        await onDecide(d);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Decision failed");
    } finally {
      setBusy(false);
    }
  };

  const t = r.targetRecipient;
  const pending = r.status === "PENDING";

  const cols: Column<T.SprAccountImpact>[] = [
    { key: "a", header: "Account", render: x => x.accountId.replace("acc_", "").replace(/_/g, " ") },
    { key: "u", header: "Recalled from USYC", align: "r", render: x => formatUsdc(x.usycRecallAmount) },
    { key: "b", header: "Cash Before", align: "r", render: x => formatUsdc(x.currentLiquidBalance) },
    { key: "p", header: "Cash After", align: "r", render: x => formatUsdc(x.postTxLiquidBalance) },
  ];

  return (
    <Panel title={SPR_ACTION_LABEL[r.action] || r.action} actions={<SprStatusBadge status={r.status} />}>
      <div style={{ display: "grid", gap: 16 }}>
        <div>
          <span className="bz-fig bz-total" style={{ fontSize: "var(--fs-4)" }}>
            {formatUsdc(r.amountUsdc, { symbol: true })}
          </span>
          <p className="bz-muted" style={{ margin: "8px 0 0", maxWidth: "68ch" }}>
            {r.reason}
          </p>
        </div>

        {t && (!t.isInVerifiedMaster || !t.payeeAddressMatchesHistory ? (
          <Banner tone="danger" title="Payee does not match verified records">
            {!t.isInVerifiedMaster
              ? `${t.vendorName} is not in the verified vendor directory.`
              : `The payout address for ${t.vendorName} differs from the last verified master address.`}{" "}
            Addresses printed on incoming invoices are never trusted. Approve only after out-of-band confirmation.
          </Banner>
        ) : (
          <Banner tone="auto" title="Payee verified">
            {t.vendorName} is in the verified vendor list and the payout destination matches history.
          </Banner>
        ))}

        {t && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span className="bz-muted">Pays to:</span>
            <CopyChip value={t.payoutAddress} label="payout address" />
          </div>
        )}

        {r.affectedAccounts.length > 0 && (
          <div>
            <h4 style={{ margin: "0 0 8px", fontSize: "var(--fs-0)", color: "var(--ink-2)", textTransform: "uppercase" }}>
              Account Balance Impact
            </h4>
            <DataTable columns={cols} rows={r.affectedAccounts} rowKey={x => x.accountId} />
          </div>
        )}

        <dl className="bz-kv">
          <dt>Idempotency key</dt>
          <dd>
            <CopyChip value={r.associatedRecords.idempotencyKey} label="idempotency key" />
          </dd>
          {r.associatedRecords.purchaseOrderId && (
            <>
              <dt>Purchase order</dt>
              <dd>{r.associatedRecords.purchaseOrderId}</dd>
            </>
          )}
          {r.associatedRecords.goodsReceiptId && (
            <>
              <dt>Goods receipt</dt>
              <dd>{r.associatedRecords.goodsReceiptId}</dd>
            </>
          )}
          {r.associatedRecords.invoiceDocumentId && (
            <>
              <dt>Invoice document</dt>
              <dd>{r.associatedRecords.invoiceDocumentId}</dd>
            </>
          )}
        </dl>

        {approvedSig && (
          <Banner tone="auto" title="EIP-712 Signature Attached">
            <CopyChip value={approvedSig} label="admin signature" />
          </Banner>
        )}

        {r.adminInstructions && <Banner tone="info" title="Instructions for Agent">{r.adminInstructions}</Banner>}
        {err && <Banner tone="danger" title="Could not record decision">{err}</Banner>}

        {pending &&
          (mode === "idle" ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingTop: 4 }}>
              <Button loading={busy} onClick={() => run({ decision: "APPROVE" })}>
                Approve and Sign (EIP-712)
              </Button>
              <Button variant="secondary" disabled={busy} onClick={() => setMode("cancel")}>
                Cancel with instructions
              </Button>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 10, background: "var(--sunken)", padding: 12, borderRadius: 6 }}>
              <Field
                label="What should happen instead?"
                hint="Required by Radar & Compliance. This memo is permanently written to the immutable audit log."
              >
                {(id, d) => (
                  <textarea
                    id={id}
                    aria-describedby={d}
                    className="bz-input"
                    rows={3}
                    placeholder="e.g. Reject payment until vendor accounts receivable confirms bank routing change."
                    value={memo}
                    onChange={e => setMemo(e.target.value)}
                  />
                )}
              </Field>
              <div style={{ display: "flex", gap: 8 }}>
                <Button
                  variant="danger"
                  loading={busy}
                  disabled={memo.trim().length < 4}
                  onClick={() => run({ decision: "CANCEL_WITH_INSTRUCTIONS", instructions: memo.trim() })}
                >
                  Confirm Cancellation
                </Button>
                <Button variant="quiet" onClick={() => setMode("idle")}>
                  Back
                </Button>
              </div>
            </div>
          ))}
      </div>
    </Panel>
  );
}

/* ───────── Routing & Waterfall ───────── */
export function WaterfallPlan({ route: q }: { route: T.RouteQualification }) {
  const rejected = q.routeType.startsWith("REJECTED");
  const cols: Column<T.WaterfallAllocation>[] = [
    {
      key: "a",
      header: "Account",
      render: x => (
        <>
          <strong>{x.accountName}</strong>
          <div className="bz-faint">{x.accountRole.replace(/_/g, " ").toLowerCase()}</div>
        </>
      ),
    },
    {
      key: "s",
      header: "Share of bill",
      render: x => (
        <div style={{ minWidth: 120 }}>
          <Meter value={pctOf(x.allocatedAmountUsdc, q.totalRequestedUsdc)} />
          <span className="bz-faint" style={{ fontSize: "0.75rem" }}>
            {pctOf(x.allocatedAmountUsdc, q.totalRequestedUsdc).toFixed(1)}%
          </span>
        </div>
      ),
    },
    {
      key: "r",
      header: "Recalled from USYC",
      align: "r",
      render: x => (x.requiresRecall ? formatUsdc(x.recallAmountUsdc) : <span className="bz-faint">None</span>),
    },
    {
      key: "l",
      header: "Left free afterward",
      align: "r",
      render: x => formatUsdc(x.remainingFreeCapitalUsdc),
    },
    {
      key: "u",
      header: "Allocated (USDC)",
      align: "r",
      render: x => <strong className="bz-fig">{formatUsdc(x.allocatedAmountUsdc)}</strong>,
    },
  ];

  return (
    <Panel
      title={
        q.routeType === "MULTI_ACCOUNT_WATERFALL"
          ? "Split across accounts (Waterfall)"
          : q.routeType === "SINGLE_ACCOUNT"
          ? "Paid from single account"
          : "Unroutable payment"
      }
      actions={
        rejected ? (
          <Badge tone="danger">Not payable</Badge>
        ) : q.requiresHumanApproval ? (
          <Badge tone="gate" hollow>
            Needs human approval
          </Badge>
        ) : (
          <Badge tone="auto">Within policy</Badge>
        )
      }
    >
      <div style={{ display: "grid", gap: 12 }}>
        <p className="bz-muted" style={{ margin: 0, maxWidth: "70ch" }}>
          {q.evaluationReason}
        </p>
        {rejected && q.shortfallUsdc && (
          <Banner tone="danger" title={`Shortfall: ${formatUsdc(q.shortfallUsdc, { symbol: true })}`}>
            No eligible account or combination can cover this bill without violating protected reserve floors.
          </Banner>
        )}
        {!rejected && <DataTable columns={cols} rows={q.allocations} rowKey={x => x.accountId} />}
        {!rejected && (
          <div className="bz-shield bz-muted">
            Corporate Payroll Escrow and Tax Escrow are excluded from cross-account draws unless paying payroll/tax directly.
          </div>
        )}
      </div>
    </Panel>
  );
}

/* ───────── Ledger & Cryptographic Chain ───────── */
export function JournalChain({
  vouchers,
  onTamperSimulate,
  tamperedIndex,
}: {
  vouchers: T.JournalVoucher[];
  onTamperSimulate?: () => void;
  tamperedIndex?: number;
}) {
  const broken = vouchers.findIndex((v, i) => i > 0 && v.previousHash !== vouchers[i - 1].currentHash);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div>
          {broken >= 0 ? (
            <Banner tone="danger" title={`Chain broken at sequence #${vouchers[broken].sequenceId}`}>
              Hash mismatch detected! This voucher does not cryptographically link to #{vouchers[broken - 1].sequenceId}. Ledger Witness has flagged this block as tampered.
            </Banner>
          ) : (
            <Banner tone="auto" title="Cryptographic chain verified">
              Every entry links to the prior block. SHA-256 chain integrity intact from genesis.
            </Banner>
          )}
        </div>
        {onTamperSimulate && (
          <div style={{ marginLeft: 16 }}>
            <Button variant="secondary" onClick={onTamperSimulate}>
              {broken >= 0 ? "Restore Chain" : "Simulate Tamper"}
            </Button>
          </div>
        )}
      </div>

      <ol className="bz-chain" style={{ marginTop: 12 }}>
        {vouchers.map((v, i) => (
          <li key={v.sequenceId} style={{ background: tamperedIndex === i ? "var(--danger-bg)" : undefined, padding: "12px 8px" }}>
            <span className="bz-seq">#{v.sequenceId}</span>
            <div>
              <strong>{v.actionType.replace(/_/g, " ").toLowerCase()}</strong>{" "}
              <span className="bz-muted">
                {v.debitAccount} → {v.creditAccount}
              </span>
              <div className="bz-faint">
                Ref: {v.documentRef} · {new Date(v.timestamp).toLocaleString()}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                <CopyChip value={v.currentHash} label="entry hash" />
                {v.txHash && <CopyChip value={v.txHash} label="transaction hash" />}
                {broken === i && <Badge tone="danger">Hash mismatch</Badge>}
              </div>
            </div>
            <span className="bz-fig" style={{ fontWeight: 600 }}>
              {formatUsdc(v.amountUsdc)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ───────── Onboarding Stepper & Math Q&A ───────── */
export const WIZARD_STEPS = [
  "Company Profile",
  "Money Rules",
  "Declared Policies",
  "Treasury Accounts",
  "Recurring Bills",
  "Audit & Activation",
] as const;

export function WizardStepper({ current, completed }: { current: number; completed: number[] }) {
  return (
    <ol className="bz-steps" aria-label="Setup progress">
      {WIZARD_STEPS.map((s, i) => {
        const n = i + 1;
        const st = completed.includes(n) ? "done" : n === current ? "current" : "todo";
        return (
          <li key={s} data-s={st} aria-current={st === "current" ? "step" : undefined}>
            {n}. {s}
            {st === "done" && <span className="bz-faint"> (done)</span>}
          </li>
        );
      })}
    </ol>
  );
}

export function QuestionField({
  q,
  value,
  onChange,
}: {
  q: T.MathQuestion;
  value: string | number | boolean | undefined;
  onChange: (v: string | number | boolean) => void;
}) {
  return (
    <Field label={q.questionText} hint={q.helpText ?? q.formulaDescription}>
      {(id, d) => {
        if (q.responseType === "BOOLEAN") {
          return <Switch checked={value === true} onChange={onChange} label={value === true ? "Yes" : "No"} />;
        }
        if (q.responseType === "SELECT") {
          return (
            <Select
              id={id}
              value={String(value ?? "")}
              onChange={v => onChange(v)}
              options={[{ value: "", label: "Choose one" }, ...(q.options ?? []).map(o => ({ value: String(o.value), label: o.label }))]}
            />
          );
        }
        if (
          q.responseType === "NUMBER" &&
          /usdc|burn|floor|cap|invoice|bill|spend|budget|sweep/i.test(q.questionId + q.questionText)
        ) {
          return (
            <UsdcInput
              id={id}
              describedBy={d}
              value={String(value ?? "")}
              onChange={v => onChange(v)}
            />
          );
        }
        return (
          <TextInput
            id={id}
            aria-describedby={d}
            inputMode="decimal"
            value={String(value ?? "")}
            onChange={e => onChange(e.target.value)}
          />
        );
      }}
    </Field>
  );
}

export function RailPicker({
  rail,
  sub,
  onChange,
}: {
  rail: T.PaymentRail;
  sub?: T.FiatSubMethod;
  onChange: (r: T.PaymentRail, s?: T.FiatSubMethod) => void;
}) {
  const info: Record<T.PaymentRail, string> = {
    DISBURSAL_VAULT: "Onchain, from your accounts. Best for most vendors.",
    MODULAR_SESSION_KEY: "Agent pays inside a set limit, no approval each cycle.",
    ERC3009_AUTHORIZATION: "Gasless transfer from a signed authorization.",
    GATEWAY_X402: "Tiny pay-per-call charges for APIs and data.",
    FIAT_PAYOUT: "Wire, ACH, card, SEPA or SWIFT to a bank.",
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <fieldset className="bz-rails">
        <legend className="bz-hint" style={{ marginBottom: 8 }}>
          How should this vendor be paid?
        </legend>
        {(Object.keys(RAIL_LABEL) as T.PaymentRail[]).map(r => (
          <label key={r} className="bz-rail">
            <input
              type="radio"
              name="rail"
              checked={rail === r}
              onChange={() => onChange(r, r === "FIAT_PAYOUT" ? sub ?? "FEDWIRE" : undefined)}
            />
            <strong>{RAIL_LABEL[r]}</strong>
            <span className="bz-muted" style={{ fontSize: "0.85rem" }}>
              {info[r]}
            </span>
          </label>
        ))}
      </fieldset>
      {rail === "FIAT_PAYOUT" && (
        <Field label="Bank Transfer Method">
          {id => (
            <Select
              id={id}
              value={sub ?? "FEDWIRE"}
              onChange={s => onChange(rail, s)}
              options={(Object.keys(FIAT_LABEL) as T.FiatSubMethod[]).map(s => ({
                value: s,
                label: FIAT_LABEL[s],
              }))}
            />
          )}
        </Field>
      )}
    </div>
  );
}

/* ───────── Emergency Controls & Production Readiness ───────── */
export function CircuitBreaker({
  tripped,
  reason,
  onTrip,
  onReset,
}: {
  tripped: boolean;
  reason?: string;
  onTrip: (reason: string) => Promise<void>;
  onReset?: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="bz-breaker" data-tripped={tripped}>
      <div>
        <strong>{tripped ? "Autonomous activity halted" : "Emergency Stop (Circuit Breaker)"}</strong>
        <div className="bz-muted" style={{ maxWidth: "60ch" }}>
          {tripped
            ? reason
            : "Instantly freezes all autonomous yield sweeps, waterfall payments, and session key withdrawals across all agents."}
        </div>
      </div>
      {!tripped ? (
        open ? (
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
            <Field label="Reason (saved to immutable audit log)">
              {id => (
                <TextInput
                  id={id}
                  placeholder="e.g. Unusual spike in model API billing"
                  value={why}
                  onChange={e => setWhy(e.target.value)}
                />
              )}
            </Field>
            <Button
              variant="danger"
              loading={busy}
              disabled={why.trim().length < 4}
              onClick={async () => {
                setBusy(true);
                try {
                  await onTrip(why.trim());
                } finally {
                  setBusy(false);
                  setOpen(false);
                }
              }}
            >
              Halt Swarm
            </Button>
            <Button variant="quiet" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button variant="danger" onClick={() => setOpen(true)}>
            Stop All Agents
          </Button>
        )
      ) : onReset ? (
        <Button variant="secondary" onClick={onReset}>
          Resume Swarm Operations
        </Button>
      ) : null}
    </div>
  );
}

export function ReadinessPillars({
  pillars,
  overallScore,
}: {
  pillars: T.ReadinessPillar[];
  overallScore: number;
}) {
  return (
    <Panel
      title="Production Readiness Verification"
      actions={
        <span className="bz-fig" style={{ fontSize: "var(--fs-3)" }}>
          {overallScore.toFixed(1)} / 100
        </span>
      }
    >
      <div style={{ display: "grid", gap: 14 }}>
        {pillars.map(p => (
          <div key={p.pillar} style={{ display: "grid", gap: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <strong>{p.pillar}</strong>
              {p.isReady ? <Badge tone="auto">Ready</Badge> : <Badge tone="danger">Blocked</Badge>}
            </div>
            <Meter value={p.score} tone={p.isReady ? undefined : p.score > 50 ? "gate" : "danger"} />
            <div className="bz-faint" style={{ fontSize: "0.85rem" }}>
              {p.details}
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
