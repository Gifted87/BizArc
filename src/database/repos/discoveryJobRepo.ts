import { DbClient } from "../dbClient.js";

export interface DiscoveryJobRecord {
  job_id: string;
  company_id: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  progress: number;
  current_step: string | null;
  result: any;
  error: string | null;
  created_at: Date;
  updated_at: Date;
}

export class DiscoveryJobRepo {
  public static async createJob(job: {
    jobId: string;
    companyId: string;
    status?: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
    progress?: number;
    currentStep?: string;
  }): Promise<DiscoveryJobRecord> {
    const text = `
      INSERT INTO discovery_jobs (
        job_id, company_id, status, progress, current_step, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      RETURNING *;
    `;
    const res = await DbClient.query(text, [
      job.jobId,
      job.companyId,
      job.status || "PENDING",
      job.progress || 0,
      job.currentStep || null,
    ]);
    return res.rows[0];
  }

  public static async getJob(jobId: string): Promise<DiscoveryJobRecord | null> {
    const text = `
      SELECT * FROM discovery_jobs
      WHERE job_id = $1
      LIMIT 1;
    `;
    const res = await DbClient.query(text, [jobId]);
    return res.rows.length > 0 ? res.rows[0] : null;
  }

  public static async updateJob(
    jobId: string,
    updates: Partial<{
      status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
      progress: number;
      currentStep: string;
      result: any;
      error: string;
    }>
  ): Promise<void> {
    const fields: string[] = ["updated_at = NOW()"];
    const values: any[] = [jobId];
    let idx = 2;

    if (updates.status !== undefined) {
      fields.push(`status = $${idx++}`);
      values.push(updates.status);
    }
    if (updates.progress !== undefined) {
      fields.push(`progress = $${idx++}`);
      values.push(updates.progress);
    }
    if (updates.currentStep !== undefined) {
      fields.push(`current_step = $${idx++}`);
      values.push(updates.currentStep);
    }
    if (updates.result !== undefined) {
      fields.push(`result = $${idx++}`);
      values.push(JSON.stringify(updates.result));
    }
    if (updates.error !== undefined) {
      fields.push(`error = $${idx++}`);
      values.push(updates.error);
    }

    const text = `
      UPDATE discovery_jobs
      SET ${fields.join(", ")}
      WHERE job_id = $1;
    `;
    await DbClient.query(text, values);
  }
}
