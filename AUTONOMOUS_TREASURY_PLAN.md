# Autonomous Multi-Agent Treasury & Financial Operations Platform
## Implementation Plan: Translating Product Vision to Architecture & Code

---

### Core Architectural Principle: Autonomous Cognitive Agency Governed by Smart Contract Safety Envelopes

A key danger in designing financial AI systems is over-rotating into either extreme:
1. **The Unsafe Extreme (Pure Prompt Agency)**: Relying on LLM system prompts to prevent unauthorized spending or enforce limits. Prompts can be bypassed by prompt injection, hallucinations, or malformed outputs.
2. **The Passive Extreme (Pure Deterministic Scripts)**: Hardcoding rigid `if/else` checks and cron jobs into smart contracts or backend daemons, stripping the AI agents of all reasoning, judgment, perception, and proactive initiative.

This platform implements the **Dual-Layer Autonomous Treasury Architecture**:
* **Layer 1: The Autonomous Cognitive Agent Swarm (The Brain & Driver)**:
  - The AI agents possess true autonomous agency: they observe real-time balance changes, ingest messy unstructured invoices and receipts, forecast dynamic liquidity horizons, actively discover zombie SaaS subscriptions and pricing anomalies, deliberate over optimal inter-account fund flows, and execute financial decisions.
  - **Inside the Rules**: For routine operations within business policy (sweeps to USYC, pre-funding accounts for scheduled pre-approved bills, inter-account liquidity leveling), **the agents act completely on their own** and record their actions into the dual audit log.
  - **Outside the Rules**: When an action breaches standard parameters (unregistered vendors, address deviations, large transfers, or subscription renewals requiring review), **the agent proactively consults the human admin**, formulating a rich Standardized Permission Request (SPRS) with full financial context and clear binary options: `APPROVE` or `CANCEL_WITH_INSTRUCTIONS`.
  - **Segregation of Duties**: The agent that executes an action or moves money is strictly separated from the independent witness agent that verifies on-chain receipts and updates the associated double-entry and audit records.
  - **Unified & Parallel Mental Model**: The agents maintain a real-time parallel record of total available capital (liquid cash + tokenized yield shares), evaluating solvency and qualifying accounts based on total effective buying power rather than misleading liquid-only snapshots.
* **Layer 2: The Smart Contract Guardrail Envelope (The Inviolable Safety Cage)**:
  - Smart contracts on Arc L1 (`CentralTreasuryYieldVault.sol` and `DisbursalVault.sol`) enforce non-bypassable physical guardrails: onchain vendor allowlists, daily spending hard caps, registered-account locks for recalls, and EIP-712 human signature thresholds.
  - The contracts do not make subjective business decisions—they ensure that even under catastrophic model hallucination or key compromise, company funds cannot be drained to unauthorized parties or exceed daily risk boundaries.

---

### Methodology & Execution Protocol
This document translates the complete product vision into an exhaustive technical implementation plan. It proceeds sentence-by-sentence through the original specification, detailing how the multi-agent cluster and smart contracts coordinate at every step.

---

# SECTION 1: Automated Treasury Yield Engine (Dynamic Safe-to-Invest & USYC Sweeps)

## [Sentence 1]
> **"PROBLEM: MONEY SITS IDLE, IT NEEDS TO BE INVESTED THEN MOVED WHEN NEEDED"**

### Technical Analysis & Skill Mapping
- **Skills Consulted**: 
  - [`build-on-arc`](file:///C:/Users/hp/.gemini/config/skills/build-on-arc/SKILL.md) (EVM Differences, Native vs ERC-20, Sub-second Finality)
  - [`use-usdc`](file:///C:/Users/hp/.gemini/config/skills/use-usdc/SKILL.md) (USDC 6-decimal standard, Approvals, Transfers)
  - [`agents-and-ledgers`](file:///C:/Users/hp/.gemini/config/skills/agents-and-ledgers/SKILL.md) (Loud Rounding, Precision Handling, Document-Linked Ledgers)
- **The Core Problem**: In conventional business banking and standard crypto operations, working capital sits stagnant in operational zero-yield accounts awaiting bill settlement. Over weeks and months, holding liquid non-yielding cash incurs an opportunity cost (typically 4.5%–5.2% APR in tokenized short-term US Treasury bills). However, traditional financial systems lock funds into T-bill maturities or mutual funds that take 1–3 business days (T+1/T+2) to liquidate, meaning funds cannot be moved immediately when an unforeseen operational expense arises.
- **Architectural Solution on Arc**:
  - Operating cash is held in native USDC on **Arc L1** (`0x3600000000000000000000000000000000000000`).
  - Arc's deterministic sub-second finality ($<1\text{s}$ block confirmation) combined with native USDC gas (~$0.01 per transaction, paid directly in USDC with minimum `maxFeePerGas = 20 Gwei`) makes micro-liquidity movements economically viable. An agent can deposit into yield at 9:00 AM and pull it back out at 9:15 AM without gas fees eroding the yield.
  - Idle funds are directed into **USYC** (Hashnote US Yield Coin, an ERC-4626 tokenized money market fund backed by short-term US Treasuries and repo agreements).

---

## [Sentence 2]
> **"SOLUTION: SINCE THE AGENT KNOWS WE HAVE A USYC ACCOUNT TO MOVE THE"**

### Technical Analysis & Skill Mapping
- **Skills Consulted**:
  - [`build-on-arc/references/app_kit_guide.md`](file:///C:/Users/hp/.gemini/config/skills/build-on-arc/references/app_kit_guide.md) (App Kit Earn Kit `@circle-fin/earn-kit`)
  - [`use-developer-controlled-wallets`](file:///C:/Users/hp/.gemini/config/skills/use-developer-controlled-wallets/SKILL.md) (Wallet Sets, Entity Secrets, Programmatic Custody)
  - [`use-smart-contract-platform`](file:///C:/Users/hp/.gemini/config/skills/use-smart-contract-platform/SKILL.md)
- **The Core Problem**: The system must have a designated onchain yield vehicle with programmatic discovery, preview, deposit, and redemption capabilities that does not compromise account-level accounting separation.
- **Architectural Solution**:
  1. Deploy a core smart contract on Arc: `CentralTreasuryYieldVault.sol`.
  2. The vault interacts with the underlying USYC ERC-4626 implementation:
     - `deposit(uint256 assets, address receiver)`: Deposits USDC, mints USYC yield shares.
     - `redeem(uint256 shares, address receiver, address owner)`: Burns USYC yield shares, returns liquid USDC.
     - `convertToAssets(uint256 shares)`: Real-time NAV exchange rate calculator.
  3. Integrated via Circle App Kit Earn Kit (`@circle-fin/earn-kit`) with the `@circle-fin/app-kit/adapters/circle-wallets` adapter for developer-controlled wallets or `@circle-fin/adapter-viem-v2` for EOA/SCA execution.
  4. The vault maintains an onchain mapping `mapping(bytes32 accountId => uint256 shares)` so that each corporate account's stake in the central yield fund is segregated, traceable, and cannot be commingled or spent by another account.

---

## [Sentence 3]
> **"THE AGENT HAS TO KEEP TWO TYPES OF RECORDS - A DYNAMIC RECORD OF EACH LIABILITY FOR EACH ACCOUNT AND THE DATE FOR THE RECURRING PAYMENT FOR EACH LIABILITY FOR EACH ACCOUNT."**

### Technical Analysis & Skill Mapping
- **Skills Consulted**:
  - [`agents-and-ledgers`](file:///C:/Users/hp/.gemini/config/skills/agents-and-ledgers/SKILL.md) (Rule 1: Document-Linked Ledgers Only, Rule 2: Three-Way Match)
  - [`agents-and-ledgers/examples/safe_agent_ledger_guard.py`](file:///C:/Users/hp/.gemini/config/skills/agents-and-ledgers/examples/safe_agent_ledger_guard.py)
  - [`use-circle-wallets`](file:///C:/Users/hp/.gemini/config/skills/use-circle-wallets/SKILL.md)
- **The Core Problem**: Most automated treasury systems fail because they treat liabilities as static notes in spreadsheets or unlinked calendar alerts. If an agent does not have a formal, document-linked dynamic registry of liabilities per account, it cannot distinguish between idle cash that is genuinely free to invest and cash that is already committed to an upcoming payroll or server bill.
- **Architectural Solution**:
  1. The `LiabilityRegistryAgent` maintains an immutable document-linked relational liability ledger (`AccountLiabilities`):
     ```sql
     CREATE TABLE account_liabilities (
         liability_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
         account_id VARCHAR(64) NOT NULL,
         vendor_id VARCHAR(64) NOT NULL,
         title VARCHAR(255) NOT NULL,
         category VARCHAR(32) NOT NULL, -- 'SUBSCRIPTION', 'DEBT_SERVICE', 'PAYROLL', 'MILESTONE'
         amount_usdc NUMERIC(18, 6) NOT NULL, -- Exactly 6 decimals matching Arc USDC
         due_date TIMESTAMPTZ NOT NULL,
         frequency_cron VARCHAR(64), -- e.g., '0 0 1 * *' for monthly 1st
         payout_address VARCHAR(42) NOT NULL, -- Verified payout address
         source_po_hash VARCHAR(66), -- Document link: Purchase Order SHA256
         source_invoice_hash VARCHAR(66), -- Document link: Invoice SHA256
         status VARCHAR(32) NOT NULL DEFAULT 'SCHEDULED', -- 'SCHEDULED', 'AWAITING_APPROVAL', 'DISBURSED', 'CANCELLED'
         created_at TIMESTAMPTZ DEFAULT NOW(),
         updated_at TIMESTAMPTZ DEFAULT NOW()
     );
     CREATE INDEX idx_account_liabilities_due ON account_liabilities(account_id, due_date, status);
     ```
  2. Every single recurring payment is anchored by a verified agreement hash (`source_po_hash`) and linked directly to the specific business account responsible for paying it.

---

## [Sentence 4]
> **"AND A DYNAMIC RECORD OF HOW MUCH IS SAFE TO BE INVESTED FROM EACH ACCOUNT AND THE EXPECTED TIME LIMIT FOR THAT INVESTMENT."**

### Technical Analysis & Skill Mapping
- **Skills Consulted**:
  - [`agents-and-ledgers`](file:///C:/Users/hp/.gemini/config/skills/agents-and-ledgers/SKILL.md) (Rule 5: Refuse Silent Rounding, Rule 6: Deterministic Validation)
  - [`agent-wallet-policy`](file:///C:/Users/hp/.gemini/config/skills/agent-wallet-policy/SKILL.md) (Spending Limits & Spending Policies)
  - [`use-usdc`](file:///C:/Users/hp/.gemini/config/skills/use-usdc/SKILL.md) (Integer arithmetic, no float inaccuracy)
- **The Core Problem**: Investing funds without a mathematically bounded horizon leads to either premature liquidation penalties/friction or, worse, bouncing a vendor payment due to illiquidity. The agent must maintain a live, second-by-second evaluation of the **Liquidity Horizon** for each account.
- **Architectural Solution**:
  1. The agent maintains the `AccountLiquidityHorizon` model:
     - `LiquidBalance` ($B_L$): Uninvested liquid native USDC residing in the account's Arc address.
     - `CommittedLiabilities` ($L_{T}$): Total liabilities scheduled within the rolling investment evaluation window.
     - `OperatingFloor` ($F_{\text{op}}$): Mandatory non-investable cash buffer per account.
     - `SafetyBufferMultiplier` ($S_{\text{ratio}}$): Safety coverage factor.
  2. **Configurable Environment Profiles (Demo vs Production)**:
     - To ensure small testnet balances (e.g., $10–$50 faucet USDC) actually trigger automated sweeps and testable demonstrations, all threshold parameters are fully parameterized:
     
     | Parameter | `HACKATHON_DEMO` / Testnet | `PRODUCTION` Enterprise |
     | :--- | :---: | :---: |
     | `OperatingFloor` ($F_{\text{op}}$) | **$1.00 USDC** | $500.00 USDC |
     | `SafetyBufferMultiplier` ($S_{\text{ratio}}$) | **1.05×** | 1.20× |
     | `MinSweepThreshold` | **$0.50 USDC** | $100.00 USDC |
     | `EvaluationWindow` ($T$) | **3 days** (or 2 hours) | 30 days |
     | `InvestHysteresisBand` ($\Delta_{\text{invest}}$) | **$0.50 USDC** | $250.00 USDC |
     | `RecallHysteresisBand` ($\Delta_{\text{recall}}$) | **$0.25 USDC** | $100.00 USDC |

  3. **Safe-to-Invest Formula with Hysteresis**:
     $$\text{TargetReserve} = \left( \sum_{i \in \text{Liabilities}_{T}} \text{amount}_i \times S_{\text{ratio}} \right) + F_{\text{op}}$$
     $$\text{SafeToInvest} = \max\left(0, B_L - (\text{TargetReserve} + \Delta_{\text{invest}})\right)$$
  4. **Time Horizon & Explicit USYC Redemption Latency Tiers**:
     - Redemption lead time is an explicit parameter dictated by USYC's real-world operational structure:
       - **Tier A (Onchain Instant Liquidity Buffer)**: $\text{LeadTime} = 900\text{ seconds}$ (15 minutes).
       - **Tier B (Hashnote Daily Batch T+0)**: $\text{LeadTime} = 28,800\text{ seconds}$ (8 hours).
       - **Tier C (Standard T+1 Mutual Fund Queue)**: $\text{LeadTime} = 86,400\text{ seconds}$ (24 hours; 48–72h over banking holidays).
     - $\text{TimeHorizonSeconds} = \min_{i}(\text{due\_date}_i) - \text{now} - \text{REDEMPTION\_LEAD\_TIME\_SECONDS}$.

---

## [Sentence 5]
> **"THIS IS CALCULATED FROM THE BALANCE AND LIABILITY USING A PREDEFINED INVESTMENT RULE AND IS RECALCULATED ANYTIME THE BALANCE OF THE ACCOUNT CHANGES FROM FUNDING OR MONEY IS MOVED OUT."**

### Technical Analysis & Skill Mapping
- **Skills Consulted**:
  - [`build-on-arc`](file:///C:/Users/hp/.gemini/config/skills/build-on-arc/SKILL.md) (Section 2: System Emitter Predeploy `0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE`)
  - [`use-circle-wallets`](file:///C:/Users/hp/.gemini/config/skills/use-circle-wallets/SKILL.md) (Webhooks and Event Subscriptions)
- **The Core Problem: Feedback Loops, Event Cascades, and Churn**:
  - Every USDC `Transfer` event triggers recalculation.
  - However, the sweep itself transfers USDC (`Account` $\to$ `Vault`), emitting a `Transfer` event.
  - A recall transfers USDC (`Vault` $\to$ `Account`), emitting another `Transfer` event.
  - A naive reactive loop would recalculate upon its own transactions, generating recursive calls, race conditions, and fee-wasting transaction churn.
- **Architectural Solution: Feedback Prevention, Debouncing, and Hysteresis**:
  1. **Internal Event Filtering & Origin Tagging**:
     - The WebSocket event listener identifies the transaction sender (`tx.from`) and recipient (`tx.to`).
     - If the transfer is emitted by the `CentralTreasuryYieldVault` or signed by `TreasurySweeperAgent`, it is classified as `INTERNAL_SETTLEMENT`.
     - `INTERNAL_SETTLEMENT` updates in-memory ledger records without triggering a new investment evaluation pipeline.
  2. **Account In-Flight Action Locks**:
     - When an account begins an onchain transaction, the agent sets `account_locks[account_id] = true`.
     - While locked, all reactive sweep/recall evaluations for that account are suppressed until the transaction receipt is confirmed and reconciled by `LedgerWitnessAgent`.
  3. **Event Debouncing & Rate Limiting**:
     - Balance mutation events pass through a sliding debounce window (`DEBOUNCE_WINDOW_MS = 5000` / 5 seconds).
     - Rapid multiple micro-transfers (e.g. streaming payments or batched customer receipts) collapse into a single atomic recalculation.
     - A cooldown period (`MIN_ACTION_COOLDOWN_SECONDS = 30`) prevents back-to-back automated sweeps.
  4. **Hysteresis Deadband**:
     - The gap between the sweep threshold ($\text{TargetReserve} + \Delta_{\text{invest}}$) and the recall threshold ($\text{TargetReserve} - \Delta_{\text{recall}}$) ensures that minor balance fluctuations around the reserve target do not trigger continuous oscillatory deposits and withdrawals.
  5. If after debouncing and hysteresis evaluation, $\text{SafeToInvest} \ge \text{MinSweepThreshold}$ (e.g. $\$0.50$ in demo, $\$100$ in prod), the sweep intent is safely dispatched.

---

## [Sentence 6]
> **"AFTER THE RECALCULATION, THE CALCULATED FUNDS ARE IMMEDIATELY TRANSFERRED TO THE CENTRAL USYC INVESTMENT ACCOUNT ."**

### Technical Analysis & Skill Mapping
- **Skills Consulted**:
  - [`use-developer-controlled-wallets`](file:///C:/Users/hp/.gemini/config/skills/use-developer-controlled-wallets/SKILL.md) (Smart Contract Execution, `createContractExecutionTransaction`)
  - [`build-on-arc`](file:///C:/Users/hp/.gemini/config/skills/build-on-arc/SKILL.md) (EVM Mempool 20 Gwei floor, $<1\text{s}$ Deterministic Finality)
  - [`use-usdc`](file:///C:/Users/hp/.gemini/config/skills/use-usdc/SKILL.md) (ERC-20 approve and transfer lifecycle)
- **The Core Problem**: In traditional multi-sig or manual banking, sweeping cash requires humans to log into banking portals and approve ACH sweeps. By the time it happens, hours or days have passed. On Arc, where transactions confirm in under 1 second for roughly 1 cent of USDC gas, the sweep can and should be immediate.
- **Architectural Solution & Caller Role Architecture**:
  1. **Resolving the Caller Role Mismatch**:
     - Individual corporate account wallets (`Account_1`, `Account_2`) do **NOT** hold `SWEEPER_ROLE` and do **NOT** initiate sweeps themselves.
     - A dedicated autonomous bot—the **`TreasurySweeperAgent`**—is granted `SWEEPER_ROLE` on `CentralTreasuryYieldVault.sol`.
     - During onboarding, each account wallet executes a one-time (or periodically refreshed) ERC-20 `approve(CentralTreasuryYieldVault, type(uint256).max)` on the Arc USDC predeploy (`0x3600000000000000000000000000000000000000`).
     - When `SafeToInvest` is calculated, `TreasurySweeperAgent` calls:
       `vault.sweepFromAccount(accountId, accountWalletAddress, safeToInvestUnits)`.
     - Inside `CentralTreasuryYieldVault.sol`:
       ```solidity
       function sweepFromAccount(
           bytes32 accountId, 
           address accountWallet, 
           uint256 usdcAmount
       ) external onlyRole(SWEEPER_ROLE) {
           require(registeredAccounts[accountId] == accountWallet, "Account mismatch");
           require(usdcAmount > 0, "Zero sweep");
           // Pull funds from account wallet using its pre-approved allowance
           require(usdc.transferFrom(accountWallet, address(this), usdcAmount), "USDC transfer failed");
           
           usdc.approve(address(usyc), usdcAmount);
           uint256 sharesMinted = usyc.deposit(usdcAmount, address(this));
           
           accountShares[accountId] += sharesMinted;
           totalVaultShares += sharesMinted;
           emit FundsSweptToYield(accountId, usdcAmount, sharesMinted);
       }
       ```
  2. **USYC Permissioning & Token Mechanics (Ground Truth vs Theory)**:
     - **Permissioned Asset**: USYC (Hashnote US Yield Coin) is an institutional token representing shares in a Cayman-domiciled mutual fund. It is **not permissionless**.
     - Holding or transacting USYC requires KYC/KYB accreditation, and addresses must be registered on Hashnote's smart contract allowlist (`isWhitelisted(address)` check on the token contract).
     - **Smart Contract Implication**: `CentralTreasuryYieldVault.sol` itself must be submitted to Hashnote for KYC onboarding and added to their allowlist to hold USYC.
     - **Testnet & Hackathon Architecture**:
       - In testing and staging environments where manual Hashnote allowlisting is unavailable, the system interfaces with a verified `MockUSYCVault.sol` implementing exact ERC-4626 specifications and NAV exchange rate simulation.
       - In production, the vault is allowlisted directly with Hashnote, or operates via an institutional prime brokerage integration.


---

## [Sentence 7]
> **"ANYTIME ANY ACTION IS CARRIED OUT OR FUNDING OCCURS, A SEPERATE AGENT UPDATES THE ASSOCIATED RECORD"**

### Technical Analysis & Skill Mapping
- **Skills Consulted**:
  - [`agents-and-ledgers`](file:///C:/Users/hp/.gemini/config/skills/agents-and-ledgers/SKILL.md) (Rule 4: Independent External Witness, Segregation of Duties)
  - [`agents-and-ledgers/references/accounting_controls_guide.md`](file:///C:/Users/hp/.gemini/config/skills/agents-and-ledgers/references/accounting_controls_guide.md) (Section 1: The Six Errors, Section 2: Onchain Ledger Limits)
- **The Core Problem**: If the same agent that *moves* the money also *writes* the accounting records, an agent hallucination, unhandled network exception, or rogue prompt injection can execute a transfer and falsify the ledger (or fail to record it, committing an Error of Omission).
- **Architectural Solution: Strict Segregation of Duties**:
  1. **`TreasuryExecutionAgent` (The Mover)**: Has API access to sign transactions via Circle SDK, but **zero write access** to the double-entry accounting database or ledger records.
  2. **`LedgerWitnessAgent` (The Auditor & Witness)**:
     - Has **zero private keys or wallet signing ability**.
     - Listens directly to the Arc blockchain via independent RPC and Circle Webhook feed.
     - When a block confirms a transaction, `LedgerWitnessAgent` extracts the verified receipt:
       - Confirms the sender, recipient, amount, block height, and timestamp.
       - Generates the formal double-entry voucher:
         - **Debit**: `Asset:Investments:USYC:Account_<ID>` ($+\text{Amount}$)
         - **Credit**: `Asset:Cash:USDC:Account_<ID>` ($-\text{Amount}$)
       - Appends a tamper-evident record into the hash-chained `MasterSystemJournal`.

---

## [Sentence 8]
> **"ANY TIME THE AGENT WANTS TO PERFORM AN ACTION THAT ENTAILS MOVING MONEY FROM AN ACCOUNT AND THE MONEY IS INVESTED ESPECIALLY DURING PAYMENTS, THE AGENT WILL WITHDRAW THE EQUIVALENT AMOUNT FROM THE USYC ACCOUNT TO THE TARGET ACCOUNT."**

### Technical Analysis & Skill Mapping
- **Skills Consulted**:
  - [`build-on-arc/references/app_kit_guide.md`](file:///C:/Users/hp/.gemini/config/skills/build-on-arc/references/app_kit_guide.md) (Earn Kit Redeem)
  - [`use-developer-controlled-wallets`](file:///C:/Users/hp/.gemini/config/skills/use-developer-controlled-wallets/SKILL.md) (Contract Executions)
  - [`agents-and-ledgers`](file:///C:/Users/hp/.gemini/config/skills/agents-and-ledgers/SKILL.md) (Pre-Payment Verification Checklist)
- **The Core Problem**: Traditional treasury software treats investments as locked; when a bill comes in, the transaction fails with "Insufficient Funds" because it only looks at the checking account. The agent must orchestrate an automated pre-flight liquidation.
- **Architectural Solution & Onchain Enforcement**:
  1. **Strict Registered Recipient Lock (No Arbitrary Recipients)**:
     - The contract **strictly forbids** passing an arbitrary `recipient` address to `recallForAccount`.
     - The recipient is hardcoded onchain:
       `address targetWallet = registeredAccounts[accountId];`
       `require(targetWallet != address(0), "Account not registered");`
     - Recalled funds **can only ever land in the account's own registered wallet** (or the approved `DisbursalVault`). Even if an agent's private key or `DISBURSAL_ROLE` is compromised, funds cannot be drained to an external address via the recall function.
  2. **ERC-4626 Precision: Using `withdraw` Instead of `redeem`**:
     - **The Rounding Trap**: `IERC4626.redeem(shares)` takes an input of shares and rounds assets *down*. If an agent calculates shares for $\$1,000.000000$, `redeem` might deliver $\$999.999999$. The subsequent $\$1,000$ payment will immediately revert due to a $1$-micro-unit shortfall.
     - **The Fix**: Call `IERC4626.withdraw(assets, receiver, owner)`. The `withdraw` method specifies the *exact desired assets* ($\Delta$), and rounds the burned shares *up* in favor of the vault.
  3. **Verification of Amount Actually Received**:
     ```solidity
     uint256 balanceBefore = usdc.balanceOf(targetWallet);
     
     // Execute ERC-4626 withdraw targeting exact assets
     uint256 sharesBurned = usyc.withdraw(usdcAmount, targetWallet, address(this));
     
     uint256 actualReceived = usdc.balanceOf(targetWallet) - balanceBefore;
     require(actualReceived >= usdcAmount, "Redemption precision shortfall");
     
     // Deduct exact shares burned from account's balance
     require(accountShares[accountId] >= sharesBurned, "Insufficient account shares");
     accountShares[accountId] -= sharesBurned;
     totalVaultShares -= sharesBurned;
     ```
  4. **USYC Instant Liquidity Capacity & Fallback**:
     - Real-world USYC maintains an on-chain instant redemption liquidity buffer.
     - If $\Delta$ exceeds Hashnote's instant liquidity capacity, the transaction does not execute in $<1\text{s}$; it must enter Hashnote's queued redemption flow.
     - The agent's `LiquidityCalculatorEngine` queries the USYC contract's max immediate withdrawable assets (`usyc.maxWithdraw(address(this))`) before proposing an immediate liquidation. If instant liquidity is constrained, the agent alerts the operator and draws from other liquid operating accounts.


---

## [Sentence 9]
> **"AFTER PUTTING MONEY INTO THE USYC ACCOUNT, THE AGENT KEEPS A PARRALLEL RECORD THAT SHOWS HOW MUCH THE ACCOUNT HAS PLUS THE MONEY INVESTED."**

### Technical Analysis & Skill Mapping
- **Skills Consulted**:
  - [`unify-balance/references/check-balance.md`](file:///C:/Users/hp/.gemini/config/skills/unify-balance/references/check-balance.md)
  - [`agents-and-ledgers`](file:///C:/Users/hp/.gemini/config/skills/agents-and-ledgers/SKILL.md) (Dual-Currency/Commodity Split, GnuCash/Beancount models)
- **The Core Problem**: If the accounting record only shows the onchain liquid checking balance, business operators and decision engines think the account is depleted. Conversely, if it only shows total invested, it obscures what is directly spendable right now.
- **Architectural Solution**:
  1. Implement a **Parallel Tripartite Balance Model** for each account:
     - `LiquidBalanceUSDC` ($B_L$): Real-time native USDC tokens held in the wallet.
     - `InvestedYieldUSDC` ($B_Y$): Real-time USDC valuation of USYC shares owned ($\text{Shares} \times \text{ExchangeRate}$).
     - `TotalEffectiveBalanceUSDC` ($B_E = B_L + B_Y$): Comprehensive capital position.
  2. The `LedgerWitnessAgent` maintains a synchronized real-time view:
     ```json
     {
       "account_id": "acc_engineering_ops",
       "liquid_balance_usdc": "20.000000",
       "invested_yield_usdc": "80.000000",
       "total_effective_balance_usdc": "100.000000",
       "last_oracle_nav_update": "2026-10-01T03:10:00Z"
     }
     ```

---

## [Sentence 10]
> **"SUCH THAT SAY WE HAVE 100 DOLLAR AND 80 WAS INVESTED, THE ACCOUNT DETAILS MUST ALSO SHOW THAT THE AVAILABLE BALANCE IS 100 SO THAT WE WILL USE THIS BALANCE WHEN MAKING DECISIONS FOR MOEY MOVEMENT TRANSACTIONS"**

### Technical Analysis & Skill Mapping
- **Skills Consulted**:
  - [`unify-balance`](file:///C:/Users/hp/.gemini/config/skills/unify-balance/SKILL.md) (Unified Spend abstraction)
  - [`circle-agent-stack`](file:///C:/Users/hp/.gemini/config/skills/circle-agent-stack/SKILL.md) (Decision Engines)
- **The Core Problem**: If the decision logic checks `if (liquid_balance >= payment_amount)`, it will reject an $\$80$ payment when liquid is $\$20$ and invested is $\$80$, falsely claiming insolvency.
- **Architectural Solution**:
  1. In the `PaymentRoutingEngine` and all autonomous decision heuristics:
     - The **Solvency Qualification Check** evaluates `TotalEffectiveBalanceUSDC`:
       $$\text{IsSolvent} = (B_E - \text{CommittedLiabilities}) \ge \text{TransactionAmount}$$
     - In the user's example ($B_L = 20$, $B_Y = 80$, $B_E = 100$):
       - If a $\$90$ transaction is proposed, the agent registers the account as **Qualified** ($100 \ge 90$).
       - It generates an execution plan:
         - Liquid withdrawal from USYC: $\$70$.
         - Spend from existing liquid: $\$20$.
         - Total payment disbursed: $\$90$.
         - Remaining balance: $\$10$ (invested in USYC).

---

## [Sentence 11]
> **"ANYTIME MONEY IS TO BE MOVED FROM AN ACCOUNT OR THE EXPECTED DATE FOR A LIABILITY PAYMENT IS AT A PREDEFINED DISTANCE FROM THE CURRENT TIME, THE AGENT CHECKS IT RECORD AND THE ACCOUNT DETAILS AND FUNDS THE ACCOUNT WITH THE APPROPRIATE AMOUNT FOR THE TRANSACTION TO BE SUCCESSFUL"**

### Technical Analysis & Skill Mapping
- **Skills Consulted**:
  - [`schedule`](file:///C:/Users/hp/.gemini/config/skills/antigravity_guide/SKILL.md) (Predictive Cron Jobs)
  - [`agent-wallet-policy`](file:///C:/Users/hp/.gemini/config/skills/agent-wallet-policy/SKILL.md) (Automated Pre-Funding)
  - [`build-on-arc`](file:///C:/Users/hp/.gemini/config/skills/build-on-arc/SKILL.md)
- **The Core Problem**: Waiting until the exact second an automated bill charges to pull money from USYC creates a race condition; if the vendor initiates an automated direct-debit or recurring contract pull 10 seconds before the agent's cron triggers, the transaction reverts with insufficient balance.
- **Architectural Solution & Parameterized Redemption Scheduling**:
  1. **Explicit Redemption Lead Time Parameter (`REDEMPTION_LEAD_TIME_SECONDS`)**:
     - The pre-funding timing is **not a magic constant**; it is directly configured based on the underlying yield instrument's actual settlement protocol:
       - **Demo / Mock Vault**: `REDEMPTION_LEAD_TIME_SECONDS = 300` (5 minutes, for rapid demo verifications).
       - **USYC Instant Liquidity Tier**: `REDEMPTION_LEAD_TIME_SECONDS = 3600` (1 hour, utilizing onchain instant redemption capacity).
       - **USYC Queued / Batch Settlement Tier**: `REDEMPTION_LEAD_TIME_SECONDS = 86400` (24 hours, accommodating Hashnote T+0/T+1 fund processing).
       - **Weekend / Holiday Buffer**: If `due_date` falls on a weekend or bank holiday, an automatic extension buffer adds 48 hours to account for mutual fund NAV pricing freezes.
  2. **Predictive Pre-Funding Daemon (`PredictiveRefunderService`)**:
     - Runs every 15 minutes.
     - Scans `AccountLiabilities` for all active entries where:
       $$\text{due\_date} - \text{now} \le \text{REDEMPTION\_LEAD\_TIME\_SECONDS} \quad \text{AND} \quad \text{status} == \text{'SCHEDULED'}$$
     - Computes net projected liquid shortfall:
       $$\text{Shortfall} = \max(0, \text{amount\_usdc} - B_L)$$
     - If $\text{Shortfall} > 0$:
       - Automatically triggers `CentralTreasuryYieldVault.recallForAccount(accountId, Shortfall)`.
       - Funds land in `registeredAccounts[accountId]`, guaranteeing that when the billing event fires at `due_date`, liquid cash is already 100% in place.

---

# SECTION 2: Subscriptions & Recurring Liabilities Management

## [Sentence 12]
> **"PROBLEM: THE SUBSCRIPTIONS CAN BE SO MUCH THAT ADMINS MIGHT LOOSE TRACK OR FIND IT CUMBERSOME TO TRACK AND KEEP TABS WITH WHICH ACCOUT IS PAYING WHAT"**

### Technical Analysis & Skill Mapping
- **Skills Consulted**:
  - [`agents-and-ledgers`](file:///C:/Users/hp/.gemini/config/skills/agents-and-ledgers/SKILL.md) (Rule 1: Document-Linked Ledgers, Rule 3: Vendor Master Change Control)
  - [`use-circle-wallets`](file:///C:/Users/hp/.gemini/config/skills/use-circle-wallets/SKILL.md)
- **The Core Problem**: Fast-growing companies accumulate dozens of SaaS subscriptions across multiple corporate cards and crypto wallets. Unused seats renew silently, cancelled services continue debiting, and finance teams lose track of which corporate sub-account is being billed for which tool.
- **Architectural Solution**:
  1. Deploy the `LiabilityRadarAgent` acting as a continuous active subscription monitor.
  2. Subscriptions are not just text strings—they are formal onchain/offchain entity models bound to:
     - Specific internal account / cost center.
     - Authorized vendor master entry.
     - Maximum authorized renewal threshold.

---

## [Sentence 13]
> **"SOLUTION: AGENTS WITH OVERVIEW OVER EVERY ACCOUNT, KEEPING AND MANAGING A RECORD OF THE DETAILS OF EVERY ACCOUNT INCLUDING A LIST OF RECURRING LIABILITIES ON THE ACCOUNT LIKE SUBSCRIPTION AND DEBTS WITH THEIR PAYMENT TIME AND DATE."**

### Technical Analysis & Skill Mapping
- **Skills Consulted**:
  - [`use-developer-controlled-wallets`](file:///C:/Users/hp/.gemini/config/skills/use-developer-controlled-wallets/SKILL.md) (Wallet Sets & Metadata)
  - [`agents-and-ledgers/examples/safe_agent_ledger_guard.py`](file:///C:/Users/hp/.gemini/config/skills/agents-and-ledgers/examples/safe_agent_ledger_guard.py)
- **The Core Problem**: Siloed accounts prevent a holistic view of financial obligations.
- **Architectural Solution**:
  1. The `LiabilityRadarAgent` maintains the `CorporateAccountOverview` cache:
     ```typescript
     interface CorporateAccountOverview {
       accountId: string;
       name: string;
       role: "OPEX" | "CAPEX" | "PAYROLL" | "TREASURY_RESERVE";
       arcWalletAddress: `0x${string}`;
       liquidUsdc: bigint;
       investedUsyc: bigint;
       totalEffectiveUsdc: bigint;
       recurringLiabilities: RecurringLiabilityItem[];
     }

     interface RecurringLiabilityItem {
       liabilityId: string;
       title: string;
       vendorId: string;
       payoutAddress: `0x${string}`;
       category: "SUBSCRIPTION" | "DEBT" | "CONTRACTOR";
       amountUsdc: bigint;
       frequencyCron: string;
       nextPaymentTimestamp: number;
       status: "ACTIVE" | "PAUSED" | "FLAGGED_FOR_REVIEW";
     }
     ```
  2. Every corporate sub-wallet in the Circle Wallet Set is mapped and queried concurrently.

---

## [Sentence 14]
> **"WHEN A PAYMENT IS CLOSE TO ITS PAYMENT DATE, IT NOTIFIES THE ADMIN INCHARGE, WITH WHAT IS BEING PAID FOR AND THE DETAILS OF THE ACCOUNT IT IS TO BE PAID FROM, AND THE ADMIN PROVIDES ONE OF TWO OPTIONS, AN APPROVAL OR CANCELATION WITH INSTRUCTIONS."**

### Technical Analysis & Skill Mapping
- **Skills Consulted**:
  - [`agents-and-ledgers`](file:///C:/Users/hp/.gemini/config/skills/agents-and-ledgers/SKILL.md) (Rule 6: Model Output as Suggestion, Never as Unilateral Release Condition)
  - [`agent-wallet-policy`](file:///C:/Users/hp/.gemini/config/skills/agent-wallet-policy/SKILL.md) (Human Verification Gate)
- **The Core Problem**: Autonomous agents must not have unilateral authority to blindly pay recurring bills without human oversight, as rogue subscription renewals or compromised vendor contracts could drain funds.
- **Architectural Solution**:
  1. **Notification Trigger**: At $T_{\text{notify}} = \text{due\_date} - 48\text{ hours}$:
     - `LiabilityRadarAgent` compiles a structured notification payload.
  2. **Delivery Mechanism**:
     - Dispatched via Webhook / Push Notification to Admin Dashboard / Slack / Telegram with cryptographic auth tokens.
  3. **Strict Binary Human Decision Interface**:
     - **Option 1: APPROVE**:
       - Admin clicks `Approve` (signing an EIP-712 permission payload or generating an admin session approval).
       - Status transitions from `AWAITING_APPROVAL` to `SCHEDULED_FOR_EXECUTION`.
     - **Option 2: CANCEL WITH INSTRUCTIONS**:
       - Admin clicks `Cancel` and provides natural language or structured cancellation instructions (e.g. *"Cancel Zoom subscription because team migrated to Google Meet; contact vendor billing"*).
       - Status transitions to `CANCELLED`.
       - Liability is frozen; the agent dispatches a task to draft cancellation notice to the vendor or flags it in the ledger so no funds can ever be disbursed.

---

## [Sentence 15]
> **"IF THE AGENT NEEDS TO MOVE MONEY FROM ONE ACCOUNT TO THE SUBJECT ACCOUNT FOR THE TRANSACTION TO BE SUCCESSFUL, IT ALSO SENDS A PERMISSION REQUEST USING THE STANDARDIZED PERMISSION REQUEST FORMAT TO ENABLE THE SUCCESS OF THE TRANSACTION AND EVERYTHING IS LOGGED ACCORDING TO THE STANDARDIZED AGENT LOG SPEC."**

### Technical Analysis & Skill Mapping
- **Skills Consulted**:
  - [`agents-and-ledgers`](file:///C:/Users/hp/.gemini/config/skills/agents-and-ledgers/SKILL.md) (Rule 1: Document-Linked Ledgers, Rule 2: Three-Way Match)
  - [`agent-wallet-policy`](file:///C:/Users/hp/.gemini/config/skills/agent-wallet-policy/SKILL.md)
  - [`build-on-arc`](file:///C:/Users/hp/.gemini/config/skills/build-on-arc/SKILL.md)
- **The Core Problem**: If the designated paying account has insufficient total funds and requires a rebalance transfer from a central treasury or another account, an agent cannot silently siphon money across corporate boundaries without explicit authorization.
- **Architectural Solution**:
  1. The agent bundles the cross-account movement into a composite **Standardized Permission Request**:
     ```json
     {
       "permission_request_id": "pr_7a29e1c4",
       "action_type": "MULTI_HOP_SUBSCRIPTION_SETTLEMENT",
       "timestamp": "2026-10-01T03:14:00Z",
       "subject_account": {
         "account_id": "acc_marketing",
         "address": "0x55A...",
         "current_effective_balance": "400.000000",
         "target_payment_amount": "1000.000000",
         "deficiency": "600.000000"
       },
       "funding_plan": [
         {
           "source_account_id": "acc_general_treasury",
           "source_address": "0x11B...",
           "transfer_amount": "600.000000",
           "source_pre_balance": "15000.000000",
           "source_post_balance": "14400.000000"
         }
       ],
       "target_vendor": {
         "vendor_name": "HubSpot",
         "payout_address": "0x99C...",
         "invoice_id": "INV-HS-2026-10"
       },
       "options": ["APPROVE", "CANCEL_WITH_INSTRUCTIONS"]
     }
     ```
  2. Once approved, the atomic execution occurs, and `LedgerWitnessAgent` logs both the internal rebalance and the final payment to the account log and central journal.

---

# SECTION 3: Fragmented Accounts & Disbursal Account Architecture

## [Sentence 16]
> **"PROBLEM: FRAGMENTED ACCOUNTS MAKE IT CUMBERSOME TO DECIDE WHICH ACCOUNT TO MAKE PAYMENT FROM AND WHAT ACCOUNTS TO MOVE MONEY TO AND FROM TO FACILITATE THE PAYMENT."**

### Technical Analysis & Skill Mapping
- **Skills Consulted**:
  - [`unify-balance`](file:///C:/Users/hp/.gemini/config/skills/unify-balance/SKILL.md) (Cross-Chain USDC Abstraction)
  - [`use-gateway`](file:///C:/Users/hp/.gemini/config/skills/use-gateway/SKILL.md) (Instant <500ms settlement across 11 chains + Arc)
  - [`use-circle-wallets`](file:///C:/Users/hp/.gemini/config/skills/use-circle-wallets/SKILL.md) (Multi-Wallet Management)
- **The Core Problem**: A mid-sized business often holds funds fragmented across 4 chains (Ethereum, Base, Arbitrum, Arc) and 5 distinct cost centers (Marketing, Engineering, Payroll, General Ops, Tax Escrow). When a $\$15,000$ contractor invoice arrives, finance staff manually check 5 different block explorers and wallets, calculate gas fees, bridge USDC, wait for bridge confirmations, and then disburse. This causes hours of administrative friction and vulnerability to human error.
- **Architectural Solution**:
  1. Leverage **Circle Gateway** (`use-gateway`) and **Unified Balance Kit** (`unify-balance`) to treat all cross-chain and multi-wallet holdings as a consolidated, chain-abstracted liquidity fabric.
  2. On Arc, the engine uses sub-second deterministic finality and native USDC gas to orchestrate consolidation instantly without paying volatile native gas on other chains.

---

## [Sentence 17]
> **"SOLUTION: THERE WILL BE A DISBURSAL ACCOUNT WHERE MONEY IS MOVED TO TEMPORARILY TO MAKE PAYMENTS."**

### Technical Analysis & Skill Mapping
- **Skills Consulted**:
  - [`use-smart-contract-platform`](file:///C:/Users/hp/.gemini/config/skills/use-smart-contract-platform/SKILL.md)
  - [`build-on-arc`](file:///C:/Users/hp/.gemini/config/skills/build-on-arc/SKILL.md) (Osaka EVM, Zero-Address Revert Protection)
  - [`agents-and-ledgers`](file:///C:/Users/hp/.gemini/config/skills/agents-and-ledgers/SKILL.md) (Pre-Payment Verification, Payee Substitution Defense)
- **The Core Problem**: Direct vendor payments from primary treasury vaults expose main corporate private keys to third-party contract interactions, phishing scams, and rogue approval drains.
- **Architectural Solution: Transient Zero-Balance Disbursal Smart Contract**:
  1. Deploy `DisbursalVault.sol` on Arc.
  2. **Transient Model**: The `DisbursalVault` holds **$0 balance** at rest.
  3. When an approved disbursement is executed:
     - Funds are moved into `DisbursalVault` from qualifying source accounts.
     - In the exact same execution routine (or atomic transaction batch via Arc's `Multicall3From`), `DisbursalVault.executePayment(...)` transfers the exact funds to the verified vendor payout address.
     - If the vendor transfer fails or reverts, the contract automatically refunds the staged capital back to the originating accounts.
     - The vendor never touches the company's internal treasury addresses.

---

## [Sentence 18]
> **"THE AGENT WILL PROVIDE A UNIFIED UI FOR THE UI TO SEE THE TOTAL ASSETS AND THE DISTRIBUTION OF THAT ASSETS ACCROSS ACCOUNTS."**

*(Note: Per user instructions, focusing strictly on the backend data architecture, models, and aggregation engine)*

### Technical Analysis & Skill Mapping
- **Skills Consulted**:
  - [`unify-balance/references/check-balance.md`](file:///C:/Users/hp/.gemini/config/skills/unify-balance/references/check-balance.md)
  - [`use-circle-wallets`](file:///C:/Users/hp/.gemini/config/skills/use-circle-wallets/SKILL.md)
- **The Core Problem**: The system needs a continuous, high-performance real-time data engine that compiles fragmented multichain and multi-account assets into a single comprehensive balance sheet.
- **Architectural Solution: The Unified Asset Aggregator**:
  1. Expose high-speed endpoint `GET /api/treasury/unified-distribution`:
     ```json
     {
       "timestamp": "2026-10-01T03:15:00Z",
       "company_total_net_worth_usdc": "145250.000000",
       "total_liquid_usdc": "25250.000000",
       "total_invested_usyc": "120000.000000",
       "total_upcoming_liabilities_30d": "32000.000000",
       "total_unencumbered_cash": "113250.000000",
       "accounts_distribution": [
         {
           "account_id": "acc_engineering",
           "role": "OPEX_DEV",
           "chain": "ARC",
           "address": "0x1A2B...",
           "liquid_usdc": "5000.000000",
           "invested_usyc": "40000.000000",
           "total_effective_usdc": "45000.000000",
           "committed_liabilities": "12000.000000",
           "free_capital": "33000.000000"
         },
         {
           "account_id": "acc_marketing",
           "role": "OPEX_GROWTH",
           "chain": "ARC",
           "address": "0x3C4D...",
           "liquid_usdc": "2000.000000",
           "invested_usyc": "15000.000000",
           "total_effective_usdc": "17000.000000",
           "committed_liabilities": "5000.000000",
           "free_capital": "12000.000000"
         }
       ]
     }
     ```

---

## [Sentence 19]
> **"WHEN A PAYMENT IS TO BE MADE, THE AGENT USES THE PAYMENT RULES TO QUALIFY THE TOP ACCOUNTS WHERE PAYMENT IS TO BE MADE FROM AND PROVIDES A PERMISSION REQUEST FOR APPROVAL BEFORE MOVING THE MONEY TO THE DISBURSAL ACCOUNT, THEN IT PERFORMS THE TRANSACTION."**

### Technical Analysis & Skill Mapping
- **Skills Consulted**:
  - [`agents-and-ledgers`](file:///C:/Users/hp/.gemini/config/skills/agents-and-ledgers/SKILL.md) (Rule 2: Three-Way Match, Rule 3: Vendor Master Change Control)
  - [`agent-wallet-policy`](file:///C:/Users/hp/.gemini/config/skills/agent-wallet-policy/SKILL.md)
  - [`use-smart-contract-platform`](file:///C:/Users/hp/.gemini/config/skills/use-smart-contract-platform/SKILL.md)
- **The Core Problem**: Arbitrary fund selection causes cost-center mixing (e.g. paying engineering cloud servers out of the payroll account).
- **Architectural Solution: The Account Qualifying Engine**:
  1. **Step 1: Role Compatibility Match**: The engine filters accounts whose role tags match the invoice category (e.g. `OPEX_INFRA` $\to$ `Engineering Account`).
  2. **Step 2: Liquidity Buffer Qualification**:
     $$\text{AccountFreeCapital} = \text{TotalEffectiveBalance} - \left(\sum \text{Liabilities}_{30d} \times S_{\text{ratio}}\right) - F_{\text{op}}$$
     Only accounts where $\text{AccountFreeCapital} \ge \text{InvoiceAmount}$ qualify as primary source candidates.
  3. **Step 3: Permission Request Formulation**:
     - Agent compiles the Standardized Permission Request detailing:
       - Selected source account and reason for qualification.
       - Any USYC recall needed.
       - Disbursal staging step.
  4. **Step 4: Execution Pipeline (Post-Approval)**:
     - Pull USYC to liquid (if needed) $\to$ Move liquid USDC to `DisbursalVault` $\to$ `DisbursalVault.executePayment(vendor)`.

---

## [Sentence 20]
> **"IF MULTIPLE ACCOUNTS ARE NEEDED IT EVALUATES ACCOUNTS FOLLOWING MOVEMENT RULES TAKING INTO ACCOUNT THE LIABILITIES OF EACH ACCOUNT."**

### Technical Analysis & Skill Mapping
- **Skills Consulted**:
  - [`build-on-arc/references/evm_differences.md`](file:///C:/Users/hp/.gemini/config/skills/build-on-arc/references/evm_differences.md) (`Multicall3From` Native Batch Execution)
  - [`agents-and-ledgers`](file:///C:/Users/hp/.gemini/config/skills/agents-and-ledgers/SKILL.md) (Loud Rounding, Mathematical Precision)
- **The Core Problem**: When an invoice exceeds the unencumbered liquidity of any single account, pulling blindly from multiple accounts could deplete another account's payroll buffer, causing cascading defaults.
- **Architectural Solution: Multi-Account Waterfall Liquidity Allocation**:
  1. The algorithm queries all compatible business accounts and calculates their $\text{FreeCapital}_j$.
  2. Accounts are ranked according to business priority rules (e.g. `OPEX_GENERAL` first, `CAPEX_RESERVE` second, `PAYROLL` strictly excluded).
  3. **Waterfall Allocation Algorithm**:
     ```python
     needed = invoice_amount
     allocation_plan = []
     for account in ranked_eligible_accounts:
         if needed <= 0:
             break
         available_contribution = max(0, account.free_capital)
         if available_contribution > 0:
             take = min(needed, available_contribution)
             allocation_plan.append({
                 "account_id": account.account_id,
                 "take_amount": take,
                 "remaining_free_capital": available_contribution - take,
                 "protected_liabilities": account.committed_liabilities_30d
             })
             needed -= take

     if needed > 0:
         raise InsufficientUnencumberedLiquidityError("Invoice exceeds aggregate unencumbered company liquidity.")
     ```
  4. The multi-account draw is bundled into the Permission Request so admins see exactly how much each account is contributing before approving.

---

# SECTION 4: Audit, Control, & Guardrails Architecture

## [Sentence 21]
> **"AUDIT AND CONTROL: THERE WILL BE A FUNDS MOVEMENT RULE ESTABLISHED BY THE BUSINESS THAT WILL GUIDE FUNDS MOVEMENT DESCISIONS, AND RULES THAT GUIDES DECISIONS OF WHICH ACCOUNT VARIOUS TYPE OF PAYMENTS IS TO BE MADE FROM AND RULES THAT GUIDE INVESTMENTS."**

### Technical Analysis & Skill Mapping
- **Skills Consulted**:
  - [`agents-and-ledgers`](file:///C:/Users/hp/.gemini/config/skills/agents-and-ledgers/SKILL.md) (Section 2: The Six Golden Rules, Section 4: Verification Checklist)
  - [`agent-wallet-policy`](file:///C:/Users/hp/.gemini/config/skills/agent-wallet-policy/SKILL.md) (Policy Caps)
  - [`circle-agent-stack`](file:///C:/Users/hp/.gemini/config/skills/circle-agent-stack/SKILL.md) (Spending Guardrails)
- **The Core Problem**: Unconstrained AI agents can hallucinate account eligibility, sweep money meant for payroll into high-risk protocols, or pay unauthorized vendors. The prompt itself is NOT an enforcement mechanism ("Limits enforced in a smart contract, not in a prompt").
- **Architectural Solution: Declarative Policy & Onchain Rules Engine**:
  1. The business establishes a canonical declarative configuration (`business_policy.yaml`) with environment profiles:
     ```yaml
     version: "2026-1"
     active_profile: "HACKATHON_DEMO" # Switch to "PRODUCTION" for enterprise deployment

     profiles:
       HACKATHON_DEMO:
         description: "Calibrated for small testnet faucet balances ($10 - $50 USDC)"
         operating_accounts:
           - account_id: "acc_engineering"
             role: "OPEX_DEV"
             min_floor_usdc: 1.00
             safety_multiplier: 1.05
             evaluation_window_days: 3
             authorized_categories: ["INFRASTRUCTURE", "DEVELOPER_TOOLS", "SAAS"]
             max_autonomous_sweep_limit: 50.00
           - account_id: "acc_payroll"
             role: "PAYROLL"
             min_floor_usdc: 5.00
             safety_multiplier: 1.10
             evaluation_window_days: 3
             authorized_categories: ["SALARIES", "CONTRACTOR_COMPENSATION"]
             exclude_from_waterfall_draws: true
         investment_rules:
           target_vault: "0xVaultAddress..." # Hashnote USYC or MockUSYCVault
           max_company_allocation_ratio: 0.90 # Max 90% in USYC
           min_sweep_amount_usdc: 0.50 # $0.50 allows sweeps even with tiny faucet drip
           auto_sweep_enabled: true
           auto_recall_enabled: true
           # Hysteresis deadband to prevent churn
           invest_hysteresis_band_usdc: 0.50 # Invest only if SafeToInvest >= TargetReserve + $0.50
           recall_hysteresis_band_usdc: 0.25 # Recall only if Balance < TargetReserve - $0.25
           # Feedback loop suppression & debouncing
           debounce_window_ms: 5000 # 5-second sliding window for balance events
           min_action_cooldown_seconds: 30 # 30-second cooldown between autonomous txs
           tag_internal_settlement_events: true # Suppress recalculation on own transfers
           # Parameterized USYC Redemption Latency
           redemption_lead_time_seconds: 300 # 5 minutes for demo mock, 900s for USYC instant tier
         spending_limits:
           daily_hard_cap_usdc: 100.00
           single_tx_human_gate_threshold_usdc: 10.00

       PRODUCTION:
         description: "Enterprise scale with high safety margins"
         operating_accounts:
           - account_id: "acc_engineering"
             role: "OPEX_DEV"
             min_floor_usdc: 500.00
             safety_multiplier: 1.20
             evaluation_window_days: 30
             authorized_categories: ["INFRASTRUCTURE", "DEVELOPER_TOOLS", "SAAS"]
             max_autonomous_sweep_limit: 50000.00
           - account_id: "acc_payroll"
             role: "PAYROLL"
             min_floor_usdc: 10000.00
             safety_multiplier: 1.50
             evaluation_window_days: 30
             authorized_categories: ["SALARIES", "CONTRACTOR_COMPENSATION"]
             exclude_from_waterfall_draws: true
         investment_rules:
           target_vault: "0xVaultAddress..." # Hashnote USYC Institutional Contract
           max_company_allocation_ratio: 0.85 # Max 85% in USYC, min 15% liquid buffer
           min_sweep_amount_usdc: 100.00
           auto_sweep_enabled: true
           auto_recall_enabled: true
           # Hysteresis deadband
           invest_hysteresis_band_usdc: 250.00
           recall_hysteresis_band_usdc: 100.00
           # Feedback loop suppression & debouncing
           debounce_window_ms: 10000
           min_action_cooldown_seconds: 60
           tag_internal_settlement_events: true
           # Parameterized USYC Redemption Latency Tiers
           redemption_lead_time_seconds: 86400 # 24 hours standard T+0/T+1 queue
           redemption_latency_tier: "TIER_C_BATCH_T1" # Options: TIER_A_INSTANT (900s), TIER_B_BATCH_T0 (28800s), TIER_C_BATCH_T1 (86400s)
         spending_limits:
           daily_hard_cap_usdc: 25000.00
           single_tx_human_gate_threshold_usdc: 5000.00
     ```
  2. Rules are loaded into the `PolicyComplianceAgent` as deterministic constraint functions that cannot be overridden by conversational prompts.

---

## [Sentence 22]
> **"ANY TIME THE AGENT MOVES MONEY, CONVERTS MONEY, IT MUST PROVIDE A PERMISSION REQUEST THAT CONTAINS THE ACTION, THE AFFECT5ED ACCOUNT AND THEIR ROLE AND THEIR DETAILS INCLUDING LOCATION AND LIABILITIES, ASSOCIATED RECORDS, THE AMOUNT IN QUESTION, THE REASON, AND OPTIONS FOR APPROVE OR CANCEL WITH INSTRUCTIONS"**

### Technical Analysis & Skill Mapping
- **Skills Consulted**:
  - [`agents-and-ledgers`](file:///C:/Users/hp/.gemini/config/skills/agents-and-ledgers/SKILL.md) (Rule 3: Payee Verification, Rule 6: Model Output as Suggestion)
  - [`build-on-arc`](file:///C:/Users/hp/.gemini/config/skills/build-on-arc/SKILL.md) (EIP-712 Typed Data Signatures)
- **The Core Problem**: Unstructured agent alerts (e.g. *"I'm going to pay $1000, is that okay?"*) lack critical context for finance admins to evaluate risk, causing either rubber-stamping or blind rejections.
- **Architectural Solution: Standardized Permission Request Specification (SPRS)**:
  1. Every non-autonomous action generates an immutable structured JSON object:
     ```json
     {
       "request_id": "pr_88e04b91",
       "timestamp": "2026-10-01T03:16:00Z",
       "action": "DISBURSEMENT_PAYMENT",
       "reason": "Monthly AWS Production Cloud Infrastructure Bill #INV-9921",
       "amount_usdc": "12500.000000",
       "affected_accounts": [
         {
           "account_id": "acc_engineering",
           "role": "OPEX_DEV",
           "chain": "ARC",
           "address": "0x1A2B...",
           "current_liquid_balance": "2500.000000",
           "current_invested_usyc": "40000.000000",
           "total_effective_balance": "42500.000000",
           "committed_liabilities_30d": "5000.000000",
           "unencumbered_balance": "37500.000000",
           "usyc_recall_amount": "10000.000000",
           "post_tx_liquid_balance": "0.000000",
           "post_tx_invested_usyc": "30000.000000"
         }
       ],
       "target_recipient": {
         "vendor_id": "v_amazon_aws",
         "vendor_name": "Amazon Web Services",
         "payout_address": "0x44B9...",
         "is_in_verified_master": true,
         "payee_address_matches_history": true
       },
       "associated_records": {
         "purchase_order_id": "PO-AWS-2026-001",
         "purchase_order_hash": "0x9f1a...",
         "goods_receipt_id": "GR-AWS-USAGE-OCT",
         "goods_receipt_hash": "0x3e2b...",
         "invoice_document_id": "INV-9921",
         "idempotency_key": "0x5d98a..."
       },
       "options": [
         { "action": "APPROVE", "label": "Approve Payment" },
         { "action": "CANCEL_WITH_INSTRUCTIONS", "label": "Cancel with Instructions", "requires_text": true }
       ]
     }
     ```

---

## [Sentence 23]
> **"FOR AUDTING, EACH ACCOUNT WILL HAVE AM AGENT LOG. EACH LOG CONTAINS TIMED AGENT ACTIONS WITH TRANSACTION DETAILS, DATETIME, AND PERMISSION REQUEST FOR THAT ACTION."**

### Technical Analysis & Skill Mapping
- **Skills Consulted**:
  - [`agents-and-ledgers`](file:///C:/Users/hp/.gemini/config/skills/agents-and-ledgers/SKILL.md) (Rule 1: Document-Linked Ledgers)
  - [`use-circle-wallets`](file:///C:/Users/hp/.gemini/config/skills/use-circle-wallets/SKILL.md)
- **The Core Problem**: Account reconciliation is impossible when logs are mixed into a generic application log file or chat history.
- **Architectural Solution: Isolated Account Audit Streams**:
  1. Relational schema `account_agent_audit_log`:
     ```sql
     CREATE TABLE account_agent_audit_log (
         log_id BIGSERIAL PRIMARY KEY,
         account_id VARCHAR(64) NOT NULL,
         timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
         action_type VARCHAR(64) NOT NULL,
         amount_usdc NUMERIC(18, 6) NOT NULL,
         permission_request_id VARCHAR(64), -- Null if autonomous inside rules
         tx_hash VARCHAR(66),
         counterparty_address VARCHAR(42),
         reason TEXT NOT NULL,
         pre_state_snapshot JSONB NOT NULL,
         post_state_snapshot JSONB NOT NULL,
         actor_agent VARCHAR(64) NOT NULL
     );
     CREATE INDEX idx_account_log ON account_agent_audit_log(account_id, timestamp);
     ```

---

## [Sentence 24]
> **"THERE WILL ALSO BE A CENTRAL LOG WHERE ACTIONS ON ALL ACCOUNTS ARE RECORDED SEQUENTIALLY."**

### Technical Analysis & Skill Mapping
- **Skills Consulted**:
  - [`agents-and-ledgers/references/system_comparison.md`](file:///C:/Users/hp/.gemini/config/skills/agents-and-ledgers/references/system_comparison.md) (Odoo `inalterable_hash`, Hash-Linked Journals)
  - [`agents-and-ledgers`](file:///C:/Users/hp/.gemini/config/skills/agents-and-ledgers/SKILL.md) (Double-Entry Document-Linked Journal)
- **The Core Problem**: Individual account logs alone can be retroactively rewritten or reordered if a database is compromised.
- **Architectural Solution: The Hash-Chained Master System Journal**:
  1. Every action across ALL accounts appends to `master_system_journal`:
     $$\text{CurrentHash}_n = \text{SHA256}(\text{PreviousHash}_{n-1} + \text{Timestamp}_n + \text{AccountId}_n + \text{Debit}_n + \text{Credit}_n + \text{Amount}_n + \text{TxHash}_n)$$
  2. Verification:
     - Any modification or deletion of past records invalidates the mathematical hash chain.
     - A daily Merkle root of the journal can be anchored to Arc L1 via a native transaction memo, providing public cryptographic proof of financial integrity.

---

## [Sentence 25]
> **"Inside the rules (sweeps to the investment account, pulling funds back for an already-approved payment): the agent acts on its own and logs it."**

### Technical Analysis & Skill Mapping
- **Skills Consulted**:
  - [`agent-wallet-policy`](file:///C:/Users/hp/.gemini/config/skills/agent-wallet-policy/SKILL.md) (Autonomous Spending Policies)
  - [`build-on-arc`](file:///C:/Users/hp/.gemini/config/skills/build-on-arc/SKILL.md) (Autonomous Execution)
- **The Core Problem**: Human operators get alert fatigue if the agent asks for permission for every micro-sweep of $\$50$ into USYC or every automatic replenishment for a pre-approved bill.
- **Architectural Solution: Autonomous Fast-Path Execution Engine**:
  1. The `PolicyComplianceAgent` validates against the fast-path condition:
     - Condition 1: $\text{Action} == \text{'SWEEP\_TO\_USYC'} \land \text{Amount} \le \text{SafeToInvest}$.
     - Condition 2: $\text{Action} == \text{'RECALL\_FROM\_USYC'} \land \text{linked\_to\_approved\_liability} == \text{True}$.
  2. If matched:
     - Execution is dispatched immediately to the blockchain.
     - The event is logged in both `account_agent_audit_log` and `master_system_journal` with `is_autonomous: true`.
     - An asynchronous webhook updates telemetry without pausing the system.

---

## [Sentence 26]
> **"outside the rules: the agent asks for approval."**

### Technical Analysis & Skill Mapping
- **Skills Consulted**:
  - [`agent-wallet-policy`](file:///C:/Users/hp/.gemini/config/skills/agent-wallet-policy/SKILL.md) (OTP / Human Gate Protocol)
  - [`agents-and-ledgers`](file:///C:/Users/hp/.gemini/config/skills/agents-and-ledgers/SKILL.md) (Rule 6: Model Output as Suggestion)
- **The Core Problem**: Letting an agent act unilaterally when parameters breach safety boundaries leads to catastrophic loss.
- **Architectural Solution: The Mandatory Human Gate Controller**:
  1. Triggers that divert an action to the Human Gate:
     - Payment to a new vendor.
     - Any vendor whose payout address changed from master registry (Payee Substitution Flag).
     - Any invoice amount differing from the approved Purchase Order (Precision / Rounding Flag).
     - Single transaction amount $> \text{single\_tx\_human\_gate\_threshold}$.
     - Multi-account waterfall rebalance.
  2. The agent sets transaction state to `BLOCKED_AWAITING_APPROVAL`, issues the SPRS request, and waits until a cryptographic signature or admin approval callback is registered.

---

# SECTION 5: Agent Actions, Tools, & Multi-Agent Architecture

## [Sentence 27]
> **"1. KNOW THE DETAILS OF EVERY ACCOUNT LIKE BALANCE, LOCATION, LIABILITIES, HISTORY ETC. (MANY OTHER THINGS I DIDNT MENTION HERE)"**

### Technical Analysis & Skill Mapping
- **Skills Consulted**:
  - [`use-circle-wallets`](file:///C:/Users/hp/.gemini/config/skills/use-circle-wallets/SKILL.md)
  - [`unify-balance/references/check-balance.md`](file:///C:/Users/hp/.gemini/config/skills/unify-balance/references/check-balance.md)
  - [`use-gateway`](file:///C:/Users/hp/.gemini/config/skills/use-gateway/SKILL.md)
- **Technical Tool Specification**:
  ```typescript
  /**
   * Tool: get_account_intelligence
   * Aggregates real-time onchain balances, USYC positions, liabilities, and audit history.
   */
  async function get_account_intelligence(accountId: string): Promise<{
    metadata: { accountId: string; name: string; role: string; address: string; chain: string };
    balances: {
      liquidUsdc: string;
      investedUsycShares: string;
      investedUsycUsdcEquivalent: string;
      totalEffectiveUsdc: string;
    };
    liabilities: {
      dueNext7DaysUsdc: string;
      dueNext30DaysUsdc: string;
      items: Array<{ id: string; vendor: string; amount: string; dueDate: string }>;
    };
    solvencyMetrics: {
      requiredReserveUsdc: string;
      safeToInvestUsdc: string;
      unencumberedFreeCashUsdc: string;
      timeHorizonSeconds: number;
    };
    recentAuditHistory: Array<{ logId: number; timestamp: string; action: string; txHash: string }>;
  }>;
  ```

---

## [Sentence 28]
> **"2. MOVE MONEY FROM ACCOUNT TO ACCOUNT"**

### Technical Analysis & Skill Mapping
- **Skills Consulted**:
  - [`use-usdc`](file:///C:/Users/hp/.gemini/config/skills/use-usdc/SKILL.md)
  - [`use-developer-controlled-wallets/references/check-balance-and-transfer-tokens.md`](file:///C:/Users/hp/.gemini/config/skills/use-developer-controlled-wallets/references/check-balance-and-transfer-tokens.md)
  - [`use-gateway`](file:///C:/Users/hp/.gemini/config/skills/use-gateway/SKILL.md) (Cross-chain instant movement)
- **Technical Tool Specification**:
  ```typescript
  /**
   * Tool: transfer_account_liquidity
   * Moves funds internally between corporate accounts (same-chain Arc or cross-chain via Gateway).
   */
  async function transfer_account_liquidity(params: {
    sourceAccountId: string;
    targetAccountId: string;
    amountUsdc: string;
    reason: string;
    permissionRequestId?: string;
  }): Promise<{
    txHash: string;
    sourcePostBalance: string;
    targetPostBalance: string;
    auditLogId: number;
  }>;
  ```

---

## [Sentence 29]
> **"3. AUTHORIZE TRANSACTIONS"**

### Technical Analysis & Skill Mapping
- **Skills Consulted**:
  - [`use-modular-wallets`](file:///C:/Users/hp/.gemini/config/skills/use-modular-wallets/SKILL.md) (Session Keys, Paymaster, EIP-712 Signatures)
  - [`agent-wallet-policy`](file:///C:/Users/hp/.gemini/config/skills/agent-wallet-policy/SKILL.md) (Spending Limits & Spending Policies)
  - [`use-smart-contract-platform`](file:///C:/Users/hp/.gemini/config/skills/use-smart-contract-platform/SKILL.md)
- **Technical Tool Specification**:
  ```typescript
  /**
   * Tool: authorize_transaction_intent
   * Validates policy limits, verifies human cryptographic signature, and executes onchain authorization.
   */
  async function authorize_transaction_intent(params: {
    permissionRequestId: string;
    adminSignature: string; // EIP-712 signature or OTP confirmation
    executionPayload: {
      targetContract: `0x${string}`;
      functionCalldata: `0x${string}`;
      maxGasUsdc: string;
    };
  }): Promise<{ status: "AUTHORIZED" | "REJECTED"; authorizationReceiptHash: string }>;
  ```

---

## [Sentence 30]
> **"4. CONVERT FROM CRYPTO TO FIAT"**

### Technical Analysis & Skill Mapping
- **Skills Consulted**:
  - [`swap-tokens`](file:///C:/Users/hp/.gemini/config/skills/swap-tokens/SKILL.md)
  - [`build-on-arc/references/app_kit_guide.md`](file:///C:/Users/hp/.gemini/config/skills/build-on-arc/references/app_kit_guide.md) (Onramp/Offramp Kit)
- **The Core Problem**: Many traditional vendors (landlords, utilities, enterprise software) do not accept crypto addresses and require direct bank wire / ACH / SEPA settlement.
- **Technical Tool Specification**:
  ```typescript
  /**
   * Tool: convert_crypto_to_fiat_payout
   * Initiates Circle Mint Payout / Fedwire to settle traditional invoices.
   */
  async function convert_crypto_to_fiat_payout(params: {
    sourceAccountId: string;
    amountUsdc: string;
    beneficiaryBank: {
      accountHolderName: string;
      ibanOrAccountNumber: string;
      routingOrSwift: string;
      bankCountry: string;
    };
    invoiceReference: string;
  }): Promise<{
    payoutId: string;
    status: "INITIATED" | "PENDING_SETTLEMENT";
    estimatedArrivalTimestamp: string;
    usdcBurnTxHash: string;
  }>;
  ```

---

## [Sentence 31]
> **"5. INVESTMENT TOOLS FOR MOVING MONEY IN OUT AND MANAGEMENT"**

### Technical Analysis & Skill Mapping
- **Skills Consulted**:
  - [`build-on-arc/references/app_kit_guide.md`](file:///C:/Users/hp/.gemini/config/skills/build-on-arc/references/app_kit_guide.md) (Earn Kit `@circle-fin/earn-kit`)
  - [`use-developer-controlled-wallets`](file:///C:/Users/hp/.gemini/config/skills/use-developer-controlled-wallets/SKILL.md)
- **Technical Tool Specification**:
  ```typescript
  /**
   * Tool Suite: Investment & Vault Management Tools
   */
  // 1. Sweep surplus funds to yield vault
  async function sweep_surplus_to_yield(params: {
    accountId: string;
    amountUsdc: string;
  }): Promise<{ txHash: string; sharesMinted: string; newInvestedBalance: string }>;

  // 2. Recall invested funds from yield vault to liquid USDC
  async function recall_yield_to_liquid(params: {
    accountId: string;
    amountUsdc: string;
    recipientAddress: string;
  }): Promise<{ txHash: string; sharesBurned: string; newLiquidBalance: string }>;

  // 3. Query historical yield earnings and NAV progression
  async function get_yield_performance_metrics(params: {
    accountId: string;
    timeframe: "7D" | "30D" | "YTD";
  }): Promise<{
    usdcDepositedCumulative: string;
    usdcWithdrawnCumulative: string;
    netYieldAccruedUsdc: string;
    currentAnnualizedApr: number;
  }>;
  ```

---

## [Sentence 32]
> **"THIS IS A MULTIAGENT SYSTEM."**

### Technical Analysis & Skill Mapping
- **Skills Consulted**:
  - [`circle-agent-stack`](file:///C:/Users/hp/.gemini/config/skills/circle-agent-stack/SKILL.md) (Multi-Agent Swarm, Role Delegation)
  - [`build-on-arc/references/ai_agentic_economy.md`](file:///C:/Users/hp/.gemini/config/skills/build-on-arc/references/ai_agentic_economy.md) (ERC-8004 Agent Identity & ERC-8183 Job Escrow)
  - [`agents-and-ledgers`](file:///C:/Users/hp/.gemini/config/skills/agents-and-ledgers/SKILL.md) (Segregation of Duties, Witness Verification)

### Multi-Agent Cognitive Cluster Topology & Agent Personas

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                               AUTONOMOUS MULTI-AGENT CLUSTER                            │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                        │
│  1. TreasurySentinelAgent (The Yield Optimizer & Liquidity Operator)                  │
│     • Onchain Identity: ERC-8004 Agent ID #101                                        │
│     • Primary Objective: Maximize USYC yield while guaranteeing 100% solvency          │
│     • Cognitive Autonomy: Evaluates dynamic liquidity horizons, models cash burn,     │
│       autonomously executes sweeps inside rules, and recalls funds prior to due dates  │
│                                                                                        │
│  2. LiabilityRadarAgent (The SaaS & Recurring Obligation Auditor)                     │
│     • Onchain Identity: ERC-8004 Agent ID #102                                        │
│     • Primary Objective: Keep comprehensive overview over all accounts & liabilities   │
│     • Cognitive Autonomy: Ingests unstructured billing data, tracks payment dates,    │
│       hunts zombie subscriptions, alerts admins 48h prior with APPROVE / CANCEL opts   │
│                                                                                        │
│  3. DisbursalRouterAgent (The Cross-Account Liquidity Strategist)                      │
│     • Onchain Identity: ERC-8004 Agent ID #103                                        │
│     • Primary Objective: Resolve fragmented accounts and optimize payment routing      │
│     • Cognitive Autonomy: Evaluates account qualification rules, designs multi-account │
│       draw plans, stages funds in DisbursalVault, and executes disbursements          │
│                                                                                        │
│  4. PolicyComplianceAgent (The Governance Gatekeeper & Human Liaison)                 │
│     • Onchain Identity: ERC-8004 Agent ID #104                                        │
│     • Primary Objective: Enforce business policy and manage the human-in-the-loop gate │
│     • Cognitive Autonomy: Verifies Three-Way Match, detects payee substitution,        │
│       formulates rich Standardized Permission Requests (SPRS), and verifies EIP-712   │
│                                                                                        │
│  5. LedgerWitnessAgent (The Independent External Auditor - Zero Signing Capability)   │
│     • Onchain Identity: ERC-8004 Agent ID #105                                        │
│     • Primary Objective: Cryptographic proof of financial integrity & double-entry     │
│     • Cognitive Autonomy: Watches Arc RPC & webhooks independently, reconciles block   │
│       receipts, posts double-entry vouchers, and appends to hash-chained journals      │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

### Detailed Agent Specifications & Cognitive Agency

#### 1. `TreasurySentinelAgent`
* **System Prompt Core**:
  > *"You are the Chief Treasury Sentinel. Your mission is to eliminate idle cash across all corporate accounts by allocating surplus into Hashnote USYC while ensuring zero payment failures. Inside the rules (sweeping surplus to USYC, pulling funds back for scheduled payments), act with decisive autonomy and log all steps. You maintain the parallel mental model of each account's total available balance (liquid + USYC) and never allow false insolvency claims."*
* **Autonomous Decision Loops**:
  - Subscribes to real-time Arc balance updates via WebSocket.
  - Applies debouncing and checks origin tagging to avoid feedback loops.
  - Evaluates `SafeToInvest` against the active environment profile (`HACKATHON_DEMO` or `PRODUCTION`).
  - **Inside the Rules**: Dispatches `sweep_surplus_to_yield` autonomously.
  - Prior to scheduled bill dates ($T - \text{LeadTime}$), autonomously dispatches `recall_yield_to_liquid` to pre-fund the target account.

#### 2. `LiabilityRadarAgent`
* **System Prompt Core**:
  > *"You are the Liability Radar Sentinel. You maintain a continuous, comprehensive overview of every corporate account, its active balance, location, and upcoming recurring liabilities (SaaS, debts, contractor milestones). 48 hours before any liability is due, you notify the admin in charge with the full breakdown of what is being paid, which account is paying, and reasons, presenting binary options: APPROVE or CANCEL WITH INSTRUCTIONS. If the admin provides cancellation instructions, freeze the liability and prepare cancellation steps."*
* **Autonomous Decision Loops**:
  - Ingests incoming invoices, vendor billing alerts, and subscription renewal notices.
  - Maintains `AccountLiabilities` registry with verified agreement hashes.
  - Audits seat usage to detect zombie SaaS tools and stealth price hikes.
  - Emits pre-due notifications to the admin dashboard.
  - Ingests admin instructions (`APPROVE` $\to$ schedules execution; `CANCEL_WITH_INSTRUCTIONS` $\to$ freezes payment and drafts vendor cancellation memo).

#### 3. `DisbursalRouterAgent`
* **System Prompt Core**:
  > *"You are the Disbursal Liquidity Strategist. Corporate funds are fragmented across multiple operational accounts. When a disbursal is requested, evaluate payment rules to qualify the top candidate accounts based on role, unencumbered liquidity, and liabilities. If multiple accounts are required, design a multi-account waterfall draw that preserves mandatory operating floors. Move funds into the temporary DisbursalVault for atomic settlement once approved."*
* **Autonomous Decision Loops**:
  - Computes `UnifiedDistribution` metrics for the executive dashboard.
  - Ranks accounts by cost-center qualification and unencumbered capital.
  - Proposes the optimal liquidity sourcing plan (single account draw vs multi-account staging).
  - Interacts with `DisbursalVault.sol` to stage and disburse funds atomically.

#### 4. `PolicyComplianceAgent`
* **System Prompt Core**:
  > *"You are the Financial Governance Officer. You ensure that every fund movement complies with the canonical business_policy.yaml. Inside the rules, you grant immediate fast-path clearance. Outside the rules (new vendors, changed payout addresses, amounts above threshold, multi-account draws), you construct the Standardized Permission Request (SPRS) and enforce mandatory human approval."*
* **Autonomous Decision Loops**:
  - Validates transactions against the Vendor Master and contract allowlists.
  - Calculates risk scores (detecting Payee Substitution or rounding anomalies).
  - Formulates the structured SPRS JSON payload with context and options.
  - Validates EIP-712 human admin signatures before releasing the execution lock.

#### 5. `LedgerWitnessAgent`
* **System Prompt Core**:
  > *"You are the Independent External Ledger Witness. You hold NO private keys and CANNOT move money. Your sole role is truth and reconciliation. You observe the Arc blockchain independently. Whenever any action or funding occurs on any account, you verify the transaction receipt, record double-entry journal vouchers, and update the associated account log and the sequential master system journal."*
* **Autonomous Decision Loops**:
  - Independent RPC listener on Arc L1 blocks and Circle webhooks.
  - Reconciles expected transaction state against onchain event logs.
  - Appends immutable entries to `account_agent_audit_log` (per-account log).
  - Appends cryptographically chained entries to `master_system_journal` ($\text{Hash}_n = \text{SHA256}(\text{Hash}_{n-1} + \dots)$).

---

### End-to-End Autonomous Multi-Agent Coordination Scenarios

#### Scenario 1: Autonomous Surplus Sweep (Inside the Rules)
1. Faucet drip or customer revenue arrives in `acc_engineering` ($+\$50.00$ USDC).
2. Arc System Emitter emits `Transfer` event.
3. `TreasurySentinelAgent` receives event, debounces for 5s, checks origin (not internal), and evaluates liabilities for the next 3 days ($L_T = \$5.00$).
4. Evaluates `SafeToInvest`: $\$50 - (1.05 \times \$5 + \$1.00 + \$0.50) = \$43.25$.
5. Since $\$43.25 \ge \text{MinSweepThreshold}$ ($\$0.50$), this action is **Inside the Rules**.
6. `TreasurySentinelAgent` acts autonomously without asking permission, calling `vault.sweepFromAccount()`.
7. `LedgerWitnessAgent` detects the block receipt, confirms $\$43.25$ deposited into USYC, updates the parallel balance record ($B_L = \$6.75$, $B_Y = \$43.25$, Available = $\$50.00$), and logs the event to `account_agent_audit_log` and `master_system_journal`.

#### Scenario 2: Subscription Radar Alert & Human Decision (Outside the Rules)
1. `LiabilityRadarAgent` detects Datadog subscription renewal ($L_1 = \$850.00$) due in 48 hours on `acc_engineering`.
2. Checks policy: Single transaction human gate threshold is $\$500.00$ (in production) or $\$10.00$ (in demo). This is **Outside the Rules** for autonomous payment.
3. `LiabilityRadarAgent` generates the Standardized Permission Request (SPRS) with what is being paid, account details, effective balance, and options: `APPROVE` or `CANCEL_WITH_INSTRUCTIONS`.
4. Admin reviews alert on dashboard and provides feedback:
   - *If Approved*: Admin signs EIP-712 payload. `TreasurySentinelAgent` checks if liquid cash is sufficient; if not, recalls the deficit from USYC 24h prior. At due date, `DisbursalRouterAgent` executes payment.
   - *If Cancelled with Instructions*: Admin inputs: *"Migrated to internal Prometheus; cancel Datadog subscription"*. `LiabilityRadarAgent` freezes the scheduled charge, flags the liability as `CANCELLED`, and logs the instruction.

#### Scenario 3: Fragmented Account Disbursal via Disbursal Account
1. An AWS invoice for $\$12,500$ arrives.
2. `DisbursalRouterAgent` inspects all accounts via `get_account_intelligence`.
3. Evaluates accounts:
   - `acc_engineering` has $\$4,000$ free capital.
   - `acc_general_treasury` has $\$15,000$ free capital.
   - `acc_payroll` is excluded by policy (`exclude_from_waterfall_draws: true`).
4. `DisbursalRouterAgent` qualifies `acc_engineering` (primary cost center) for $\$4,000$ and `acc_general_treasury` for $\$8,500$.
5. Because inter-account movement is required, `PolicyComplianceAgent` constructs the SPRS detailing the multi-account funding plan.
6. Admin approves.
7. Atomic execution occurs:
   - $\$4,000$ from `acc_engineering` and $\$8,500$ from `acc_general_treasury` are transferred to `DisbursalVault.sol`.
   - `DisbursalVault.executePayment()` transfers $\$12,500$ USDC to AWS verified payout address.
   - `DisbursalVault` returns to zero balance.
8. `LedgerWitnessAgent` records the complete transaction chain into all involved account logs and the master journal.

---

# SECTION 6: Complete Engineering Implementation Blueprint

## 1. Onchain Smart Contracts on Arc L1

Deploy via Hardhat/Foundry configured for Arc (`chainId: 5042`, RPC: `https://rpc.mainnet.arc.io`, `gasPrice: 20 Gwei`).

### A. `CentralTreasuryYieldVault.sol`
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

interface IERC4626Yield {
    function deposit(uint256 assets, address receiver) external returns (uint256 shares);
    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares);
    function convertToAssets(uint256 shares) external view returns (uint256);
    function maxWithdraw(address owner) external view returns (uint256);
}

/**
 * @title CentralTreasuryYieldVault
 * @notice Segregated USYC treasury vault on Arc L1 with strict account-bound recalls
 */
contract CentralTreasuryYieldVault is AccessControl {
    bytes32 public constant SWEEPER_ROLE = keccak256("SWEEPER_ROLE");
    bytes32 public constant DISBURSAL_ROLE = keccak256("DISBURSAL_ROLE");

    IERC20 public immutable usdc;           // Arc Predeploy 0x3600000000000000000000000000000000000000
    IERC4626Yield public immutable usyc;   // Hashnote USYC Token Vault

    // Account ID => Registered Wallet Address (Recalls ONLY go here)
    mapping(bytes32 => address) public registeredAccounts;
    // Account ID => USYC Shares owned
    mapping(bytes32 => uint256) public accountShares;
    uint256 public totalVaultShares;

    event AccountRegistered(bytes32 indexed accountId, address indexed wallet);
    event FundsSweptToYield(bytes32 indexed accountId, address indexed sourceWallet, uint256 usdcAmount, uint256 sharesMinted);
    event FundsRecalledFromYield(bytes32 indexed accountId, address indexed recipientWallet, uint256 usdcAmount, uint256 sharesBurned);

    constructor(address _usdc, address _usyc, address admin) {
        usdc = IERC20(_usdc);
        usyc = IERC4626Yield(_usyc);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function registerAccount(bytes32 accountId, address wallet) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(wallet != address(0), "Cannot register zero address");
        registeredAccounts[accountId] = wallet;
        emit AccountRegistered(accountId, wallet);
    }

    /**
     * @notice Sweeps calculated idle funds from an account wallet into USYC
     * @dev Called exclusively by TreasurySweeperAgent using the account's pre-approved allowance
     */
    function sweepFromAccount(
        bytes32 accountId, 
        address accountWallet, 
        uint256 usdcAmount
    ) external onlyRole(SWEEPER_ROLE) {
        require(registeredAccounts[accountId] == accountWallet, "Wallet not registered for account");
        require(usdcAmount > 0, "Zero sweep amount");
        
        // Pull USDC from operating wallet using allowance
        require(usdc.transferFrom(accountWallet, address(this), usdcAmount), "USDC transferFrom failed");
        
        usdc.approve(address(usyc), usdcAmount);
        uint256 sharesMinted = usyc.deposit(usdcAmount, address(this));
        
        accountShares[accountId] += sharesMinted;
        totalVaultShares += sharesMinted;

        emit FundsSweptToYield(accountId, accountWallet, usdcAmount, sharesMinted);
    }

    /**
     * @notice Recalls USDC from USYC back to the account's registered wallet
     * @dev Recipient cannot be parameterized; strictly enforced to registeredAccounts[accountId]
     */
    function recallForAccount(
        bytes32 accountId, 
        uint256 usdcAmount
    ) external onlyRole(DISBURSAL_ROLE) {
        address targetWallet = registeredAccounts[accountId];
        require(targetWallet != address(0), "Account not registered");
        require(usdcAmount > 0, "Zero recall amount");

        uint256 currentAssets = getAccountAssets(accountId);
        require(currentAssets >= usdcAmount, "Insufficient account yield balance");

        // Verify available instant liquidity in USYC
        uint256 maxInstant = usyc.maxWithdraw(address(this));
        require(maxInstant >= usdcAmount, "Instant USYC liquidity limit exceeded");

        // Record balance before to guard against ERC-4626 rounding shortfall
        uint256 balanceBefore = usdc.balanceOf(targetWallet);

        // Execute withdraw (specifies exact assets desired, rounds shares up)
        uint256 sharesBurned = usyc.withdraw(usdcAmount, targetWallet, address(this));

        // Precision check: verify actual amount received
        uint256 actualReceived = usdc.balanceOf(targetWallet) - balanceBefore;
        require(actualReceived >= usdcAmount, "Redemption precision shortfall");

        require(accountShares[accountId] >= sharesBurned, "Share calculation underflow");
        accountShares[accountId] -= sharesBurned;
        totalVaultShares -= sharesBurned;

        emit FundsRecalledFromYield(accountId, targetWallet, usdcAmount, sharesBurned);
    }

    function getAccountAssets(bytes32 accountId) public view returns (uint256) {
        uint256 shares = accountShares[accountId];
        if (shares == 0) return 0;
        return usyc.convertToAssets(shares);
    }
}
```

### B. `DisbursalVault.sol`
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title DisbursalVault
 * @notice Hardened transient clearinghouse enforcing on-chain vendor allowlists,
 *         spending caps, and EIP-712 human approvals.
 */
contract DisbursalVault is AccessControl, EIP712 {
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");
    bytes32 public constant DISBURSAL_TYPEHASH = keccak256(
        "DisbursalApproval(bytes32 permissionRequestId,address vendor,uint256 amount,bytes32 idempotencyKey,uint256 nonce,uint256 deadline)"
    );

    IERC20 public immutable usdc;
    address public adminApprover;

    // --- On-Chain Guardrails ---
    mapping(address => bool) public approvedVendors;
    mapping(bytes32 => bool) public executedIdempotencyKeys;
    mapping(uint256 => bool) public usedNonces;

    uint256 public perTxCap;                  // Max per-tx limit without admin EIP-712 signature
    uint256 public dailyCap;                  // Max cumulative daily limit across all transactions
    uint256 public eip712ApprovalThreshold;  // Amount threshold above which EIP-712 signature is mandatory

    uint256 public currentDay;
    uint256 public dailySpent;

    event VendorStatusUpdated(address indexed vendor, bool approved);
    event SpendingCapsUpdated(uint256 perTxCap, uint256 dailyCap, uint256 eip712Threshold);
    event DisbursalExecuted(
        bytes32 indexed permissionRequestId,
        address indexed vendor,
        uint256 amount,
        bytes32 idempotencyKey
    );

    constructor(
        address _usdc, 
        address _admin,
        uint256 _perTxCap,
        uint256 _dailyCap,
        uint256 _eip712Threshold
    ) AccessControl() EIP712("DisbursalVault", "1") {
        usdc = IERC20(_usdc);
        adminApprover = _admin;
        perTxCap = _perTxCap;
        dailyCap = _dailyCap;
        eip712ApprovalThreshold = _eip712Threshold;
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
    }

    function setVendorApproval(address vendor, bool approved) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(vendor != address(0), "Cannot approve zero address");
        approvedVendors[vendor] = approved;
        emit VendorStatusUpdated(vendor, approved);
    }

    function updateCaps(
        uint256 _perTxCap, 
        uint256 _dailyCap, 
        uint256 _threshold
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_perTxCap <= _dailyCap, "perTxCap exceeds dailyCap");
        perTxCap = _perTxCap;
        dailyCap = _dailyCap;
        eip712ApprovalThreshold = _threshold;
        emit SpendingCapsUpdated(_perTxCap, _dailyCap, _threshold);
    }

    /**
     * @notice Executes a payment adhering strictly to on-chain guardrails
     * @param permissionRequestId Standardized permission request ID
     * @param vendor Approved vendor payout address
     * @param amount Payment amount in 6-decimal USDC
     * @param idempotencyKey Deterministic hash(vendor, invoiceId, amount)
     * @param nonce Replay protection nonce for EIP-712 signature
     * @param deadline Expiry timestamp for EIP-712 signature
     * @param adminSignature Cryptographic signature from admin (required if amount > threshold)
     */
    function executePayment(
        bytes32 permissionRequestId,
        address vendor,
        uint256 amount,
        bytes32 idempotencyKey,
        uint256 nonce,
        uint256 deadline,
        bytes calldata adminSignature
    ) external onlyRole(EXECUTOR_ROLE) {
        // 1. On-Chain Allowlist Check
        require(approvedVendors[vendor], "Vendor not on on-chain allowlist");
        require(vendor != address(0), "Cannot pay address(0)");

        // 2. Idempotency Check
        require(!executedIdempotencyKeys[idempotencyKey], "Duplicate transaction blocked (Idempotency Key)");

        // 3. Daily Cap & Spending Roll Check
        uint256 today = block.timestamp / 1 days;
        if (today > currentDay) {
            currentDay = today;
            dailySpent = 0;
        }
        require(dailySpent + amount <= dailyCap, "Daily spending cap exceeded");

        // 4. On-Chain Approval & Per-Tx Guardrail
        if (amount > eip712ApprovalThreshold) {
            require(block.timestamp <= deadline, "EIP-712 signature expired");
            require(!usedNonces[nonce], "Signature nonce already used");
            usedNonces[nonce] = true;

            bytes32 structHash = keccak256(
                abi.encode(
                    DISBURSAL_TYPEHASH,
                    permissionRequestId,
                    vendor,
                    amount,
                    idempotencyKey,
                    nonce,
                    deadline
                )
            );
            bytes32 hash = _hashTypedDataV4(structHash);
            address signer = ECDSA.recover(hash, adminSignature);
            require(signer == adminApprover, "Invalid admin EIP-712 signature");
        } else {
            require(amount <= perTxCap, "Amount exceeds per-tx autonomous cap");
        }

        // 5. Backing and Execution
        require(usdc.balanceOf(address(this)) >= amount, "Disbursal vault unbacked");
        
        executedIdempotencyKeys[idempotencyKey] = true;
        dailySpent += amount;

        require(usdc.transfer(vendor, amount), "USDC transfer to vendor failed");

        emit DisbursalExecuted(permissionRequestId, vendor, amount, idempotencyKey);
    }
}
```

---

## 2. PostgreSQL Relational Ledger Schema

```sql
-- 1. Treasury Operating Accounts
CREATE TABLE treasury_accounts (
    account_id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    role VARCHAR(32) NOT NULL, -- 'OPEX_DEV', 'OPEX_GROWTH', 'PAYROLL', 'CAPEX_RESERVE'
    wallet_address VARCHAR(42) NOT NULL UNIQUE,
    chain_id INT NOT NULL DEFAULT 5042, -- Arc
    min_operating_floor_usdc NUMERIC(18, 6) NOT NULL DEFAULT 500.000000,
    safety_buffer_ratio NUMERIC(5, 2) NOT NULL DEFAULT 1.20,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Dynamic Liabilities Table
CREATE TABLE account_liabilities (
    liability_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id VARCHAR(64) REFERENCES treasury_accounts(account_id),
    vendor_id VARCHAR(64) NOT NULL,
    title VARCHAR(255) NOT NULL,
    category VARCHAR(32) NOT NULL,
    amount_usdc NUMERIC(18, 6) NOT NULL,
    due_date TIMESTAMPTZ NOT NULL,
    frequency_cron VARCHAR(64),
    payout_address VARCHAR(42) NOT NULL,
    source_po_hash VARCHAR(66),
    source_invoice_hash VARCHAR(66),
    status VARCHAR(32) NOT NULL DEFAULT 'SCHEDULED',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Verified Vendor Master Registry (Payee Substitution Protection)
CREATE TABLE vendor_master_registry (
    vendor_id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    verified_payout_address VARCHAR(42) NOT NULL,
    verified_by_admin VARCHAR(64) NOT NULL,
    last_verified_at TIMESTAMPTZ NOT NULL,
    change_lock BOOLEAN NOT NULL DEFAULT TRUE
);

-- 4. Standardized Permission Requests
CREATE TABLE permission_requests (
    request_id VARCHAR(64) PRIMARY KEY,
    action_type VARCHAR(64) NOT NULL,
    reason TEXT NOT NULL,
    amount_usdc NUMERIC(18, 6) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'APPROVED', 'REJECTED', 'EXECUTED'
    admin_instruction TEXT,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    decided_at TIMESTAMPTZ
);

-- 5. Account-Specific Immutable Audit Log
CREATE TABLE account_agent_audit_log (
    log_id BIGSERIAL PRIMARY KEY,
    account_id VARCHAR(64) REFERENCES treasury_accounts(account_id),
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    action_type VARCHAR(64) NOT NULL,
    amount_usdc NUMERIC(18, 6) NOT NULL,
    is_autonomous BOOLEAN NOT NULL,
    permission_request_id VARCHAR(64) REFERENCES permission_requests(request_id),
    tx_hash VARCHAR(66),
    counterparty_address VARCHAR(42),
    reason TEXT NOT NULL,
    pre_state_snapshot JSONB NOT NULL,
    post_state_snapshot JSONB NOT NULL,
    actor_agent VARCHAR(64) NOT NULL
);

-- 6. Sequential Master Hash-Linked System Journal
CREATE TABLE master_system_journal (
    sequence_id BIGSERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    account_id VARCHAR(64) NOT NULL,
    action_type VARCHAR(64) NOT NULL,
    debit_account VARCHAR(128) NOT NULL,
    credit_account VARCHAR(128) NOT NULL,
    amount_usdc NUMERIC(18, 6) NOT NULL,
    document_ref VARCHAR(128) NOT NULL,
    previous_hash VARCHAR(64) NOT NULL,
    current_hash VARCHAR(64) NOT NULL
);
```

---

## 3. Step-by-Step Implementation Roadmap

```
┌────────────────────────────────────────────────────────────────────────┐
│                        IMPLEMENTATION PHASES                           │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│  Phase 1: Smart Contracts & Arc Infrastructure                         │
│  - Compile and deploy CentralTreasuryYieldVault.sol on Arc.            │
│  - Compile and deploy DisbursalVault.sol on Arc.                       │
│  - Initialize Circle Developer-Controlled Wallets for accounts.        │
│  - Configure Arc 20 Gwei gas floor and System Emitter monitoring.      │
│                                                                        │
│  Phase 2: Database & Core Ledger Engine                                │
│  - Deploy PostgreSQL schema (accounts, liabilities, audit, journal).  │
│  - Implement hash-chaining engine in LedgerWitnessAgent.               │
│  - Implement Three-Way Match & Vendor Master Change Control.           │
│                                                                        │
│  Phase 3: Autonomous Treasury Sweeper & Predictive Recall             │
│  - Build reactive WebSocket listener for Arc balance changes.          │
│  - Implement dynamic SafeToInvest and Horizon calculation formula.     │
│  - Build autonomous sweep execution daemon (Fast-Path).                │
│  - Build PredictiveRefunderService (24h lead-time auto-recall).        │
│                                                                        │
│  Phase 4: Liability Radar & Human Gate System                          │
│  - Build 48h pre-due subscription notification pipeline.               │
│  - Implement Standardized Permission Request Generator (SPRS).        │
│  - Build Admin Approval / Cancellation webhook controller.             │
│                                                                        │
│  Phase 5: Multi-Account Disbursal & Waterfall Allocator               │
│  - Implement Multi-Account Waterfall Liquidity Router.                 │
│  - Implement atomic DisbursalVault execution and refunds.              │
│  - Run end-to-end simulation on Arc Testnet.                          │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```






