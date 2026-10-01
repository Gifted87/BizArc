# Multi-Agent Cluster: Roles, Personas & Responsibilities

The BizArc platform organizes autonomous agency across five specialized agent personas, each assigned an onchain ERC-8004 identity and distinct segregation of duties:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                               AUTONOMOUS MULTI-AGENT CLUSTER                            │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                        │
│  1. TreasurySentinelAgent (ERC-8004 #101)                                              │
│     Yield Optimizer & Liquidity Sentinel                                              │
│                                                                                        │
│  2. LiabilityRadarAgent (ERC-8004 #102)                                                │
│     SaaS & Recurring Obligation Auditor                                                │
│                                                                                        │
│  3. DisbursalRouterAgent (ERC-8004 #103)                                               │
│     Cross-Account Liquidity Strategist                                                 │
│                                                                                        │
│  4. PolicyComplianceAgent (ERC-8004 #104)                                              │
│     Governance Gatekeeper & Human-in-the-Loop Liaison                                  │
│                                                                                        │
│  5. LedgerWitnessAgent (ERC-8004 #105)                                                 │
│     Independent External Auditor (Zero Signing Ability)                                │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 1. `TreasurySentinelAgent` (ERC-8004 #101)
- **Role**: Yield Optimizer & Dynamic Safe-to-Invest Executor.
- **Authority**:
  - `SWEEPER_ROLE` on `CentralTreasuryYieldVault.sol`.
  - Can trigger `sweepFromAccount` autonomously when inside policy rules.
  - Can trigger `recallForAccount` autonomously to pre-fund verified liabilities.
- **Responsibilities**:
  1. Ingest real-time balance mutation events from Arc WebSocket.
  2. Apply debouncing (5s) and filter internal origin events.
  3. Compute $\text{TargetReserve}$ and $\text{SafeToInvest}$ with hysteresis deadband:
     $$\text{TargetReserve} = \left(\sum_{i \in \text{Liabilities}_T} \text{amount}_i \times S_{\text{ratio}}\right) + F_{\text{op}}$$
     $$\text{SafeToInvest} = \max(0, B_L - (\text{TargetReserve} + \Delta_{\text{invest}}))$$
  4. Dispatch autonomous sweeps to USYC if $\text{SafeToInvest} \ge \text{MinSweepThreshold}$.
  5. Coordinate with `PredictiveRefunderService` to recall funds back to operating wallets $T - \text{LeadTime}$ prior to due dates.

---

## 2. `LiabilityRadarAgent` (ERC-8004 #102)
- **Role**: Recurring Liabilities Auditor & Subscription Hunter.
- **Authority**: Read-only access to liabilities database, invoice ingestion inbox, and notification webhook dispatch.
- **Responsibilities**:
  1. Maintain dynamic, document-linked `AccountLiabilities` registry.
  2. Track recurring schedules (cron expressions) for subscriptions, debt service, and payroll.
  3. Active anomaly detection: flags zombie SaaS tools, unused seats, and stealth price hikes.
  4. 48 hours prior to liability payment due date, dispatch a notification to the administrator containing what is being paid, source account, and binary choices:
     - `APPROVE`: queues transaction for scheduled execution.
     - `CANCEL_WITH_INSTRUCTIONS`: freezes liability and generates a cancellation workflow.

---

## 3. `DisbursalRouterAgent` (ERC-8004 #103)
- **Role**: Cross-Account Liquidity Strategist & Execution Router.
- **Authority**: `EXECUTOR_ROLE` on `DisbursalVault.sol`. Can stage funds and execute payments.
- **Responsibilities**:
  1. Compute `UnifiedDistribution` metrics aggregating fragmented accounts across Arc and other chains.
  2. Qualify accounts using role compatibility and unencumbered capital:
     $$\text{FreeCapital} = B_E - \left(\sum \text{Liabilities}_{30d} \times S_{\text{ratio}}\right) - F_{\text{op}}$$
  3. Execute single-account disbursals where free capital is sufficient.
  4. If insufficient, execute Multi-Account Waterfall Allocation:
     - Ranks eligible accounts by policy hierarchy.
     - Strictly preserves payroll and mandatory reserve exclusions.
     - Stages pooled funds in `DisbursalVault` and invokes `executePayment`.

---

## 4. `PolicyComplianceAgent` (ERC-8004 #104)
- **Role**: Governance Officer & Human Gatekeeper.
- **Authority**: Fast-path grant or execution block. SPRS generator.
- **Responsibilities**:
  1. Enforce business policy rules from `business_policy.yaml`.
  2. Perform Three-Way Matching: Purchase Order vs Goods Receipt vs Vendor Invoice.
  3. Payee Substitution Protection: Verify recipient address against verified `vendor_master_registry`.
  4. Enforce exact integer 6-decimal arithmetic; reject silent rounding.
  5. Formulate Standardized Permission Request (SPRS) when outside rules:
     - New or altered vendor addresses.
     - Single transaction amount $> \text{single\_tx\_human\_gate\_threshold}$.
     - Multi-account waterfall rebalancing.
  6. Verify EIP-712 human admin cryptographic signatures before clearing high-value disbursements.

---

## 5. `LedgerWitnessAgent` (ERC-8004 #105)
- **Role**: Independent External Ledger Witness & Double-Entry Reconciler.
- **Authority**: **STRICTLY ZERO SIGNING KEYS**. Write access to relational accounting journal and audit logs.
- **Responsibilities**:
  1. Listen directly to Arc L1 RPC and Circle Webhook feeds independently from execution agents.
  2. Upon transaction confirmation, extract transaction receipts (block height, sender, recipient, amount, gas).
  3. Generate formal double-entry vouchers:
     - Debits and credits posted to respective account heads.
  4. Append tamper-evident records to `account_agent_audit_log`.
  5. Calculate SHA-256 hash chaining on `master_system_journal`:
     $$\text{Hash}_n = \text{SHA256}(\text{Hash}_{n-1} + \text{Timestamp}_n + \text{AccountId}_n + \text{Debit}_n + \text{Credit}_n + \text{Amount}_n + \text{TxHash}_n)$$
