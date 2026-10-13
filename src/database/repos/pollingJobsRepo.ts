import { DbClient } from "../dbClient.js";

export interface PollingJobRecord {
  job_id: string;
  company_id: string;
  app_type: string;
  polling_frequency_cron: string;
  interval_seconds: number;
  last_polled_at: Date | null;
  next_poll_at: Date;
  status: "IDLE" | "RUNNING" | "FAILED";
  last_discovered_count: number;
  last_error: string | null;
  created_at?: Date;
  updated_at?: Date;
}

export class PollingJobsRepo {
  public static async upsertJob(job: {
    company_id: string;
    app_type: string;
    polling_frequency_cron?: string;
    interval_seconds?: number;
    next_poll_at?: Date;
  }): Promise<PollingJobRecord> {
    const text = `
      INSERT INTO external_app_polling_jobs (
        company_id, app_type, polling_frequency_cron, interval_seconds, next_poll_at
      ) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (company_id, app_type) DO UPDATE SET
        polling_frequency_cron = COALESCE(EXCLUDED.polling_frequency_cron, external_app_polling_jobs.polling_frequency_cron),
        interval_seconds = COALESCE(EXCLUDED.interval_seconds, external_app_polling_jobs.interval_seconds),
        updated_at = NOW()
      RETURNING *;
    `;
    const values = [
      job.company_id,
      job.app_type,
      job.polling_frequency_cron || "0 */6 * * *",
      job.interval_seconds || 21600, // 6 hours
      job.next_poll_at || new Date(),
    ];
    const res = await DbClient.query<PollingJobRecord>(text, values);
    return res.rows[0];
  }

  public static async getDueJobs(limit = 10): Promise<PollingJobRecord[]> {
    const text = `
      SELECT * FROM external_app_polling_jobs
      WHERE next_poll_at <= NOW() AND status != 'RUNNING'
      ORDER BY next_poll_at ASC
      LIMIT $1;
    `;
    const res = await DbClient.query<PollingJobRecord>(text, [limit]);
    return res.rows;
  }

  public static async markJobRunning(jobId: string): Promise<void> {
    const text = `
      UPDATE external_app_polling_jobs
      SET status = 'RUNNING', updated_at = NOW()
      WHERE job_id = $1;
    `;
    await DbClient.query(text, [jobId]);
  }

  public static async completeJob(
    jobId: string,
    discoveredCount: number,
    nextPollAt: Date
  ): Promise<void> {
    const text = `
      UPDATE external_app_polling_jobs
      SET status = 'IDLE',
          last_polled_at = NOW(),
          next_poll_at = $2,
          last_discovered_count = $3,
          last_error = NULL,
          updated_at = NOW()
      WHERE job_id = $1;
    `;
    await DbClient.query(text, [jobId, nextPollAt, discoveredCount]);
  }

  public static async failJob(
    jobId: string,
    errorMessage: string,
    nextPollAt: Date
  ): Promise<void> {
    const text = `
      UPDATE external_app_polling_jobs
      SET status = 'FAILED',
          last_polled_at = NOW(),
          next_poll_at = $2,
          last_error = $3,
          updated_at = NOW()
      WHERE job_id = $1;
    `;
    await DbClient.query(text, [jobId, nextPollAt, errorMessage]);
  }

  public static async getJobsByCompany(companyId: string): Promise<PollingJobRecord[]> {
    const text = `
      SELECT * FROM external_app_polling_jobs
      WHERE company_id = $1
      ORDER BY created_at ASC;
    `;
    const res = await DbClient.query<PollingJobRecord>(text, [companyId]);
    return res.rows;
  }
}
