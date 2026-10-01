-- BizArc Autonomous Multi-Agent Treasury & Financial Operations Platform
-- PostgreSQL Relational Ledger Schema (Phase 2 / D6 Foundation)
-- Architectural standard: Canteen Agents and Ledgers 2026

-- 1. Treasury Operating Accounts
CREATE TABLE IF NOT EXISTS treasury_accounts (
    account_id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    role VARCHAR(32) NOT NULL, -- 'OPEX_DEV', 'OPEX_GROWTH', 'PAYROLL', 'TREASURY_RESERVE', 'CAPEX'
    wallet_address VARCHAR(42) NOT NULL UNIQUE,
    chain_id INT NOT NULL DEFAULT 5042, -- Arc Mainnet (5042) or Arc Testnet (5042002)
    min_operating_floor_usdc NUMERIC(18, 6) NOT NULL DEFAULT 500.000000,
    safety_buffer_ratio NUMERIC(5, 2) NOT NULL DEFAULT 1.20,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Dynamic Liabilities Table
CREATE TABLE IF NOT EXISTS account_liabilities (
    liability_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id VARCHAR(64) REFERENCES treasury_accounts(account_id) ON DELETE RESTRICT,
    vendor_id VARCHAR(64) NOT NULL,
    title VARCHAR(255) NOT NULL,
    category VARCHAR(32) NOT NULL, -- 'SUBSCRIPTION', 'DEBT_SERVICE', 'PAYROLL', 'MILESTONE', 'INFRASTRUCTURE', 'CONTRACTOR'
    amount_usdc NUMERIC(18, 6) NOT NULL,
    due_date TIMESTAMPTZ NOT NULL,
    frequency_cron VARCHAR(64),
    payout_address VARCHAR(42) NOT NULL,
    source_po_hash VARCHAR(66),
    source_invoice_hash VARCHAR(66),
    status VARCHAR(32) NOT NULL DEFAULT 'SCHEDULED', -- 'SCHEDULED', 'AWAITING_APPROVAL', 'DISBURSED', 'CANCELLED', 'FROZEN'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_liabilities_account ON account_liabilities(account_id);
CREATE INDEX IF NOT EXISTS idx_liabilities_due_date ON account_liabilities(due_date);
CREATE INDEX IF NOT EXISTS idx_liabilities_status ON account_liabilities(status);
CREATE INDEX IF NOT EXISTS idx_liabilities_vendor ON account_liabilities(vendor_id);

-- 3. Verified Vendor Master Registry (Payee Substitution Protection per Rule 3)
CREATE TABLE IF NOT EXISTS vendor_master_registry (
    vendor_id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    verified_payout_address VARCHAR(42) NOT NULL,
    verified_by_admin VARCHAR(64) NOT NULL,
    last_verified_at TIMESTAMPTZ NOT NULL,
    change_lock BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX IF NOT EXISTS idx_vendor_payout_addr ON vendor_master_registry(verified_payout_address);

-- 4. Standardized Permission Requests (SPRS per Architecture Plan)
CREATE TABLE IF NOT EXISTS permission_requests (
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

CREATE INDEX IF NOT EXISTS idx_permission_status ON permission_requests(status);

-- 5. Account-Specific Immutable Audit Log
CREATE TABLE IF NOT EXISTS account_agent_audit_log (
    log_id BIGSERIAL PRIMARY KEY,
    account_id VARCHAR(64) REFERENCES treasury_accounts(account_id) ON DELETE RESTRICT,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    action_type VARCHAR(64) NOT NULL,
    amount_usdc NUMERIC(18, 6) NOT NULL,
    is_autonomous BOOLEAN NOT NULL,
    permission_request_id VARCHAR(64) REFERENCES permission_requests(request_id) ON DELETE SET NULL,
    tx_hash VARCHAR(66),
    counterparty_address VARCHAR(42),
    reason TEXT NOT NULL,
    pre_state_snapshot JSONB NOT NULL,
    post_state_snapshot JSONB NOT NULL,
    actor_agent VARCHAR(64) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_account ON account_agent_audit_log(account_id);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON account_agent_audit_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_action ON account_agent_audit_log(action_type);

-- 6. Sequential Master Hash-Linked System Journal (Rule 1 & Rule 4 Tamper-Evident Ledger)
CREATE TABLE IF NOT EXISTS master_system_journal (
    sequence_id BIGSERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    account_id VARCHAR(64) NOT NULL,
    action_type VARCHAR(64) NOT NULL,
    debit_account VARCHAR(128) NOT NULL,
    credit_account VARCHAR(128) NOT NULL,
    amount_usdc NUMERIC(18, 6) NOT NULL,
    document_ref VARCHAR(128) NOT NULL,
    previous_hash VARCHAR(66) NOT NULL,
    current_hash VARCHAR(66) NOT NULL
);


CREATE INDEX IF NOT EXISTS idx_journal_sequence ON master_system_journal(sequence_id);
CREATE INDEX IF NOT EXISTS idx_journal_account ON master_system_journal(account_id);
CREATE INDEX IF NOT EXISTS idx_journal_doc_ref ON master_system_journal(document_ref);

-- ======================================================================================
-- 7. Enterprise Vector Memory (pgvector HNSW Cosine Index)
-- Supports RAG for Company Bylaws, MSAs, SLAs, Contracts, Board Minutes, ERP POs & Invoices
-- ======================================================================================
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS enterprise_vector_memory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    collection VARCHAR(64) NOT NULL, -- 'company_documents', 'msas', 'board_resolutions', 'vendor_masters', 'erp_pos', 'erp_invoices', 'historical_rulings', 'episodic_memory'
    document_id VARCHAR(128) NOT NULL,
    title VARCHAR(255) NOT NULL,
    chunk_index INT NOT NULL DEFAULT 0,
    content TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    embedding vector(1536),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vector_memory_collection ON enterprise_vector_memory(collection);
CREATE INDEX IF NOT EXISTS idx_vector_memory_doc_id ON enterprise_vector_memory(document_id);
CREATE INDEX IF NOT EXISTS idx_vector_memory_hnsw ON enterprise_vector_memory USING hnsw (embedding vector_cosine_ops);

-- ======================================================================================
-- 8. Single Continuous Running Context (Blackboard Stream)
-- Shared real-time event ledger across all model-agnostic swarm agents
-- ======================================================================================
CREATE TABLE IF NOT EXISTS agent_continuous_context (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id VARCHAR(64) NOT NULL,
    event_seq BIGSERIAL,
    agent_id INT NOT NULL,
    agent_name VARCHAR(64) NOT NULL,
    event_type VARCHAR(64) NOT NULL, -- 'TASK_INITIATED', 'LLM_DELIBERATION', 'TOOL_CALLED', 'TOOL_RESULT', 'INVARIANT_CHECK', 'STATE_MUTATION', 'SYSTEM_INTERRUPT'
    role VARCHAR(32) NOT NULL, -- 'system', 'user', 'assistant', 'tool'
    content TEXT NOT NULL,
    tool_calls JSONB,
    tool_call_id VARCHAR(128),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_compacted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_context_session_seq ON agent_continuous_context(session_id, event_seq);
CREATE INDEX IF NOT EXISTS idx_context_compacted ON agent_continuous_context(session_id, is_compacted);

-- ======================================================================================
-- 9. Dual-Stream Rolling Compaction Episodes (Tier 2 Context)
-- Narrative strategic synthesis + deterministic 6-decimal invariant anchors
-- ======================================================================================
CREATE TABLE IF NOT EXISTS agent_context_compaction_episodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id VARCHAR(64) NOT NULL,
    episode_index INT NOT NULL,
    start_seq BIGINT NOT NULL,
    end_seq BIGINT NOT NULL,
    narrative_summary TEXT NOT NULL,
    deterministic_anchors JSONB NOT NULL, -- exact numeric balances, pending liabilities, doc hashes
    embedding vector(1536),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compaction_session_idx ON agent_context_compaction_episodes(session_id, episode_index);

-- ======================================================================================
-- 10. Dynamic Safe-to-Invest Record (Dynamic Record 2)
-- Continuous calculation of investable liquidity vs upcoming liabilities
-- ======================================================================================
CREATE TABLE IF NOT EXISTS dynamic_safe_to_invest (
    record_id BIGSERIAL PRIMARY KEY,
    account_id VARCHAR(64) REFERENCES treasury_accounts(account_id) ON DELETE RESTRICT,
    liquid_cash_usdc NUMERIC(18, 6) NOT NULL,
    invested_yield_usdc NUMERIC(18, 6) NOT NULL,
    available_balance_usdc NUMERIC(18, 6) NOT NULL,
    target_reserve_usdc NUMERIC(18, 6) NOT NULL,
    safe_to_invest_usdc NUMERIC(18, 6) NOT NULL,
    time_horizon_seconds BIGINT NOT NULL,
    recall_speed_seconds INT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_safe_to_invest_account ON dynamic_safe_to_invest(account_id);
CREATE INDEX IF NOT EXISTS idx_safe_to_invest_created ON dynamic_safe_to_invest(created_at DESC);

