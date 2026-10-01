### Dependency DAG

The above preserves the document's structure. The actual **execution dependency graph** should be implemented in this order:

```text
D0
│
├── D0.B OnboardingAgent (Automated Business Discovery & Setup)
│   ├── ERP / Document / App Ingestion (ERPNext, Odoo, Invoices, Contracts)
│   ├── Cost-Center & Liability Discovery
│   ├── Suggested Policy Generation (Math suggestions + Declared Policies)
│   ├── Circle MPC Agent Wallet Provisioning on Arc L1
│   ├── Vault Registration & ERC-20 Allowances
│   ├── Spending Guardrail Hand-off (Terminal CLI OTP command)
│   └── Activation Deposit Ingestion
│
├── D1  Architecture + Environment Configuration
│   ├── Dual-layer architecture
│   ├── HACKATHON_DEMO policy
│   ├── PRODUCTION policy structure
│   └── Agent responsibilities
│
├── D2  Arc + Wallet Foundation
│   ├── Arc configuration
│   ├── Circle wallets
│   ├── USDC
│   └── event/webhook infrastructure
│
└── D3  Smart Contract Foundation
    │
    ├── CentralTreasuryYieldVault.sol
    │   └── D4 Account registration + accountShares
    │
    └── DisbursalVault.sol
        └── D5 Vendor allowlist + caps + EIP-712 + idempotency


D4
│
└── D6 PostgreSQL Foundation
    ├── treasury_accounts
    ├── account_liabilities (Record 1: dynamic liabilities & recurring schedules)
    ├── vendor_master_registry (Rule 3: payee protection)
    ├── permission_requests (SPRS)
    ├── account_agent_audit_log
    ├── master_system_journal (cryptographic hash chain)
    └── erp_sync_state (ERPNext / Odoo sync checkpoints)


D6
│
├── D7 LedgerWitnessAgent
│   ├── Independent RPC
│   ├── Webhooks
│   ├── Receipt reconciliation
│   ├── Double-entry vouchers
│   ├── Account audit log
│   └── Hash-chained master journal
│
├── D8 Account Intelligence Layer (Record 2 + Tripartite Balance)
│   ├── Parallel Tripartite Balance Model (BL + BY = BE)
│   ├── Dynamic SafeToInvest & Liquidity Horizon
│   └── get_account_intelligence()
│
└── D9 Liability Intelligence Layer (Record 1: ERP & Document Ingestion)
    ├── ERP Connectors (ERPNext / Odoo REST & JSON-RPC)
    ├── Programmatic Three-Way Match (PO + Delivery Receipt + Invoice)
    ├── Vendor Master Lock (Payee substitution defense)
    ├── Stealth price-hike detection (>15%)
    ├── Recurring schedules & 48h pre-flight SPRS
    └── Loud repair (refusing ERPNext 0.5 round-off sweeps)


D8 + D9 + D3
│
└── D10 TreasurySentinelAgent (The Operator)
    │
    ├── D10.1 Balance event ingestion
    ├── D10.2 Debounce
    ├── D10.3 Internal-settlement filtering
    ├── D10.4 Account lock
    ├── D10.5 Liquidity Horizon
    ├── D10.6 TargetReserve
    ├── D10.7 SafeToInvest
    ├── D10.8 Hysteresis
    └── D10.9 Reason-Bearing Intent Submission (Action + Amount + declaredReason)
              │
              └── D16 PolicyComplianceAgent Evaluation


D9 + D10
│
└── D13 PredictiveRefunderService
    ├── Due-date scanning
    ├── Redemption lead time
    ├── Shortfall calculation
    ├── USYC liquidity check
    └── recallForAccount()
          │
          └── D7 LedgerWitness


D8 + D9 + D10
│
└── D14 Unified Asset Aggregator
    ├── liquid USDC (BL)
    ├── invested USYC (BY)
    ├── total effective balance (BE = BL + BY)
    ├── liabilities (Record 1)
    └── free capital


D14 + D3 + D12
│
└── D15 DisbursalRouterAgent
    │
    ├── Role compatibility
    ├── Free-capital qualification
    ├── Liability protection
    ├── Single-account routing
    │
    └── If insufficient:
        └── Multi-account waterfall
            ├── Eligible accounts
            ├── Priority rules
            ├── Payroll exclusions
            └── Allocation plan


D15 + D10
│
└── D16 PolicyComplianceAgent (The Governance Gatekeeper & Enforcer)
    ├── Dual-Tier Policy Evaluation:
    │   ├── Mathematical Rules (Hard deterministic floors, spend caps, hysteresis)
    │   └── Declared Policies (Human-prompted directives: cost-center rules, price hike limits)
    ├── Reason-Bearing Intent Verification (Validates Treasury's declaredReason)
    ├── Three Decision Outcomes:
    │   ├── 1. PERMIT (Fast-path Clearance Code + Execution Token)
    │   ├── 2. DENY (Hard invariant violation)
    │   └── 3. ESCALATE_TO_SPRS (Hard/ambiguous decision OR outside rules with reasonable declared intent)
    ├── SPRS Formulation (Proposal, declared reason, conflicting policy, binary options)
    └── Human approval / EIP-712 verification
          │
          ├── REJECT/CANCEL
          │   └── stop execution + cancellation memo
          │
          └── APPROVE
              └── D17 authorize_transaction_intent()
                    │
                    └── D18 Stage funds
                        │
                        └── D19 DisbursalVault.executePayment()
                              │
                              ├── vendor allowlist
                              ├── idempotency
                              ├── daily cap
                              ├── EIP-712 threshold
                              └── payment
                                   │
                                   ├── D7 LedgerWitness (verify receipt, audit log, master journal)
                                   └── D20.B ERP Reconciliation Syncer (write document-linked Payment Entry to Odoo/ERPNext)


D11 + D13 + D19 + D20.B
│
└── D20 Unified Operational State
    ├── Liquid balance
    ├── Invested balance
    ├── Effective balance
    ├── Liabilities (Record 1)
    ├── Safe-to-Invest Horizon (Record 2)
    ├── ERP Sync Status
    ├── Audit state
    └── Transaction state


D20
│
└── D21 End-to-End Test Scenarios
    │
    ├── Scenario 1
    │   Revenue
    │    → event
    │    → Sentinel
    │    → SafeToInvest
    │    → autonomous sweep
    │    → Witness
    │    → audit
    │
    ├── Scenario 2
    │   Subscription
    │    → Radar
    │    → policy threshold
    │    → SPRS
    │    → human
    │       ├── approve
    │       │   → recall if necessary
    │       │   → payment
    │       │   → audit
    │       └── cancel
    │           → freeze
    │           → cancellation task
    │           → audit
    │
    └── Scenario 3
        Invoice
         → Router
         → account intelligence
         → waterfall
         → SPRS
         → human approval
         → source accounts
         → DisbursalVault
         → vendor
         → Witness
         → master journal


D21
│
└── D22 Arc Testnet Validation
    ├── Contract behavior
    ├── USDC movement
    ├── USYC/mock USYC
    ├── autonomous sweep
    ├── recall
    ├── human gate
    ├── multi-account waterfall
    ├── disbursal
    ├── refunds
    ├── accounting reconciliation
    └── audit integrity


D22
│
└── D23 Production Readiness Path
    ├── Replace mock USYC with allowlisted production integration
    ├── Production policy profile
    ├── Production redemption latency
    ├── Production spending limits
    ├── Production wallet configuration
    ├── Production vendor registry
    ├── Monitoring
    └── operational controls
```

The key architectural dependency is therefore:

```text
SMART CONTRACT SAFETY
        +
ACCOUNT / LIABILITY STATE
        +
INDEPENDENT LEDGER WITNESS
        ↓
ACCOUNT INTELLIGENCE
        ↓
AGENT DECISION LAYER
        ↓
POLICY COMPLIANCE
        ↓
       ┌───────────────────────┐
       │                       │
   INSIDE RULES           OUTSIDE RULES
       │                       │
 Autonomous execution      Human SPRS
       │                       │
       └───────────┬───────────┘
                   ↓
          ONCHAIN EXECUTION
                   ↓
          INDEPENDENT WITNESS
                   ↓
       ACCOUNT LOG + MASTER JOURNAL
                   ↓
          UPDATED SYSTEM STATE
                   ↓
             NEXT DECISION
```

And the **critical implementation ordering** from the plan is:

```text
1. Arc + Wallet Infrastructure
        ↓
2. Smart Contracts
        ↓
3. PostgreSQL Ledger
        ↓
4. LedgerWitnessAgent
        ↓
5. Account Intelligence
        ↓
6. Liability Registry / LiabilityRadarAgent
        ↓
7. TreasurySentinelAgent
        ↓
8. PolicyComplianceAgent + SPRS + Human Gate
        ↓
9. Predictive Recall
        ↓
10. Unified Asset Aggregator
        ↓
11. DisbursalRouterAgent
        ↓
12. Multi-Account Waterfall
        ↓
13. DisbursalVault Execution
        ↓
14. End-to-End Agent Scenarios
        ↓
15. Arc Testnet Validation
        ↓
16. Production Integration
```

This makes the **LedgerWitnessAgent, policy layer, and smart-contract layer foundational dependencies**, rather than features to bolt on after the autonomous agents are built. The plan explicitly separates execution from independent verification, and the execution DAG reflects that dependency. 
