-- 006_autonomous_polling_scheduler.sql
-- Background Scheduler Jobs for External Apps & Recurring Liability Execution

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
