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
    previous_hash VARCHAR(64) NOT NULL,
    current_hash VARCHAR(64) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_journal_sequence ON master_system_journal(sequence_id);
CREATE INDEX IF NOT EXISTS idx_journal_account ON master_system_journal(account_id);
CREATE INDEX IF NOT EXISTS idx_journal_doc_ref ON master_system_journal(document_ref);
