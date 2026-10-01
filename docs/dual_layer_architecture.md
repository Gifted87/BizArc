# Dual-Layer Autonomous Treasury Architecture

The BizArc Autonomous Treasury platform implements a **Dual-Layer Architecture** designed to balance high-agency cognitive autonomy with cryptographically and mathematically inviolable financial safety envelopes.

---

## 1. The Core Tension in Autonomous Finance

| Extreme | Vulnerability / Failure Mode |
| :--- | :--- |
| **Pure Prompt Agency** (Unsafe) | Relies on LLM system prompts to prevent unauthorized spending or enforce limits. Vulnerable to prompt injection, hallucinated allowances, and conversational bypass. |
| **Pure Deterministic Scripts** (Passive) | Hardcodes rigid `if/else` checks and static cron jobs. Strips the system of judgment, perception, proactive liquidity planning, and unstructured invoice parsing. |

BizArc resolves this tension through strict separation between **Cognitive Deliberation** and **Onchain Guardrail Enforcement**.

---

## 2. Layer 1: The Autonomous Cognitive Agent Swarm (The Brain & Driver)

The agent cluster operates with genuine cognitive initiative:
1. **Perception**: Continuously ingests unstructured invoices, recurring subscriptions, and onchain balance mutations.
2. **Dynamic Horizon Modeling**: Evaluates upcoming payment obligations over rolling windows (3-day in Demo, 30-day in Production) rather than relying on static calendar reminders.
3. **Tripartite Balance Model**:
   $$\text{TotalEffectiveBalance } (B_E) = \text{Liquid USDC } (B_L) + \text{Invested USYC Value } (B_Y)$$
   Agents evaluate solvency based on $B_E$, preventing false insolvency rejections when cash is optimized in yield.
4. **Autonomous Fast-Path (Inside the Rules)**:
   - Routine surplus sweeps into USYC when $B_L > \text{TargetReserve} + \Delta_{\text{invest}}$.
   - Pre-funding recalls back into operating wallets $T_{\text{lead}}$ prior to scheduled liabilities.
   - Operations execute autonomously and record immediately to dual audit streams.
5. **Mandatory Human Escalation (Outside the Rules)**:
   - Unrecognized vendor addresses, changed payout addresses (payee substitution defense), amounts exceeding the single-transaction human gate, or multi-account draws trigger a **Standardized Permission Request (SPRS)**.
   - Admin responds with binary options: `APPROVE` or `CANCEL_WITH_INSTRUCTIONS`.
6. **Oscillation & Feedback Prevention**:
   - **Internal Event Filtering**: Events originating from known vault operations are marked `INTERNAL_SETTLEMENT` and do not trigger recursive recalculations.
   - **Debouncing**: 5-second sliding debounce collapses rapid micro-transfers into a single recalculation.
   - **Hysteresis Deadband**: Distinct thresholds for sweeps vs recalls eliminate transaction churn.

---

## 3. Layer 2: The Smart Contract Guardrail Envelope (The Inviolable Safety Cage)

Onchain contracts on Arc L1 enforce immutable physical constraints that no agent prompt, LLM temperature spike, or API key compromise can override:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      SMART CONTRACT GUARDRAIL ENVELOPE                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  CentralTreasuryYieldVault.sol                                             │
│  ├── Segregated Account Ledger (accountShares[accountId])                   │
│  ├── Registered Recipient Lock: recallForAccount() ONLY transfers to         │
│  │   registeredAccounts[accountId] (Recipient CANNOT be parameterized)      │
│  ├── Role-based Access: SWEEPER_ROLE & DISBURSAL_ROLE                       │
│  └── ERC-4626 exact withdraw() with balance-before / balance-after checks   │
│                                                                             │
│  DisbursalVault.sol                                                         │
│  ├── Zero-balance transient clearinghouse (funds staged and paid atomically)│
│  ├── Onchain Approved Vendor Allowlist (approvedVendors[vendor])            │
│  ├── Idempotency Key Lock (executedIdempotencyKeys[hash])                   │
│  ├── Hard Daily Spending Cap (dailyCap) with daily rolling reset            │
│  └── Mandatory EIP-712 Admin Signature for amounts > eip712Threshold        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Segregation of Duties: Mover vs Independent Witness

In accordance with strict corporate financial controls:
- **`TreasuryExecutionAgent` / `DisbursalRouterAgent`**: Possess programmatic signing keys to interact with Arc contracts, but have **zero direct write permissions** to the relational double-entry ledger or audit records.
- **`LedgerWitnessAgent`**: Possesses **zero private keys or signing capabilities**. It observes the Arc blockchain independently via raw RPC and Circle webhooks, extracts confirmed transaction receipts, validates counterparties, and posts double-entry journal vouchers to the hash-chained ledger.
