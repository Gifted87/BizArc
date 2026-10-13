# BizArc Architecture & Documentation Index

Welcome to the official technical documentation for the **BizArc Autonomous Multi-Agent Corporate Treasury System**, engineered on **Arc L1** (Circle's Layer-1 blockchain where USDC is the native gas token) and global banking networks.

---

## Documentation Directory

| Document | Description |
| :--- | :--- |
| **1. [Architecture Overview](file://wsl.localhost/Ubuntu-24.04/home/gifted/BizArc/docs/architecture_overview.md)** | High-level system architecture, Arc L1 protocol foundation, the Tripartite Balance Invariant ($B_E = B_L + B_Y$), the 6 Golden Rules of Enterprise Ledgers, and daemon runtime. |
| **2. [Agent Responsibilities & Swarm Topology](file://wsl.localhost/Ubuntu-24.04/home/gifted/BizArc/docs/agent_responsibilities.md)** | In-depth breakdown of the 6 cognitive LLM agents (IDs #100–#105), Swarm Coordinator, shared blackboard stream, dual-stream rolling compaction, and Reason-Bearing Intent lifecycle. |
| **3. [Universal Payment Rails & Routing Guide](file://wsl.localhost/Ubuntu-24.04/home/gifted/BizArc/docs/payment_rails_and_routing.md)** | Comprehensive specification of the 5 Universal Payment Rails (DisbursalVault, Modular Session Keys, ERC-3009, Gateway x402, and Fiat Banking Rails), 7 invariant gates, and Token Swaps. |
| **4. [Reactive State Machines & Orchestration](file://wsl.localhost/Ubuntu-24.04/home/gifted/BizArc/docs/state_machines_and_orchestration.md)** | Technical specification of the 5 reactive state machines, cross-machine closed-loop triggers, master orchestrator, background scheduler, and physical runtime daemon. |
| **5. [Security, Governance & Compliance Architecture](file://wsl.localhost/Ubuntu-24.04/home/gifted/BizArc/docs/security_and_compliance.md)** | Two-Layer Authorization Gate (Enforcer Agent vs. Human CFO), EIP-712 SPRS protocol, Anti-Payee Substitution Defense, Loud Rounding enforcement, and the 8 Production Pillars. |
| **6. [Database Schema, Ledger & Vector Memory](file://wsl.localhost/Ubuntu-24.04/home/gifted/BizArc/docs/database_and_double_entry_ledger.md)** | Complete PostgreSQL relational schema (22 tables), Master System Journal with sequential SHA-256 hash chaining, Three Dynamic Records, and Enterprise Vector Memory (pgvector HNSW). |
| **7. [API, Webhooks & Agent Tool Reference](file://wsl.localhost/Ubuntu-24.04/home/gifted/BizArc/docs/api_and_tool_reference.md)** | Complete reference of physical REST Ingress endpoints, Circle Mint webhooks, and 30+ deterministic tools provided by the Tool Registry to cognitive LLM agents. |

---

## Core System Invariants at a Glance

1. **Native USDC Gas**: Arc L1 uses USDC as native gas token with a deterministic 20 Gwei gas floor and sub-second finality.
2. **Tripartite Balance Invariant**: $B_E = B_L + B_Y$ maintains strict equality between total purchasing power, operating cash, and USYC yield shares.
3. **Payee Substitution Protection**: Payment destinations are verified strictly against immutable master records; addresses on invoice headers are never trusted.
4. **Loud Rounding Arithmetic**: Financial calculations enforce exact 6-decimal USDC integer math; fractional cent truncations throw loud errors.
5. **Deterministic Idempotency**: All payment intents generate 32-byte Keccak-256 keys preventing duplicate executions across smart contracts and APIs.
6. **Sequential Hash-Linked Audit**: Master System Journal entries form an unbroken cryptographic SHA-256 chain verified programmatically.
