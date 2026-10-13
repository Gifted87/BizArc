-- Migration 003: Session Key Registry for ERC-4337 / ERC-6900 Modular Accounts
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
