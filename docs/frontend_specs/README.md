# BizArc Frontend Architecture & Specifications Master Index

This directory contains the complete, authoritative, and exhaustive architectural specifications for the **BizArc Autonomous Treasury & Financial Operations** frontend application.

The entire capability matrix and functional surface of BizArc is organized into **Three Core Pillars**, each detailed in its own specification document:

---

## 🏛️ The Three Core Pillars

### [1. Corporate Treasury Operations & Real-Time Liquidity Engine](file://wsl.localhost/Ubuntu-24.04/home/gifted/BizArc/docs/frontend_specs/01_treasury_and_liquidity_engine.md)
* **The "Treasury & Yield Cockpit"**
* **Parallel Tripartite Balance**: Real-time visualization of Effective Purchasing Power ($B_E = B_L + B_Y$).
* **Safe-to-Invest Gauge (Dynamic Record 2)**: Dynamic headroom calculations, 7-day horizon countdowns, and hysteresis buffers.
* **Operating Accounts Grid & Waterfall View**: Departmental accounts (`acc_engineering`, `acc_marketing`), protected **Payroll Wall** (`acc_payroll` with `max_autonomous_sweep_limit = 0.00`), and transient clearinghouse ($0.00 at rest).
* **Account Creation & Policy Configuration Drawer**: Full modal flow for establishing new departmental accounts and adjusting spending caps/floors (`POST /api/accounts`, `PUT /api/accounts/:id`).
* **Dedicated Account Funding Drawer**: Multi-method funding modal per account (`GET /api/accounts/:id/funding-options`, `POST /api/accounts/:id/fund`) covering Credit/Debit Card & ACH (Circle), direct Arc L1 crypto/bridge, institutional Fedwire, and internal allocation sweeps.
* **Inter-Account Internal Transfer Flow**: Rule 5 6-decimal strict USDC precision transfer between operating accounts (`POST /api/accounts/transfer`).
* **Shortfall Resolution & Deficit Auto-Recall Console**: Real-time detection of account deficits and one-click autonomous USYC recall trigger (`GET /api/treasury/shortfalls`, `POST /api/treasury/shortfalls/run`).
* **Autonomous Yield Sweeps & Recalls**: Real-time sweeps to Hashnote USYC (~5.15% APY), sub-second liquidity recall, performance analytics, and yield moves audit logs.
* **Fiat & Token Funding**: Institutional Fedwire instructions with tracking memos, deposit reconciliation, and cross-chain token swaps.

---

### [2. Invoices, Subscriptions & Universal 5-Rail Settlement](file://wsl.localhost/Ubuntu-24.04/home/gifted/BizArc/docs/frontend_specs/02_disbursals_liabilities_and_rails.md)
* **The "Disbursals & AP Command Center"**
* **Committed Liabilities Matrix (Dynamic Record 1)**: Calendar & list of recurring SaaS subscriptions, bills, and retainers.
* **Ad-Hoc / Manual Disbursal Initiation Flow ("Pay Vendor Now")**: Complete guided modal for one-off vendor payments (`POST /api/disbursals/manual`) with PO/receipt document upload, route qualification, and two-layer authorization check.
* **Recurring Liability Management (CRUD)**: Create, edit, and cancel recurring commitments (`POST /api/liabilities`, `PUT /api/liabilities/:id`, `DELETE /api/liabilities/:id`) with mandatory cancellation memos.
* **Interactive Invoice Dispute Filing & Resolution Workflow**: Formal dispute modal (`POST /api/liabilities/:id/dispute`) freezing scheduled payments and logging dispute memos.
* **The 48-Hour Pre-Flight Radar**: High-priority alert banner with binary executive decisions (`APPROVE` or `CANCEL_WITH_INSTRUCTIONS`).
* **AI Three-Way Match Intake Drawer**: Asynchronous background discovery across Workspace MCP, ERPs, and top 10 SaaS vendors (`POST /api/onboarding/discovery`); proposal staging and CFO ratification (`POST /api/liability-proposals/:id/decision`).
* **Stealth Price Creep Protection**: Real-time alerts when billing exceeds contract baselines by $>5\%$.
* **Vendor Master & Payee Defense (Rule 3)**: Immutable onchain address locks (`forceOverride: true` dialog) and verified commercial banking coordinates.
* **Vendor Payment Method & Multi-Rail Preference Configuration**: Configuring rail preferences per vendor/liability (`POST /api/liabilities/:id/payment-method`).
* **Universal 5-Rail Disbursal Router**: Automatic route qualification across:
  * **Rail 1**: Arc L1 Disbursal Vault ($0 at rest transient smart contract waterfall).
  * **Rail 2**: Modular Session Keys (ERC-4337 / ERC-6900 scoped recurring subscriptions).
  * **Rail 3**: ERC-3009 Delegated Authorizations (gasless offchain vouchers).
  * **Rail 4**: Circle Gateway x402 Micropayments (sub-cent pay-per-call API access).
  * **Rail 5**: Universal Fiat Payouts (Fedwire, ACH, Push-to-Card, SEPA, SWIFT via Circle Mint).
* **Unified Multi-Rail Payment Ledger (`/api/payments`)**: Consolidated transaction explorer.
* **ERP Synchronization & MCP Integration Status**: Real-time status for Odoo / ERPNext checkpoints and manual sync trigger (`POST /api/integrations/erp/sync`).

---

### [3. Governance, Cryptographic Gateways & System Administration](file://wsl.localhost/Ubuntu-24.04/home/gifted/BizArc/docs/frontend_specs/03_security_governance_and_admin.md)
* **The "Security, SPRS & Governance Console"**
* **The 6-Step Enterprise Onboarding Wizard (FTUX)**: Guided setup for Pathway A (manual) and Pathway B (connected MCP/ERP), including Legal Identity, Accounts, Policies, and onchain activation (`POST /api/onboarding/session`, `POST /api/onboarding/step`, `POST /api/onboarding/activate`).
* **Mathematical Rules Q&A Engine**: Administers intuitive business questionnaires across 4 categories (`GENERAL_MATH`, `ACCOUNT_MATH`, `LIABILITY_MATH`, `INVESTMENT_MATH`) to derive exact system reserve parameters (`GET /api/onboarding/qa/questions`, `POST /api/onboarding/qa/evaluate`).
* **Emergency System Circuit Breaker (Panic Button)**: Global panic button to immediately freeze all autonomous swarm agent actions, sweeps, and disbursals (`POST /api/governance/circuit-breaker` & `POST .../disarm`) with full-screen emergency lockdown banner.
* **Production Readiness Health Audit Dashboard**: Visual compliance checklist monitoring database, Arc L1 RPC, signer allowlist, solvency, and smart contract health (`GET /api/governance/readiness`).
* **Two-Layer Authorization Gate**: Layer 1 Enforcer Agent compliance clearance codes $\rightarrow$ Layer 2 Human Officer SPRS.
* **Web3 Browser Wallet EIP-712 Signing**: Native integration for MetaMask, Coinbase Wallet, and hardware devices to sign structured authorization payloads without CLI (`GET /api/sprs/:id/typed-data`, `POST /api/sprs/:id/sign`).
* **Master System Journal & Hash Integrity Probe (Rule 6 & Rule 1)**: Immutable sequential SHA-256 hash chaining with one-click tamper detection probe (`GET /api/journal/verify`).
* **Multi-Tenant IAM & Enterprise RBAC**: Role-Permission matrix (`OWNER`, `CFO`, `TREASURY_OFFICER`, `AUDITOR_VIEWER`, `API_SERVICE`), tenant switching (`POST /api/auth/switch-company`), and team invitations (`POST /api/team/invite`).
* **Sign-In with Ethereum (SIWE)**: Cryptographic nonce generation and personal message signature verification.
* **Developer Platform & Scoped API Keys**: Scoped API key management (`biz_live_...`) for enterprise ERPs.
* **Interactive Notifications Drawer & Real-Time SSE Stream**: Server-Sent Events (SSE `/api/events`) push channel, notification bell with unread badges, and deep-link actions (`GET /api/notifications`, `POST /api/notifications/read`).

---

## 🛠️ Recommended Frontend Architecture & Tech Stack

When frontend implementation commences, the recommended enterprise frontend stack is:
1. **Framework**: React 18+ / Vite with TypeScript.
2. **Styling & Design System**: TailwindCSS with CSS custom properties; dark mode by default (`#0B0E14` obsidian slate, `#121824` midnight navy) accented by Arc cyan (`#00D2FF`) and Circle blue (`#0052FF`).
3. **Web3 / Blockchain**: Viem + Wagmi for Arc L1 RPC connection, SIWE, and EIP-712 structured data signing.
4. **State Management & Real-Time**: TanStack Query (React Query) paired with native EventSource SSE listeners (`/api/events`) for reactive optimistic UI mutations.
5. **Data Visualization**: Recharts or Tremor for tripartite liquidity charts, safe-to-invest gauges, and yield performance metrics.
