# BizArc Autonomous Treasury: Halcyon Robotics Inc.

A production-grade, ledger-first autonomous treasury management platform built for Halcyon Robotics Inc., marrying the BizArc design language and kit with interactive solvency monitoring, human approval gates (SPRS), multi-account waterfalls, cryptographic journal auditing, and an integrated onboarding wizard.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> The following decisions were confirmed during Phase 1 clarification:
> - **Default View**: Opens directly to the full executive treasury dashboard with live liquid/invested balances ($B_E = B_L + B_Y$), solvency equation, and upcoming obligations.
> - **Interactive Simulation**: Full interactive control to approve/reject SPRS requests (with EIP-712 signature mock), trigger autonomous yield sweeps/recalls, test circuit breaker halts, and simulate invoice payment runs.
> - **Onboarding Wizard**: Included as both an accessible dedicated navigation tab and an interactive modal walkthrough covering all 6 setup stages.

---

## 1. Overview & Core Concept

- **What It Does**: Provides Halcyon Robotics Inc. with a comprehensive treasury interface governing six departmental accounts, $759,611.50 in total effective USDC ($339,111.50 cash + $420,500.00 invested in USYC yield vaults), automated disbursements, and policy guardrails.
- **Target Audience / Persona**: CFO Amara Okafor, Treasury Operators, and Compliance Officers overseeing autonomous agents (Treasury Sentinel, Disbursal Router, Liability Radar, Ledger Witness, Policy Compliance).
- **Core Value**: Complete financial transparency and control: invariant solvency enforcement, strict human-in-the-loop approval gates for out-of-policy payments, inviolable payroll reserves, and zero-silent-rounding exact 6-decimal arithmetic.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Executive Overview & Solvency Dashboard**:
   - Tripartite balance equation ($B_E = B_L + B_Y$) visualizer with exact double-rule total.
   - Six cost-center account distribution cards (General Treasury, Corporate Payroll Escrow with active Payroll Shield, Engineering Ops, Marketing & Growth, Legal & Compliance, Tax Escrow).
   - Real-time liquidity status badges (`Surplus ready to invest`, `Needs cash recalled`, `Balanced`).
   - Upcoming 30-day liabilities ledger with status filtering and payment rail indications.

2. **Approvals & Routing Center (SPRS)**:
   - Priority review cards for pending human gates (e.g. Datadog payee mismatch freeze, Legal retainer single-tx threshold escalation, high-value sweep exemption).
   - Interactive decision buttons: **Approve and sign** (simulating EIP-712 approver signature) and **Cancel with instructions** (requiring mandatory memo saved to audit log).
   - Multi-account waterfall payment plan inspector showing account quotas, USYC recall requirements, and remaining free capital.

3. **Master Journal & Cryptographic Audit**:
   - Verifiable SHA-256 journal hash chain linking every ledger entry from Genesis to present.
   - Interactive "tamper simulation" toggle to verify that client-side chain validation immediately catches broken hashes.
   - Production readiness score (94.8/100) across 8 system pillars.
   - Emergency Circuit Breaker switch allowing instant halt of all autonomous sweeps and payments with mandatory reason logging.

4. **Interactive 6-Step Onboarding Setup**:
   - Step-by-step progress stepper (Company Profile -> Money Rules -> Policies -> Accounts -> Recurring Bills -> Review).
   - Form fields configured with exact USDC decimal validation and domain math questionnaires.

### Visual Identity & Theme

- **Aesthetic Direction**: Ledger-first financial instrument, inspired by high-end accounting broadsheets and archival financial paper.
- **Color Palette & Mood**:
  - Paper canvas (`#f2f5f1` light, `#0f1613` dark)
  - Ink and rules (`#14201c` ink, `#cfd8cd` subtle rule, `#8fa090` strong rule)
  - Liquid cash $B_L$ (`#0d7480` teal)
  - Invested USYC $B_Y$ (`#5546b0` indigo)
  - Human gate indicator (`#a8650a` amber)
  - Autonomous indicator (`#1d6b47` emerald)
  - Danger/Anomaly indicator (`#a82a22` crimson)
- **Typography**:
  - Newsreader / Iowan Old Style for tabular accounting figures and totals
  - Instrument Sans / system sans for structured UI and navigation
  - Monospace for wallet addresses, transaction hashes, and idempotency keys
- **The Signature Mark**: Accounting double underline (`border-bottom: 3px double var(--ink)`) under all verified totals.

---

## 3. Key Product Decisions & Trade-Offs

- **Exact 6-Decimal Math via BigInt Strings**:
  - *Chosen Approach*: Implement `money.ts` strictly using `BigInt` operations on micro-units (`1 USDC = 1,000,000`), rejecting numbers with more than 6 decimals (`LoudRoundingError`).
  - *Why*: Eliminates floating point drift in financial ledgers.
- **Client-Side Live State Simulation**:
  - *Chosen Approach*: Manage active treasury state in React context initialized from the Halcyon Robotics fixture data, allowing users to approve SPRS, sweep funds, add bills, or trip circuit breakers and see instant ledger updates.
  - *Why*: Provides a live, hands-on demonstration without requiring external backend server dependencies.
- **Persistent Theme & Sidebar Layout**:
  - *Chosen Approach*: Clean 260px collapsible sidebar navigation paired with breadcrumb header and dark/light mode toggle.

---

## 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────────────────────┐
│                        BizArc Application Root                         │
│             (Theme Context: Light/Dark · Tokens & Kit CSS)             │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
           ┌────────────────────────┴────────────────────────┐
           ▼                                                 ▼
┌───────────────────────────────┐           ┌────────────────────────────────┐
│   Treasury State Store        │           │    Sidebar & Top Navigation    │
│  - Halcyon Accounts & Balances│           │  - Halcyon Robotics Context    │
│  - Liabilities & Rails        │           │  - Module Switcher             │
│  - Pending SPRS Decisions     │           │  - Circuit Breaker Status      │
│  - Journal Hash Chain         │           │  - Theme Mode Toggle           │
└──────────────┬────────────────┘           └────────────────────────────────┘
               │
   ┌───────────┼─────────────────────────┬────────────────────────┐
   ▼           ▼                         ▼                        ▼
┌──────────┐ ┌──────────────────────┐ ┌────────────────────┐ ┌──────────────────┐
│Overview  │ │Approvals & Routing   │ │Journal & Audit     │ │Onboarding Wizard │
│- Equation│ │- Pending SPRS Cards  │ │- SHA-256 Chain     │ │- 6 Steps Stepper │
│- Accounts│ │- EIP-712 Sign Flow   │ │- Tamper Simulator  │ │- Math Q&A Form   │
│- Bills   │ │- Waterfall Split View│ │- Readiness Pillars │ │- Review & Commit │
│- Agents  │ │- Payee Mismatch Alert│ │- Circuit Breaker   │ │                  │
└──────────┘ └──────────────────────┘ └────────────────────┘ └──────────────────┘
```

### Component Structure
- `src/types.ts`: Domain models (Accounts, Liabilities, SPRS, Journal, Agents).
- `src/money.ts`: BigInt 6-decimal math, formatting, and loud rounding protections.
- `src/fixtures.ts`: Comprehensive Halcyon Robotics Inc. dataset.
- `src/primitives.tsx`: Buttons, Badges, Panels, DataTables, USDC Inputs, Switches, Meters, CopyChips.
- `src/domain.tsx`: Domain widgets (TripartiteEquation, AccountCard, SprCard, WaterfallPlan, JournalChain, CircuitBreaker, ReadinessPillars).
- `src/views/OverviewView.tsx`: Executive dashboard.
- `src/views/ApprovalsView.tsx`: SPRS management and routing analysis.
- `src/views/LedgerView.tsx`: Master journal and system health.
- `src/views/OnboardingView.tsx`: 6-step interactive wizard.
- `src/views/AccountsView.tsx`: Detailed departmental account breakdown.
- `src/views/LiabilitiesView.tsx`: Comprehensive accounts payable & rails manager.
- `src/App.tsx`: Navigation shell, state management, and modal orchestration.
