-- ======================================================================================
-- Migration 005: Multi-Tenant Onboarding, Dynamic Q&A Math Rules, and Tenant OAuth Store
-- ======================================================================================

-- 1. Onboarding Wizard Sessions Table
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

-- 2. Mathematical Rules Q&A Responses Audit Ledger
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

-- 3. Tenant OAuth Credentials Store (Production MCP & Integrations)
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

-- 4. Treasury Operating Accounts Schema Extensions
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

-- 5. Account Liabilities Schema Extensions
ALTER TABLE account_liabilities
    ADD COLUMN IF NOT EXISTS company_id VARCHAR(64) NOT NULL DEFAULT 'default_org',
    ADD COLUMN IF NOT EXISTS preferred_payment_rail VARCHAR(32) NOT NULL DEFAULT 'DISBURSAL_VAULT',
    ADD COLUMN IF NOT EXISTS payment_rail_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS disbursal_rules JSONB NOT NULL DEFAULT '{"autoPayThresholdUsdc": 500, "requireThreeWayMatch": true, "preFlightLeadTimeHours": 48}'::jsonb,
    ADD COLUMN IF NOT EXISTS waterfall_override JSONB DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_liabilities_company ON account_liabilities(company_id);
CREATE INDEX IF NOT EXISTS idx_liabilities_rail ON account_liabilities(preferred_payment_rail);

-- 6. Movement Policies Schema Extensions
ALTER TABLE movement_policies
    ADD COLUMN IF NOT EXISTS company_id VARCHAR(64) NOT NULL DEFAULT 'default_org';

CREATE INDEX IF NOT EXISTS idx_movement_company ON movement_policies(company_id);

-- 7. Master System Journal Multi-Tenant Tagging
ALTER TABLE master_system_journal
    ADD COLUMN IF NOT EXISTS company_id VARCHAR(64) NOT NULL DEFAULT 'default_org';

CREATE INDEX IF NOT EXISTS idx_journal_company ON master_system_journal(company_id);
