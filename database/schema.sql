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
CREATE INDEX IF NOT EXISTS idx_vector_memory_hnsw ON enterprise_vector_memory USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);

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

-- ======================================================================================
-- 11. ERP Sync State (ERPNext / Odoo Sync Checkpoints)
-- Tracks synchronization checkpoints, last synced document IDs, and status for ERPs
-- ======================================================================================
CREATE TABLE IF NOT EXISTS erp_sync_state (
    sync_id VARCHAR(64) PRIMARY KEY,
    system_type VARCHAR(32) NOT NULL, -- 'ERPNEXT', 'ODOO'
    account_id VARCHAR(64) REFERENCES treasury_accounts(account_id) ON DELETE CASCADE,
    entity_type VARCHAR(64) NOT NULL, -- 'PURCHASE_INVOICE', 'PAYMENT_ENTRY', 'PURCHASE_ORDER', 'STOCK_PICKING'
    last_sync_timestamp TIMESTAMPTZ NOT NULL,
    last_synced_document_id VARCHAR(128),
    sync_checkpoint_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(32) NOT NULL DEFAULT 'SYNCED', -- 'SYNCED', 'SYNCING', 'FAILED'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_erp_sync_system ON erp_sync_state(system_type, entity_type);
CREATE INDEX IF NOT EXISTS idx_erp_sync_account ON erp_sync_state(account_id);

-- ======================================================================================
-- 12. Enterprise Company Profiles (Ingested & Connected App Profile)
-- Stores synthesized company profiles, connected ERP & MCP apps, and inferred policies
-- ======================================================================================
CREATE TABLE IF NOT EXISTS company_profiles (
    company_id VARCHAR(64) PRIMARY KEY,
    company_name VARCHAR(255) NOT NULL,
    business_description TEXT,
    connected_apps JSONB NOT NULL DEFAULT '[]'::jsonb,
    discovered_cost_centers JSONB NOT NULL DEFAULT '[]'::jsonb,
    inferred_policies JSONB NOT NULL DEFAULT '{}'::jsonb,
    activation_status VARCHAR(32) NOT NULL DEFAULT 'PENDING_ACTIVATION',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_company_profiles_name ON company_profiles(company_name);

-- ======================================================================================
-- 13. Movement Policies (Cross-Account Waterfall & Liquidity Routing)
-- Enforces priority ordering, cost-center boundaries, and protected accounts
-- ======================================================================================
CREATE TABLE IF NOT EXISTS movement_policies (
    policy_id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    priority_order JSONB NOT NULL DEFAULT '[]'::jsonb,
    protected_accounts JSONB NOT NULL DEFAULT '[]'::jsonb,
    cross_account_borrowing_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    max_borrowing_ratio NUMERIC(5, 2) NOT NULL DEFAULT 0.50,
    human_approval_threshold_usdc NUMERIC(18, 6) NOT NULL DEFAULT 1000.000000,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ======================================================================================
-- 14. Recurring Liability Change Proposals (Human & Agent Lifecycle)
-- Manages addition, modification, and cancellation of recurring commitments with Human Gate
-- ======================================================================================
CREATE TABLE IF NOT EXISTS recurring_liability_proposals (
    proposal_id VARCHAR(64) PRIMARY KEY,
    action_type VARCHAR(32) NOT NULL, -- 'ADD', 'EDIT', 'REMOVE'
    liability_id UUID,
    account_id VARCHAR(64) REFERENCES treasury_accounts(account_id) ON DELETE CASCADE,
    vendor_id VARCHAR(64) NOT NULL,
    proposed_by VARCHAR(64) NOT NULL, -- 'HUMAN' or agent persona
    details JSONB NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING_HUMAN_APPROVAL', -- 'PENDING_HUMAN_APPROVAL', 'APPROVED', 'REJECTED'
    sprs_request_id VARCHAR(64),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proposals_status ON recurring_liability_proposals(status);
CREATE INDEX IF NOT EXISTS idx_proposals_account ON recurring_liability_proposals(account_id);

-- ======================================================================================
-- 15. Session Key Registry (ERC-4337 / ERC-6900 Modular Accounts)
-- Persistent policy scopes, spending caps, and valid time horizons for session keys
-- ======================================================================================
CREATE TABLE IF NOT EXISTS session_key_registry (
    session_key_id VARCHAR(64) PRIMARY KEY,
    account_id VARCHAR(64) REFERENCES treasury_accounts(account_id) ON DELETE CASCADE,
    allowed_recipient VARCHAR(42) NOT NULL,
    max_amount_per_cycle_usdc NUMERIC(18, 6) NOT NULL,
    cycle_duration_seconds INT NOT NULL,
    current_cycle_spent_usdc NUMERIC(18, 6) NOT NULL DEFAULT 0.000000,
    valid_until_timestamp BIGINT NOT NULL,
    last_executed_timestamp BIGINT,
    public_key_hex TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_keys_account ON session_key_registry(account_id);
CREATE INDEX IF NOT EXISTS idx_session_keys_recipient ON session_key_registry(allowed_recipient);

-- ======================================================================================
-- 16. ERC-3009 Authorizations Registry (Native Arc USDC Gasless Signed Mandates)
-- Persistent nonces and execution state for receiveWithAuthorization replay defense
-- ======================================================================================
CREATE TABLE IF NOT EXISTS erc3009_authorizations (
    nonce VARCHAR(66) PRIMARY KEY,
    from_address VARCHAR(42) NOT NULL,
    to_address VARCHAR(42) NOT NULL,
    amount_raw NUMERIC(30, 0) NOT NULL,
    valid_after BIGINT NOT NULL,
    valid_before BIGINT NOT NULL,
    intent_id VARCHAR(100),
    tx_hash VARCHAR(66),
    executed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_erc3009_from ON erc3009_authorizations(from_address);
CREATE INDEX IF NOT EXISTS idx_erc3009_to ON erc3009_authorizations(to_address);

-- ======================================================================================
-- 17. Onboarding Wizard Sessions Table
-- ======================================================================================
CREATE TABLE IF NOT EXISTS onboarding_wizard_sessions (
    session_id VARCHAR(64) PRIMARY KEY,
    company_id VARCHAR(64) NOT NULL,
    current_step INT NOT NULL DEFAULT 1,
    total_steps INT NOT NULL DEFAULT 6,
    entry_path VARCHAR(32) NOT NULL, -- 'MANUAL', 'GOOGLE_WORKSPACE', 'MICROSOFT_365', 'ODOO', 'ERPNEXT'
    draft_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    completed_steps JSONB NOT NULL DEFAULT '[]'::jsonb,
    status VARCHAR(32) NOT NULL DEFAULT 'IN_PROGRESS', -- 'IN_PROGRESS', 'DRAFT_READY', 'COMPLETED', 'ABANDONED'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wizard_company ON onboarding_wizard_sessions(company_id);
CREATE INDEX IF NOT EXISTS idx_wizard_status ON onboarding_wizard_sessions(status);

-- ======================================================================================
-- 18. Mathematical Rules Q&A Responses Audit Ledger
-- ======================================================================================
CREATE TABLE IF NOT EXISTS math_rules_qa_responses (
    response_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id VARCHAR(64) NOT NULL,
    account_id VARCHAR(64), -- NULL for general company-wide rules
    liability_id UUID,     -- NULL for non-liability rules
    category VARCHAR(32) NOT NULL, -- 'GENERAL_MATH', 'ACCOUNT_MATH', 'LIABILITY_MATH', 'INVESTMENT_MATH'
    question_id VARCHAR(64) NOT NULL,
    question_text TEXT NOT NULL,
    user_answer TEXT NOT NULL,
    derived_parameter_name VARCHAR(64) NOT NULL,
    derived_value NUMERIC(18, 6) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qa_company ON math_rules_qa_responses(company_id);
CREATE INDEX IF NOT EXISTS idx_qa_category ON math_rules_qa_responses(category);

-- ======================================================================================
-- 19. Tenant OAuth Credentials Store (Production MCP & Integrations)
-- ======================================================================================
CREATE TABLE IF NOT EXISTS tenant_oauth_tokens (
    token_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id VARCHAR(64) NOT NULL,
    provider VARCHAR(32) NOT NULL, -- 'GOOGLE_WORKSPACE', 'MICROSOFT_365', 'ODOO_SESSION', 'ERPNEXT_KEY'
    access_token_encrypted TEXT NOT NULL,
    refresh_token_encrypted TEXT,
    token_scope TEXT,
    expires_at TIMESTAMPTZ,
    session_metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_company_provider UNIQUE (company_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_oauth_company ON tenant_oauth_tokens(company_id);

-- ======================================================================================
-- 20. Multi-Tenant Schema Column Extensions
-- ======================================================================================
ALTER TABLE treasury_accounts
    ADD COLUMN IF NOT EXISTS company_id VARCHAR(64) NOT NULL DEFAULT 'default_org',
    ADD COLUMN IF NOT EXISTS per_tx_cap_usdc NUMERIC(18, 6) DEFAULT 500.000000,
    ADD COLUMN IF NOT EXISTS daily_cap_usdc NUMERIC(18, 6) DEFAULT 5000.000000,
    ADD COLUMN IF NOT EXISTS weekly_cap_usdc NUMERIC(18, 6) DEFAULT 25000.000000,
    ADD COLUMN IF NOT EXISTS monthly_cap_usdc NUMERIC(18, 6) DEFAULT 100000.000000,
    ADD COLUMN IF NOT EXISTS authorized_categories JSONB DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS max_autonomous_sweep_usdc NUMERIC(18, 6) DEFAULT 1000.000000,
    ADD COLUMN IF NOT EXISTS exclude_from_waterfall BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS account_declared_policies JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_accounts_company ON treasury_accounts(company_id);

ALTER TABLE account_liabilities
    ADD COLUMN IF NOT EXISTS company_id VARCHAR(64) NOT NULL DEFAULT 'default_org',
    ADD COLUMN IF NOT EXISTS preferred_payment_rail VARCHAR(32) NOT NULL DEFAULT 'DISBURSAL_VAULT',
    ADD COLUMN IF NOT EXISTS payment_rail_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS disbursal_rules JSONB NOT NULL DEFAULT '{"autoPayThresholdUsdc": 500, "requireThreeWayMatch": true, "preFlightLeadTimeHours": 48}'::jsonb,
    ADD COLUMN IF NOT EXISTS waterfall_override JSONB DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_liabilities_company ON account_liabilities(company_id);
CREATE INDEX IF NOT EXISTS idx_liabilities_rail ON account_liabilities(preferred_payment_rail);

ALTER TABLE movement_policies
    ADD COLUMN IF NOT EXISTS company_id VARCHAR(64) NOT NULL DEFAULT 'default_org';

CREATE INDEX IF NOT EXISTS idx_movement_company ON movement_policies(company_id);

ALTER TABLE master_system_journal
    ADD COLUMN IF NOT EXISTS company_id VARCHAR(64) NOT NULL DEFAULT 'default_org';

CREATE INDEX IF NOT EXISTS idx_journal_company ON master_system_journal(company_id);

-- 20. External App Polling & Autonomous Scheduler Jobs
CREATE TABLE IF NOT EXISTS external_app_polling_jobs (
    job_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id VARCHAR(64) NOT NULL,
    app_type VARCHAR(64) NOT NULL,
    polling_frequency_cron VARCHAR(64) DEFAULT '0 */6 * * *',
    interval_seconds INTEGER DEFAULT 21600,
    last_polled_at TIMESTAMP WITH TIME ZONE,
    next_poll_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    status VARCHAR(32) DEFAULT 'IDLE',
    last_discovered_count INTEGER DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(company_id, app_type)
);

CREATE INDEX IF NOT EXISTS idx_polling_jobs_due ON external_app_polling_jobs(next_poll_at, status);
CREATE INDEX IF NOT EXISTS idx_polling_jobs_company ON external_app_polling_jobs(company_id);

-- 21. Enforcer Compliance Clearance Codes (Single-Use, Bound to Action, Account, Amount & Expiry)
CREATE TABLE IF NOT EXISTS compliance_clearance_codes (
    code VARCHAR(64) PRIMARY KEY,
    account_id VARCHAR(64) NOT NULL,
    action_type VARCHAR(64) NOT NULL,
    amount_usdc NUMERIC(18, 6) NOT NULL,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    is_consumed BOOLEAN NOT NULL DEFAULT FALSE,
    consumed_at TIMESTAMPTZ,
    recipient_address VARCHAR(42)
);

CREATE INDEX IF NOT EXISTS idx_clearance_code_status ON compliance_clearance_codes(is_consumed, expires_at);
CREATE INDEX IF NOT EXISTS idx_clearance_code_account ON compliance_clearance_codes(account_id);

-- ======================================================================================
-- 22. Vendor Bank Accounts Registry (Payee Substitution Defense & Traditional Offramps)
-- ======================================================================================
CREATE TABLE IF NOT EXISTS vendor_bank_accounts (
    bank_account_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id VARCHAR(64) NOT NULL,
    account_holder_name VARCHAR(255) NOT NULL,
    iban_account_number VARCHAR(128) NOT NULL,
    routing_swift VARCHAR(64) NOT NULL,
    bank_name VARCHAR(128),
    bank_country VARCHAR(8) NOT NULL DEFAULT 'US',
    is_verified BOOLEAN NOT NULL DEFAULT TRUE,
    verified_by_admin VARCHAR(64) DEFAULT 'SYSTEM',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_vendor_bank UNIQUE (vendor_id, iban_account_number)
);

CREATE INDEX IF NOT EXISTS idx_vendor_bank_vendor ON vendor_bank_accounts(vendor_id);

-- ======================================================================================
-- 23. Fiat Payout Records (Circle Mint / Fedwire / ACH Traditional Banking Disbursals)
-- ======================================================================================
CREATE TABLE IF NOT EXISTS fiat_payout_records (
    payout_id VARCHAR(64) PRIMARY KEY,
    account_id VARCHAR(64) NOT NULL,
    vendor_id VARCHAR(64) NOT NULL,
    amount_usdc NUMERIC(18, 6) NOT NULL,
    fee_usdc NUMERIC(18, 6) NOT NULL DEFAULT 0.000000,
    status VARCHAR(32) NOT NULL DEFAULT 'INITIATED', -- 'INITIATED', 'PROCESSING', 'SETTLED', 'FAILED', 'ESCALATED'
    beneficiary_bank_id UUID REFERENCES vendor_bank_accounts(bank_account_id) ON DELETE SET NULL,
    circle_payout_ref VARCHAR(128),
    burn_tx_hash VARCHAR(66),
    sprs_request_id VARCHAR(100),
    invoice_ref VARCHAR(255),
    estimated_arrival TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    settled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_fiat_payout_account ON fiat_payout_records(account_id);
CREATE INDEX IF NOT EXISTS idx_fiat_payout_vendor ON fiat_payout_records(vendor_id);
CREATE INDEX IF NOT EXISTS idx_fiat_payout_status ON fiat_payout_records(status);

-- ======================================================================================
-- 24. Token Swap Records (Circle Swap Kit / Viem Multi-Chain FX Conversions)
-- ======================================================================================
CREATE TABLE IF NOT EXISTS token_swap_records (
    swap_id VARCHAR(64) PRIMARY KEY,
    account_id VARCHAR(64) NOT NULL,
    from_chain VARCHAR(32) NOT NULL,
    from_token VARCHAR(64) NOT NULL,
    to_chain VARCHAR(32) NOT NULL,
    to_token VARCHAR(64) NOT NULL,
    from_amount NUMERIC(18, 6) NOT NULL,
    to_amount NUMERIC(18, 6) NOT NULL,
    realized_rate NUMERIC(18, 8) NOT NULL,
    slippage_bps INTEGER NOT NULL DEFAULT 50,
    tx_hash VARCHAR(66),
    status VARCHAR(32) NOT NULL DEFAULT 'COMPLETED', -- 'COMPLETED', 'PENDING', 'REJECTED_BY_POLICY', 'FAILED'
    route_aggregator VARCHAR(64) DEFAULT 'LiFi',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_token_swap_account ON token_swap_records(account_id);

-- ======================================================================================
-- 25. Fiat Deposit Sessions (Cards/ACH Onramp & Institutional Wire Funding Tracking)
-- ======================================================================================
CREATE TABLE IF NOT EXISTS fiat_deposit_sessions (
    session_id VARCHAR(64) PRIMARY KEY,
    account_id VARCHAR(64) NOT NULL,
    method VARCHAR(32) NOT NULL, -- 'CARD_ONRAMP', 'FEDWIRE', 'ACH', 'SWIFT'
    amount_usdc NUMERIC(18, 6) NOT NULL,
    tracking_memo VARCHAR(128) NOT NULL,
    checkout_url TEXT,
    cli_command TEXT,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'CONFIRMED', 'EXPIRED'
    created_at TIMESTAMPTZ DEFAULT NOW(),
    confirmed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_fiat_deposit_account ON fiat_deposit_sessions(account_id);
CREATE INDEX IF NOT EXISTS idx_fiat_deposit_memo ON fiat_deposit_sessions(tracking_memo);

-- ======================================================================================
-- 26. Unified Payment Rails & Sub-Methods Extension (Fedwire, ACH, Push-to-Card, SEPA, SWIFT)
-- ======================================================================================
ALTER TABLE vendor_bank_accounts
    ADD COLUMN IF NOT EXISTS payment_sub_method VARCHAR(32) DEFAULT 'FEDWIRE',
    ADD COLUMN IF NOT EXISTS card_last4 VARCHAR(4),
    ADD COLUMN IF NOT EXISTS card_token VARCHAR(128),
    ADD COLUMN IF NOT EXISTS card_network VARCHAR(32);

CREATE INDEX IF NOT EXISTS idx_vendor_bank_method ON vendor_bank_accounts(payment_sub_method);

ALTER TABLE fiat_payout_records
    ADD COLUMN IF NOT EXISTS sub_method VARCHAR(32) DEFAULT 'FEDWIRE',
    ADD COLUMN IF NOT EXISTS card_payout_ref VARCHAR(128),
    ADD COLUMN IF NOT EXISTS imad_omad_trace VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_fiat_payout_sub_method ON fiat_payout_records(sub_method);

ALTER TABLE account_liabilities
    ALTER COLUMN payout_address DROP NOT NULL;

ALTER TABLE account_liabilities
    ADD COLUMN IF NOT EXISTS payment_sub_method VARCHAR(32);

CREATE INDEX IF NOT EXISTS idx_liabilities_sub_method ON account_liabilities(payment_sub_method);

-- 27. Vendor Payment Preferences Registry (Multi-Modal Crypto & Fiat Routing)
CREATE TABLE IF NOT EXISTS vendor_payment_preferences (
    preference_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vendor_id VARCHAR(64) NOT NULL UNIQUE,
    preferred_rail VARCHAR(32) NOT NULL DEFAULT 'DISBURSAL_VAULT',
    preferred_sub_method VARCHAR(32),
    crypto_wallet_address VARCHAR(66),
    crypto_chain_id INTEGER DEFAULT 5042,
    crypto_token_symbol VARCHAR(16) DEFAULT 'USDC',
    bank_account_id UUID REFERENCES vendor_bank_accounts(bank_account_id) ON DELETE SET NULL,
    service_endpoint_url TEXT,
    session_key_id VARCHAR(64),
    configuration_payload JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendor_pref_vendor ON vendor_payment_preferences(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vendor_pref_rail ON vendor_payment_preferences(preferred_rail);

ALTER TABLE fiat_deposit_sessions
    ADD COLUMN IF NOT EXISTS source_chain VARCHAR(32),
    ADD COLUMN IF NOT EXISTS source_token VARCHAR(64);
