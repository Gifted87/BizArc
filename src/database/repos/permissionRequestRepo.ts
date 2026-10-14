import { DbClient } from "../dbClient.js";

export type PermissionRequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "EXECUTED" | "CANCELLED";

export interface PermissionRequestRecord {
  request_id: string;
  action_type: string;
  reason: string;
  amount_usdc: number;
  status: PermissionRequestStatus;
  admin_instruction?: string | null;
  payload: Record<string, any>;
  created_at?: Date;
  decided_at?: Date | null;
}

export class PermissionRequestRepo {
  public static async createRequest(
    request: PermissionRequestRecord
  ): Promise<PermissionRequestRecord> {
    const text = `
      INSERT INTO permission_requests (
        request_id, action_type, reason, amount_usdc,
        status, admin_instruction, payload
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *;
    `;
    const values = [
      request.request_id,
      request.action_type,
      request.reason,
      request.amount_usdc,
      request.status || "PENDING",
      request.admin_instruction || null,
      JSON.stringify(request.payload || {}),
    ];

    const result = await DbClient.query(text, values);
    const row = result.rows[0];
    return {
      ...row,
      amount_usdc: Number(row.amount_usdc),
    };
  }

  public static async getRequestById(
    requestId: string
  ): Promise<PermissionRequestRecord | null> {
    const text = `SELECT * FROM permission_requests WHERE request_id = $1 LIMIT 1;`;
    const result = await DbClient.query(text, [requestId]);
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
      ...row,
      amount_usdc: Number(row.amount_usdc),
    };
  }

  public static async getPendingRequests(): Promise<PermissionRequestRecord[]> {
    const text = `SELECT * FROM permission_requests WHERE status = 'PENDING' ORDER BY created_at ASC;`;
    const result = await DbClient.query(text);
    return result.rows.map((row) => ({
      ...row,
      amount_usdc: Number(row.amount_usdc),
    }));
  }

  public static async updateStatus(
    arg1: string | { requestId: string; status: PermissionRequestStatus; adminInstruction?: string },
    arg2?: PermissionRequestStatus,
    arg3?: string
  ): Promise<void> {
    let requestId: string;
    let status: PermissionRequestStatus;
    let adminInstruction: string | null = null;

    if (typeof arg1 === "object") {
      requestId = arg1.requestId;
      status = arg1.status;
      adminInstruction = arg1.adminInstruction || null;
    } else {
      requestId = arg1;
      status = arg2!;
      adminInstruction = arg3 || null;
    }

    const text = `
      UPDATE permission_requests
      SET status = $1,
          admin_instruction = COALESCE($2, admin_instruction),
          decided_at = NOW()
      WHERE request_id = $3;
    `;
    await DbClient.query(text, [
      status,
      adminInstruction,
      requestId,
    ]);
  }

  public static async getAllRequests(filters?: {
    status?: PermissionRequestStatus;
    companyId?: string;
    limit?: number;
  }): Promise<PermissionRequestRecord[]> {
    let text = `SELECT * FROM permission_requests`;
    const conditions: string[] = [];
    const values: any[] = [];

    if (filters?.status) {
      values.push(filters.status);
      conditions.push(`status = $${values.length}`);
    }

    if (filters?.companyId) {
      values.push(filters.companyId);
      conditions.push(`payload->>'companyId' = $${values.length}`);
    }

    if (conditions.length > 0) {
      text += ` WHERE ` + conditions.join(" AND ");
    }

    text += ` ORDER BY created_at DESC`;

    if (filters?.limit) {
      values.push(filters.limit);
      text += ` LIMIT $${values.length}`;
    }

    const result = await DbClient.query(text, values);
    return result.rows.map((row) => ({
      ...row,
      amount_usdc: Number(row.amount_usdc),
    }));
  }
}
