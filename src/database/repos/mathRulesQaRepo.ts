import { DbClient } from "../dbClient.js";

export interface MathRuleQaResponseRecord {
  response_id?: string;
  company_id: string;
  account_id?: string | null;
  liability_id?: string | null;
  category: "GENERAL_MATH" | "ACCOUNT_MATH" | "LIABILITY_MATH" | "INVESTMENT_MATH" | string;
  question_id: string;
  question_text: string;
  user_answer: string;
  derived_parameter_name: string;
  derived_value: number;
  created_at?: Date;
}

export class MathRulesQaRepo {
  public static async recordResponse(
    response: MathRuleQaResponseRecord
  ): Promise<MathRuleQaResponseRecord> {
    const text = `
      INSERT INTO math_rules_qa_responses (
        company_id, account_id, liability_id, category,
        question_id, question_text, user_answer,
        derived_parameter_name, derived_value
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *;
    `;
    const values = [
      response.company_id,
      response.account_id || null,
      response.liability_id || null,
      response.category,
      response.question_id,
      response.question_text,
      String(response.user_answer),
      response.derived_parameter_name,
      response.derived_value,
    ];

    const res = await DbClient.query<MathRuleQaResponseRecord>(text, values);
    const row = res.rows[0];
    return {
      ...row,
      derived_value: Number(row.derived_value),
    };
  }

  public static async recordBatch(
    responses: MathRuleQaResponseRecord[]
  ): Promise<MathRuleQaResponseRecord[]> {
    if (responses.length === 0) return [];
    
    return DbClient.withTransaction(async (client) => {
      const records: MathRuleQaResponseRecord[] = [];
      for (const resp of responses) {
        const text = `
          INSERT INTO math_rules_qa_responses (
            company_id, account_id, liability_id, category,
            question_id, question_text, user_answer,
            derived_parameter_name, derived_value
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING *;
        `;
        const values = [
          resp.company_id,
          resp.account_id || null,
          resp.liability_id || null,
          resp.category,
          resp.question_id,
          resp.question_text,
          String(resp.user_answer),
          resp.derived_parameter_name,
          resp.derived_value,
        ];
        const res = await client.query(text, values);
        const row = res.rows[0];
        records.push({
          ...row,
          derived_value: Number(row.derived_value),
        });
      }
      return records;
    });
  }

  public static async getResponsesByCompany(companyId: string): Promise<MathRuleQaResponseRecord[]> {
    const text = `
      SELECT * FROM math_rules_qa_responses
      WHERE company_id = $1
      ORDER BY created_at ASC;
    `;
    const res = await DbClient.query<MathRuleQaResponseRecord>(text, [companyId]);
    return res.rows.map((row) => ({
      ...row,
      derived_value: Number(row.derived_value),
    }));
  }

  public static async getResponsesByCategory(
    companyId: string,
    category: string
  ): Promise<MathRuleQaResponseRecord[]> {
    const text = `
      SELECT * FROM math_rules_qa_responses
      WHERE company_id = $1 AND category = $2
      ORDER BY created_at ASC;
    `;
    const res = await DbClient.query<MathRuleQaResponseRecord>(text, [companyId, category]);
    return res.rows.map((row) => ({
      ...row,
      derived_value: Number(row.derived_value),
    }));
  }

  public static async getResponsesForAccount(
    companyId: string,
    accountId: string
  ): Promise<MathRuleQaResponseRecord[]> {
    const text = `
      SELECT * FROM math_rules_qa_responses
      WHERE company_id = $1 AND account_id = $2
      ORDER BY created_at ASC;
    `;
    const res = await DbClient.query<MathRuleQaResponseRecord>(text, [companyId, accountId]);
    return res.rows.map((row) => ({
      ...row,
      derived_value: Number(row.derived_value),
    }));
  }

  public static async getResponsesForLiability(
    companyId: string,
    liabilityId: string
  ): Promise<MathRuleQaResponseRecord[]> {
    const text = `
      SELECT * FROM math_rules_qa_responses
      WHERE company_id = $1 AND liability_id = $2
      ORDER BY created_at ASC;
    `;
    const res = await DbClient.query<MathRuleQaResponseRecord>(text, [companyId, liabilityId]);
    return res.rows.map((row) => ({
      ...row,
      derived_value: Number(row.derived_value),
    }));
  }
}
