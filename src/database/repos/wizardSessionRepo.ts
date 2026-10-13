import { DbClient } from "../dbClient.js";

export interface WizardSessionRecord {
  session_id: string;
  company_id: string;
  current_step: number;
  total_steps: number;
  entry_path: "MANUAL" | "GOOGLE_WORKSPACE" | "MICROSOFT_365" | "ODOO" | "ERPNEXT";
  draft_payload: Record<string, any>;
  completed_steps: number[];
  status: "IN_PROGRESS" | "DRAFT_READY" | "COMPLETED" | "ABANDONED";
  created_at?: Date;
  updated_at?: Date;
}

export class WizardSessionRepo {
  public static async createSession(params: {
    sessionId: string;
    companyId: string;
    entryPath: "MANUAL" | "GOOGLE_WORKSPACE" | "MICROSOFT_365" | "ODOO" | "ERPNEXT";
    totalSteps?: number;
    initialDraft?: Record<string, any>;
  }): Promise<WizardSessionRecord> {
    const text = `
      INSERT INTO onboarding_wizard_sessions (
        session_id, company_id, current_step, total_steps, entry_path, draft_payload, completed_steps, status
      ) VALUES ($1, $2, 1, $3, $4, $5, '[]'::jsonb, 'IN_PROGRESS')
      RETURNING *;
    `;
    const values = [
      params.sessionId,
      params.companyId,
      params.totalSteps || 6,
      params.entryPath,
      JSON.stringify(params.initialDraft || {}),
    ];
    const res = await DbClient.query<WizardSessionRecord>(text, values);
    return res.rows[0];
  }

  public static async getSession(sessionId: string): Promise<WizardSessionRecord | null> {
    const text = `SELECT * FROM onboarding_wizard_sessions WHERE session_id = $1 LIMIT 1;`;
    const res = await DbClient.query<WizardSessionRecord>(text, [sessionId]);
    return res.rows.length > 0 ? res.rows[0] : null;
  }

  public static async updateStepDraft(params: {
    sessionId: string;
    currentStep: number;
    draftPayload: Record<string, any>;
    completedStep?: number;
    status?: "IN_PROGRESS" | "DRAFT_READY" | "COMPLETED" | "ABANDONED";
  }): Promise<WizardSessionRecord> {
    // If completedStep is passed, add it to completed_steps array if not already present
    let updateCompletedStepsClause = "";
    const values: any[] = [params.sessionId, params.currentStep, JSON.stringify(params.draftPayload)];
    
    if (params.completedStep !== undefined) {
      values.push(params.completedStep);
      updateCompletedStepsClause = `, completed_steps = (
        SELECT jsonb_agg(DISTINCT elem)
        FROM jsonb_array_elements(completed_steps || jsonb_build_array($${values.length}::int)) elem
      )`;
    }

    let statusClause = "";
    if (params.status) {
      values.push(params.status);
      statusClause = `, status = $${values.length}`;
    }

    const text = `
      UPDATE onboarding_wizard_sessions
      SET current_step = $2,
          draft_payload = $3,
          updated_at = NOW()
          ${updateCompletedStepsClause}
          ${statusClause}
      WHERE session_id = $1
      RETURNING *;
    `;

    const res = await DbClient.query<WizardSessionRecord>(text, values);
    if (res.rows.length === 0) {
      throw new Error(`Wizard session '${params.sessionId}' not found.`);
    }
    return res.rows[0];
  }

  public static async updateStatus(
    sessionId: string,
    status: "IN_PROGRESS" | "DRAFT_READY" | "COMPLETED" | "ABANDONED"
  ): Promise<WizardSessionRecord> {
    const text = `
      UPDATE onboarding_wizard_sessions
      SET status = $2, updated_at = NOW()
      WHERE session_id = $1
      RETURNING *;
    `;
    const res = await DbClient.query<WizardSessionRecord>(text, [sessionId, status]);
    if (res.rows.length === 0) {
      throw new Error(`Wizard session '${sessionId}' not found.`);
    }
    return res.rows[0];
  }

  public static async getSessionsByCompany(companyId: string): Promise<WizardSessionRecord[]> {
    const text = `
      SELECT * FROM onboarding_wizard_sessions
      WHERE company_id = $1
      ORDER BY created_at DESC;
    `;
    const res = await DbClient.query<WizardSessionRecord>(text, [companyId]);
    return res.rows;
  }
}
