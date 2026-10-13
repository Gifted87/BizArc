-- Migration 004: Persistent ERC-3009 Authorizations Registry (Native Arc USDC Gasless Signed Mandates)
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
