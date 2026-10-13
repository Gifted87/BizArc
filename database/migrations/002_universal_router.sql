-- Migration 002: Universal Payment Router, Movement Policy & Recurring Proposals
ALTER TABLE vendor_master_registry ADD COLUMN IF NOT EXISTS payout_rail VARCHAR(32) DEFAULT 'DISBURSAL_VAULT';
ALTER TABLE vendor_master_registry ADD COLUMN IF NOT EXISTS payment_endpoint_url TEXT;
ALTER TABLE vendor_master_registry ADD COLUMN IF NOT EXISTS rail_metadata JSONB DEFAULT '{}'::jsonb;

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
