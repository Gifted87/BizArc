-- Migration 008: Governance State, Idempotency Records, SIWE Nonces, Account Locks, Discovery Jobs

CREATE TABLE IF NOT EXISTS system_governance_state (
    id VARCHAR(32) PRIMARY KEY DEFAULT 'default',
    circuit_breaker_active BOOLEAN NOT NULL DEFAULT FALSE,
    emergency_reason TEXT,
    emergency_triggered_at TIMESTAMPTZ,
    active_vault_override VARCHAR(42),
    is_vault_allowlisted BOOLEAN NOT NULL DEFAULT FALSE,
    dynamic_policy JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO system_governance_state (id, circuit_breaker_active, is_vault_allowlisted)
VALUES ('default', FALSE, FALSE)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS idempotency_records (
    idempotency_key VARCHAR(128) PRIMARY KEY,
    rail VARCHAR(64),
    actor_agent VARCHAR(64),
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    response_payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_idempotency_records_created ON idempotency_records(created_at);

CREATE TABLE IF NOT EXISTS siwe_nonces (
    address VARCHAR(42) PRIMARY KEY,
    nonce VARCHAR(64) NOT NULL,
    message TEXT NOT NULL,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS account_locks (
    account_id VARCHAR(128) PRIMARY KEY,
    locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    reason TEXT
);

CREATE TABLE IF NOT EXISTS discovery_jobs (
    job_id VARCHAR(64) PRIMARY KEY,
    company_id VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'PENDING',
    progress INT NOT NULL DEFAULT 0,
    current_step VARCHAR(128),
    result JSONB,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
