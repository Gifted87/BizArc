-- Migration 007: Unified Fiat & Crypto Payment Settings, Sub-Rails, and Account Funding

-- 1. Extend vendor_bank_accounts for Push-to-Card and multi-fiat sub-methods
ALTER TABLE vendor_bank_accounts
    ADD COLUMN IF NOT EXISTS payment_sub_method VARCHAR(32) DEFAULT 'FEDWIRE',
    ADD COLUMN IF NOT EXISTS card_last4 VARCHAR(4),
    ADD COLUMN IF NOT EXISTS card_token VARCHAR(128),
    ADD COLUMN IF NOT EXISTS card_network VARCHAR(32);

CREATE INDEX IF NOT EXISTS idx_vendor_bank_method ON vendor_bank_accounts(payment_sub_method);

-- 2. Extend fiat_payout_records for sub-methods and card trace identifiers
ALTER TABLE fiat_payout_records
    ADD COLUMN IF NOT EXISTS sub_method VARCHAR(32) DEFAULT 'FEDWIRE',
    ADD COLUMN IF NOT EXISTS card_payout_ref VARCHAR(128),
    ADD COLUMN IF NOT EXISTS imad_omad_trace VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_fiat_payout_sub_method ON fiat_payout_records(sub_method);

-- 3. Extend account_liabilities to support flexible payment rails and sub-methods
ALTER TABLE account_liabilities
    ALTER COLUMN payout_address DROP NOT NULL;

ALTER TABLE account_liabilities
    ADD COLUMN IF NOT EXISTS payment_sub_method VARCHAR(32);

CREATE INDEX IF NOT EXISTS idx_liabilities_sub_method ON account_liabilities(payment_sub_method);

-- 4. Create Vendor Payment Preferences Registry
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

-- 5. Extend fiat_deposit_sessions for multi-chain and multi-rail funding
ALTER TABLE fiat_deposit_sessions
    ADD COLUMN IF NOT EXISTS source_chain VARCHAR(32),
    ADD COLUMN IF NOT EXISTS source_token VARCHAR(64);
