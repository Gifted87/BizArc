import crypto from "node:crypto";
import { DbClient } from "../dbClient.js";

export interface ClearanceCodeRecord {
  code: string;
  account_id: string;
  action_type: string;
  amount_usdc: string;
  issued_at: Date;
  expires_at: Date;
  is_consumed: boolean;
  consumed_at?: Date | null;
  recipient_address?: string | null;
}

export interface IssueClearanceCodeParams {
  accountId: string;
  actionType: string;
  amountUsdc: number | string;
  ttlSeconds?: number;
  recipientAddress?: string;
  customCodePrefix?: string;
}

export interface ValidateClearanceCodeParams {
  code: string;
  accountId: string;
  actionType: string;
  amountUsdc: number | string;
}

export interface ValidationResult {
  isValid: boolean;
  reason?: string;
  record?: ClearanceCodeRecord;
}

export class ClearanceCodeRepo {
  /**
   * Helper to ensure the compliance_clearance_codes table exists
   */
  public static async ensureTableExists(): Promise<void> {
    const ddl = `
      CREATE TABLE IF NOT EXISTS compliance_clearance_codes (
          code VARCHAR(64) PRIMARY KEY,
          account_id VARCHAR(64) NOT NULL,
          action_type VARCHAR(64) NOT NULL,
          amount_usdc NUMERIC(18, 6) NOT NULL,
          issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          expires_at TIMESTAMPTZ NOT NULL,
          is_consumed BOOLEAN NOT NULL DEFAULT FALSE,
          consumed_at TIMESTAMPTZ,
          recipient_address VARCHAR(42)
      );
      CREATE INDEX IF NOT EXISTS idx_clearance_code_status ON compliance_clearance_codes(is_consumed, expires_at);
      CREATE INDEX IF NOT EXISTS idx_clearance_code_account ON compliance_clearance_codes(account_id);
    `;
    await DbClient.query(ddl);
  }

  /**
   * Issues a cryptographically unique clearance code, binding it to the specific
   * account, action, amount, and expiration timestamp in PostgreSQL.
   */
  public static async issueCode(params: IssueClearanceCodeParams): Promise<ClearanceCodeRecord> {
    await this.ensureTableExists();

    const prefix = params.customCodePrefix || "CLEAR";
    const uniqueToken = crypto.randomBytes(4).toString("hex").toUpperCase();
    const code = `${prefix}-${Date.now()}-${uniqueToken}`;
    const ttlSeconds = params.ttlSeconds || 3600; // Default 1 hour TTL
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    const amountStr = typeof params.amountUsdc === "number"
      ? params.amountUsdc.toFixed(6)
      : parseFloat(params.amountUsdc).toFixed(6);

    const text = `
      INSERT INTO compliance_clearance_codes (
        code, account_id, action_type, amount_usdc,
        issued_at, expires_at, is_consumed, recipient_address
      ) VALUES ($1, $2, $3, $4, NOW(), $5, false, $6)
      RETURNING *;
    `;
    const values = [
      code,
      params.accountId,
      params.actionType,
      amountStr,
      expiresAt,
      params.recipientAddress || null,
    ];

    const result = await DbClient.query(text, values);
    return result.rows[0];
  }

  /**
   * Retrieves a clearance code record by primary key.
   */
  public static async getCode(code: string): Promise<ClearanceCodeRecord | null> {
    await this.ensureTableExists();
    const text = `SELECT * FROM compliance_clearance_codes WHERE code = $1 LIMIT 1;`;
    const result = await DbClient.query(text, [code]);
    if (result.rows.length === 0) return null;
    return result.rows[0];
  }

  /**
   * Normalizes action names to verify semantic alignment
   * e.g. AUTONOMOUS_SWEEP_TO_USYC == SWEEP_TO_USYC == SWEEP_EXCESS_LIQUIDITY
   */
  private static areActionsCompatible(issuedAction: string, requestedAction: string): boolean {
    if (issuedAction === requestedAction) return true;

    const norm = (s: string) =>
      s.toUpperCase()
        .replace(/^AUTONOMOUS_/, "")
        .replace(/^VENDOR_/, "")
        .replace(/_/g, "");

    const n1 = norm(issuedAction);
    const n2 = norm(requestedAction);

    if (n1 === n2) return true;
    if (n1.includes("SWEEP") && n2.includes("SWEEP")) return true;
    if (n1.includes("RECALL") && n2.includes("RECALL")) return true;
    if (n1.includes("DISBURSAL") && n2.includes("DISBURSAL")) return true;

    return false;
  }

  /**
   * Validates that the clearance code:
   * 1. Exists in database
   * 2. Has NOT been consumed (single-use invariant)
   * 3. Has NOT expired (temporal validity)
   * 4. Matches the target account
   * 5. Covers the requested amount (cap check)
   * 6. Matches the authorized action type
   */
  public static async validateCode(params: ValidateClearanceCodeParams): Promise<ValidationResult> {
    const record = await this.getCode(params.code);
    if (!record) {
      return {
        isValid: false,
        reason: `Clearance code '${params.code}' was never issued by Enforcer Agent or does not exist in ledger.`,
      };
    }

    if (record.is_consumed) {
      return {
        isValid: false,
        reason: `Clearance code '${params.code}' was already consumed at ${record.consumed_at}. Replay attack prevented.`,
        record,
      };
    }

    const now = new Date();
    if (now > new Date(record.expires_at)) {
      return {
        isValid: false,
        reason: `Clearance code '${params.code}' expired at ${record.expires_at}. Current time: ${now.toISOString()}.`,
        record,
      };
    }

    if (record.account_id !== params.accountId) {
      return {
        isValid: false,
        reason: `Clearance code account mismatch: issued for account '${record.account_id}', but presented for '${params.accountId}'.`,
        record,
      };
    }

    const issuedAmount = parseFloat(record.amount_usdc);
    const requestedAmount = typeof params.amountUsdc === "number"
      ? params.amountUsdc
      : parseFloat(params.amountUsdc);

    // Requested amount cannot exceed issued clearance amount (with 0.000001 epsilon for float rounding)
    if (requestedAmount > issuedAmount + 0.000001) {
      return {
        isValid: false,
        reason: `Clearance code amount exceeded: issued for ${issuedAmount} USDC, but requested for ${requestedAmount} USDC.`,
        record,
      };
    }

    if (!this.areActionsCompatible(record.action_type, params.actionType)) {
      return {
        isValid: false,
        reason: `Clearance code action mismatch: issued for '${record.action_type}', but requested for '${params.actionType}'.`,
        record,
      };
    }

    return {
      isValid: true,
      record,
    };
  }

  /**
   * Marks a clearance code as consumed (single-use enforcement).
   * Atomically flips is_consumed from false to true.
   */
  public static async consumeCode(code: string): Promise<boolean> {
    await this.ensureTableExists();
    const text = `
      UPDATE compliance_clearance_codes
      SET is_consumed = true,
          consumed_at = NOW()
      WHERE code = $1 AND is_consumed = false
      RETURNING *;
    `;
    const result = await DbClient.query(text, [code]);
    return result.rowCount !== null && result.rowCount > 0;
  }

  /**
   * Atomically validates and consumes the clearance code.
   */
  public static async validateAndConsumeCode(params: ValidateClearanceCodeParams): Promise<ValidationResult> {
    const validation = await this.validateCode(params);
    if (!validation.isValid) {
      return validation;
    }

    const consumed = await this.consumeCode(params.code);
    if (!consumed) {
      return {
        isValid: false,
        reason: `Failed to consume clearance code '${params.code}' (concurrent execution or already consumed).`,
        record: validation.record,
      };
    }

    return {
      isValid: true,
      record: validation.record,
    };
  }
}
