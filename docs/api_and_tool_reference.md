# BizArc API, Webhooks & Agent Tool Reference

## 1. Executive Summary

BizArc provides two primary operational interfaces:
1. **Physical Ingress Server**: An asynchronous HTTP server ([SystemHttpServer.ts](file://wsl.localhost/Ubuntu-24.04/home/gifted/BizArc/src/ingress/systemHttpServer.ts)) providing REST endpoints for dashboards, ERP connectors, and webhooks.
2. **Autonomous Tool Registry**: A structured tool invocation engine ([ToolRegistry.ts](file://wsl.localhost/Ubuntu-24.04/home/gifted/BizArc/src/tools/toolRegistry.ts)) providing 30+ deterministic tools to cognitive LLM agents.

---

## 2. REST Ingress Server Reference

The [SystemHttpServer](file://wsl.localhost/Ubuntu-24.04/home/gifted/BizArc/src/ingress/systemHttpServer.ts) executes on the configured port (default: `3000` or dynamically assigned in test suites).

### 2.1 State Machine Reactive Endpoints

#### `POST /api/invoices/inbound`
- **Machine**: Machine 2 (Liability Discovery)
- **Description**: Ingests an inbound invoice document, initiating forensic three-way matching and payee substitution verification.
- **Request Body**:
  ```json
  {
    "companyId": "org_acme_corp",
    "vendorId": "vendor_aws_cloud",
    "invoiceId": "INV-2026-9081",
    "amountUsdc": 1420.50,
    "dueDate": "2026-10-25T00:00:00Z",
    "payoutAddress": "0xaaaa111111111111111111111111111111111101",
    "poReference": "PO-AWS-2026-Q4",
    "preferredPaymentRail": "DISBURSAL_VAULT"
  }
  ```
- **Response**: `200 OK` with transition record and staged liability status (`SCHEDULED` or `FROZEN`).

#### `POST /api/events/balance-mutation`
- **Machine**: Machine 3 (Yield Rebalancing)
- **Description**: Notifies the orchestrator of an onchain or internal balance change, initiating Safe-to-Invest evaluation.
- **Request Body**:
  ```json
  {
    "accountId": "acc_engineering_ops",
    "amountUsdc": 5000.0,
    "currentLiquidBalanceUsdc": 12500.0,
    "origin": "ARC_L1_BLOCKCHAIN_EVENT",
    "txHash": "0x4f8a...b12c"
  }
  ```

#### `POST /api/disbursal/trigger-due`
- **Machine**: Machine 4 (Liability Disbursal)
- **Description**: Manually triggers settlement execution for a due liability.
- **Request Body**: `{ "liability": { "liability_id": "uuid-..." } }`

#### `POST /api/payments/ad-hoc`
- **Machine**: Machine 5 (Ad-Hoc Discretionary Payments)
- **Description**: Submits a non-liability discretionary payment request across crypto or fiat rails.
- **Request Body**:
  ```json
  {
    "companyId": "org_acme_corp",
    "requestedAccountId": "acc_general_treasury",
    "amountUsdc": 750.0,
    "reason": "Expedited legal consultation retainer",
    "paymentRail": "FIAT_PAYOUT",
    "beneficiaryBank": {
      "accountHolderName": "Morrison & Foerster LLP",
      "ibanOrAccountNumber": "021000021987654321",
      "routingOrSwift": "021000021",
      "bankCountry": "US",
      "paymentSubMethod": "FEDWIRE"
    }
  }
  ```

#### `POST /api/sprs/:id/decision`
- **Security**: Layer 2 Human Sign-Off
- **Description**: Submits a Human Corporate Officer decision (APPROVE or REJECT) on an escalated SPRS request. Requires cryptographic EIP-712 signature.
- **Request Body**:
  ```json
  {
    "decision": "APPROVE",
    "adminSignature": "0x7a8b...12c9"
  }
  ```

---

### 2.2 Liabilities REST CRUD Endpoints

#### `POST /api/liabilities`
- **Description**: Creates or stages a new account liability.
- **Request Body**:
  ```json
  {
    "companyId": "default_org",
    "accountId": "acc_engineering_ops",
    "vendorId": "vendor_github_enterprise",
    "title": "GitHub Enterprise Annual Renewal",
    "amountUsdc": 2400.0,
    "dueDate": "2026-11-01T00:00:00Z",
    "preferredPaymentRail": "FIAT_PAYOUT",
    "preferredSubMethod": "FEDWIRE",
    "fiatDetails": {
      "accountHolderName": "GitHub Inc",
      "ibanOrAccountNumber": "US99887766554433",
      "routingOrSwift": "121000358",
      "bankCountry": "US"
    }
  }
  ```

#### `GET /api/liabilities`
- **Description**: Returns all scheduled and active liabilities. Supports query parameters `?days=30&accountId=...&status=...`.

#### `PUT /api/liabilities/:id`
- **Description**: Updates an existing liability's schedule, amount, or payment configurations.

#### `DELETE /api/liabilities/:id`
- **Description**: Cancels or freezes a liability.

---

### 2.3 Token Swaps & Multi-Chain Ingestion

#### `POST /api/swaps/estimate`
- **Description**: Queries Circle Swap Kit / LiFi aggregator for real-time exchange rates and minimum output amounts.
- **Request Body**:
  ```json
  {
    "fromChain": "Ethereum",
    "fromToken": "USDT",
    "toChain": "Arc",
    "toToken": "USDC",
    "amount": "10000.000000",
    "slippage": 0.005
  }
  ```

#### `POST /api/swaps/execute`
- **Description**: Executes a multi-token swap and settles funds directly to native Arc USDC.
- **Request Body**:
  ```json
  {
    "accountId": "acc_operating_ops",
    "fromChain": "Ethereum",
    "fromToken": "USDT",
    "toChain": "Arc",
    "toToken": "USDC",
    "amount": "10000.000000",
    "slippage": 0.005
  }
  ```

---

### 2.4 Fiat Funding & Disbursals Endpoints

#### `POST /api/funding/fiat/onramp`
- **Description**: Generates a Circle Mint checkout session and verbatim CLI command for instant credit/debit card on-ramping.

#### `GET /api/funding/fiat/wire-instructions`
- **Description**: Returns institutional BNY Mellon Fedwire deposit instructions with unique tracking memo (`BIZARC-MINT-<ACCOUNT>-<MEMO>`).

#### `POST /api/funding/fiat/deposit-reconcile`
- **Description**: Reconciles a confirmed fiat bank wire or card settlement, crediting liquid balance in PostgreSQL and posting double-entry vouchers.

#### `POST /api/disbursals/fiat`
- **Description**: Direct endpoint to disburse commercial fiat wires (Fedwire, ACH, Push-to-Card, SEPA, SWIFT) via Rail 5.

#### `POST /api/webhooks/circle-mint`
- **Description**: Webhook listener for Circle Mint settlement confirmations (`payout.paid`, `payouts.complete`). Updates status in [fiat_payout_records](file://wsl.localhost/Ubuntu-24.04/home/gifted/BizArc/src/database/repos/fiatPayoutRepo.ts) to `SETTLED`.

---

## 3. Autonomous Tool Registry Reference

The [ToolRegistry](file://wsl.localhost/Ubuntu-24.04/home/gifted/BizArc/src/tools/toolRegistry.ts) provides 30+ deterministic tools to cognitive agents:

### 3.1 Analytics & Operational State Tools

| Tool Name | Parameters | Purpose |
| :--- | :--- | :--- |
| `get_unified_operational_state` | `companyId?: string` | Audits the 8-dimensional operational health, verifying the Tripartite Invariant ($B_E = B_L + B_Y$). |
| `get_unified_asset_distribution`| `companyId?: string` | Aggregates liquid vs. invested capital across all corporate cost centers. |
| `get_account_intelligence` | `accountId: string` | Deep solvency intelligence including committed 30-day liabilities and unencumbered free cash. |
| `get_yield_performance_metrics`| `accountId: string, timeframe?: string` | Historical yield accrual, lifetime deposits, withdrawals, and current APR. |
| `audit_production_readiness` | `companyId?: string` | Audits the 8 core production readiness pillars. |

---

### 3.2 Dynamic Records & Liabilities Tools

| Tool Name | Parameters | Purpose |
| :--- | :--- | :--- |
| `read_dynamic_records` | `accountId: string` | Reads Dynamic Record 1 (Liabilities) and Dynamic Record 2 (Safe-to-Invest). |
| `recalculate_safe_to_invest` | `accountId: string, horizonSeconds?: number` | Computes the investable margin taking into account upcoming debts and reserve floors. |
| `add_account_liability` | `accountId, vendorId, title, amountUsdc, dueDate, preferredPaymentRail, ...` | Stages a forensic-verified obligation in Dynamic Record 1. |
| `edit_account_liability` | `liabilityId, updates` | Modifies schedule or amount of an existing commitment. |
| `remove_account_liability` | `liabilityId` | Cancels or un-stages a liability. |
| `scan_predictive_liabilities` | `accountId: string, leadTimeHours?: number` | Scans obligations approaching execution thresholds. |

---

### 3.3 Verification, 3-Way Match & Payee Protection Tools

| Tool Name | Parameters | Purpose |
| :--- | :--- | :--- |
| `verify_three_way_match` | `vendorId, poHash, invoiceHash, poAmountUsdc, invoiceAmountUsdc, payoutAddress, deliveryVerified` | Compares PO, delivery proof, and invoice demands (Rule 2 & 5). |
| `check_vendor_master` | `vendorId?: string, payoutAddress?: string` | Verifies vendor identity, immutable `change_lock`, and banking details (Rule 3). |
| `ingest_enterprise_documents` | `companyId, documents: Array<{ title, content, type }>` | Ingests corporate agreements into pgvector Vector Memory. |

---

### 3.4 Security & Two-Layer Gatekeeper Tools

| Tool Name | Parameters | Purpose |
| :--- | :--- | :--- |
| `evaluate_reason_bearing_intent`| `proposedAction, accountId, amountUsdc, declaredReason, ...` | Evaluates Tier A & B rules; issues single-use clearance code or escalates to SPRS. |
| `request_human_approval` | `actionType, reason, amountUsdc, payload` | Creates an EIP-712 Standardized Permission Request (SPRS). |
| `authorize_transaction_intent` | `permissionRequestId, adminSignature` | Verifies human EIP-712 signature and releases held transaction. |
| `trigger_emergency_circuit_breaker` | `reason: string` | Instantly halts all autonomous sweeps and scheduled disbursals across the swarm. |

---

### 3.5 Payment Routing, Swaps & Execution Tools

| Tool Name | Parameters | Purpose |
| :--- | :--- | :--- |
| `qualify_disbursal_route` | `liabilityId: string, primaryAccountId: string, amountUsdc: number` | Evaluates single vs. multi-account waterfall allocation while isolating payroll. |
| `execute_disbursal_route` | `liabilityId, primaryAccountId, amountUsdc, recipientAddress, clearanceCode` | Executes payment through DisbursalVault on Arc L1. |
| `convert_crypto_to_fiat_payout` | `sourceAccountId, amountUsdc, beneficiaryBank, vendorId?, adminSignature?` | Dispatches fiat payout across Rails 5 (Fedwire, ACH, Push-to-Card, SEPA, SWIFT). |
| `route_universal_payment` | `intent: UniversalDisbursalIntent, adminSignature?, overrideRail?` | Direct dispatch across the Universal Payment Router. |
| `estimate_token_swap` | `fromChain, fromToken, toChain, toToken, amount, slippage?` | Queries Swap Kit / LiFi for multi-chain quotes. |
| `execute_token_swap` | `fromChain, fromToken, toChain, toToken, amount, slippage?` | Executes multi-chain swap and settles into Arc native USDC. |
| `sweep_excess_liquidity` | `accountId: string, amountUsdc: number, clearanceCode: string` | Sweeps idle liquid cash into USYC on Arc L1. |
| `recall_invested_liquidity` | `accountId: string, amountUsdc: number, clearanceCode: string` | Recalls invested USYC shares back into operating cash. |
| `transfer_account_liquidity` | `sourceAccountId, targetAccountId, amountUsdc, reason, clearanceCode` | Inter-account cost-center transfer. |

---

### 3.6 Accounting, Witnessing & Vector Tools

| Tool Name | Parameters | Purpose |
| :--- | :--- | :--- |
| `post_document_linked_gl` | `accountId, debitAccount, creditAccount, amountUsdc, documentRef, txHash?` | Appends double-entry voucher to Master System Journal with sequential SHA-256 hash. |
| `witness_and_reconcile` | `accountId: string, txHash: string` | Confirms transaction receipt on Arc L1 RPC node and validates state. |
| `query_vector_memory` | `query: string, collection?: string, limit?: number` | Semantic similarity search across corporate bylaws, MSAs, and ERP POs. |

---

## 4. Verification and Reference Files

- Ingress HTTP Server: [systemHttpServer.ts](file://wsl.localhost/Ubuntu-24.04/home/gifted/BizArc/src/ingress/systemHttpServer.ts)
- Tool Registry Implementation: [toolRegistry.ts](file://wsl.localhost/Ubuntu-24.04/home/gifted/BizArc/src/tools/toolRegistry.ts)
- Universal Router: [universalPaymentRouter.ts](file://wsl.localhost/Ubuntu-24.04/home/gifted/BizArc/src/payments/universalPaymentRouter.ts)
- Token Swap Service: [tokenSwapService.ts](file://wsl.localhost/Ubuntu-24.04/home/gifted/BizArc/src/services/tokenSwapService.ts)
- Fiat Funding Service: [fiatFundingService.ts](file://wsl.localhost/Ubuntu-24.04/home/gifted/BizArc/src/services/fiatFundingService.ts)
