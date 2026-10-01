### Dependency DAG

The above preserves the document's structure. The actual **execution dependency graph** should be implemented in this order:

```text
D0
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
    ├── account_liabilities
    ├── vendor_master_registry
    ├── permission_requests
    ├── account_agent_audit_log
    └── master_system_journal


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
├── D8 Account Intelligence Layer
│   └── get_account_intelligence()
│
└── D9 Liability Intelligence Layer
    ├── AccountLiabilities
    ├── recurring schedules
    ├── vendor relationships
    └── document-linked records


D8 + D9 + D3
│
└── D10 TreasurySentinelAgent
    │
    ├── D10.1 Balance event ingestion
    ├── D10.2 Debounce
    ├── D10.3 Internal-settlement filtering
    ├── D10.4 Account lock
    ├── D10.5 Liquidity Horizon
    ├── D10.6 TargetReserve
    ├── D10.7 SafeToInvest
    ├── D10.8 Hysteresis
    └── D10.9 PolicyComplianceAgent check
              │
              ├── INSIDE RULES
              │     └── D11 Autonomous sweep
              │           └── D7 LedgerWitness
              │
              └── OUTSIDE RULES
                    └── D12 Human Gate / SPRS


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
    ├── liquid USDC
    ├── invested USYC
    ├── total effective balance
    ├── liabilities
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


D15
│
└── D16 PolicyComplianceAgent
    ├── Three-Way Match
    ├── Vendor Master validation
    ├── Payee substitution detection
    ├── Amount/PO verification
    ├── SPRS generation
    └── Human approval where required
          │
          ├── REJECT/CANCEL
          │   └── stop execution
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
                                   └── D7 LedgerWitness
                                        ├── verify receipt
                                        ├── account logs
                                        └── master journal


D11 + D13 + D19
│
└── D20 Unified Operational State
    ├── Liquid balance
    ├── Invested balance
    ├── Effective balance
    ├── Liabilities
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
