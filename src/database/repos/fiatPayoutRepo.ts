import { DbClient } from "../dbClient.js";

export interface FiatPayoutRecord {
  payout_id: string;
  account_id: string;
  company_id?: string;
  vendor_id: string;
  amount_usdc: number;
  fee_usdc: number;
  status: "INITIATED" | "PROCESSING" | "SETTLED" | "FAILED" | "ESCALATED";
  beneficiary_bank_id?: string | null;
  circle_payout_ref?: string | null;
  burn_tx_hash?: string | null;
  sprs_request_id?: string | null;
  invoice_ref?: string | null;
  estimated_arrival?: Date | null;
  sub_method?: "FEDWIRE" | "ACH" | "PUSH_TO_CARD" | "SEPA" | "SWIFT" | string;
  card_payout_ref?: string | null;
  imad_omad_trace?: string | null;
  created_at: Date;
  settled_at?: Date | null;
}

export class FiatPayoutRepo {
  public static async createPayoutRecord(params: {
    payout_id: string;
    account_id: string;
    company_id?: string;
    vendor_id: string;
    amount_usdc: number;
    fee_usdc?: number;
    status?: "INITIATED" | "PROCESSING" | "SETTLED" | "FAILED" | "ESCALATED";
    beneficiary_bank_id?: string | null;
    circle_payout_ref?: string | null;
    burn_tx_hash?: string | null;
    sprs_request_id?: string | null;
    invoice_ref?: string | null;
    estimated_arrival?: Date | null;
    sub_method?: string;
    card_payout_ref?: string | null;
    imad_omad_trace?: string | null;
  }): Promise<FiatPayoutRecord> {
    const companyId = params.company_id || "default_org";
    const query = `
      INSERT INTO fiat_payout_records (
        payout_id, account_id, company_id, vendor_id, amount_usdc, fee_usdc,
        status, beneficiary_bank_id, circle_payout_ref, burn_tx_hash,
        sprs_request_id, invoice_ref, estimated_arrival,
        sub_method, card_payout_ref, imad_omad_trace
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *;
    `;

    const values = [
      params.payout_id,
      params.account_id,
      companyId,
      params.vendor_id,
      params.amount_usdc,
      params.fee_usdc ?? 0.0,
      params.status || "INITIATED",
      params.beneficiary_bank_id || null,
      params.circle_payout_ref || null,
      params.burn_tx_hash || null,
      params.sprs_request_id || null,
      params.invoice_ref || null,
      params.estimated_arrival || null,
      params.sub_method || "FEDWIRE",
      params.card_payout_ref || null,
      params.imad_omad_trace || null,
    ];

    const res = await DbClient.query(query, values);
    return res.rows[0];
  }

  public static async getPayoutById(payoutId: string): Promise<FiatPayoutRecord | null> {
    const res = await DbClient.query(`SELECT * FROM fiat_payout_records WHERE payout_id = $1;`, [payoutId]);
    return res.rows[0] || null;
  }

  public static async getPayoutsByAccount(accountId: string): Promise<FiatPayoutRecord[]> {
    const res = await DbClient.query(
      `SELECT * FROM fiat_payout_records WHERE account_id = $1 ORDER BY created_at DESC;`,
      [accountId]
    );
    return res.rows;
  }

  public static async getPayoutsByCompany(companyId: string, limit = 50): Promise<FiatPayoutRecord[]> {
    const res = await DbClient.query(
      `SELECT * FROM fiat_payout_records WHERE company_id = $1 ORDER BY created_at DESC LIMIT $2;`,
      [companyId, limit]
    );
    return res.rows;
  }

  public static async updatePayoutStatus(
    payoutId: string,
    status: "INITIATED" | "PROCESSING" | "SETTLED" | "FAILED" | "ESCALATED",
    details?: {
      burn_tx_hash?: string;
      circle_payout_ref?: string;
      settled_at?: Date;
    }
  ): Promise<FiatPayoutRecord | null> {
    const query = `
      UPDATE fiat_payout_records
      SET
        status = $2,
        burn_tx_hash = COALESCE($3, burn_tx_hash),
        circle_payout_ref = COALESCE($4, circle_payout_ref),
        settled_at = COALESCE($5, settled_at)
      WHERE payout_id = $1
      RETURNING *;
    `;
    const res = await DbClient.query(query, [
      payoutId,
      status,
      details?.burn_tx_hash || null,
      details?.circle_payout_ref || null,
      details?.settled_at || null,
    ]);
    return res.rows[0] || null;
  }

  public static async confirmPayoutSettlement(payoutId: string, settledAt = new Date()): Promise<FiatPayoutRecord | null> {
    return this.updatePayoutStatus(payoutId, "SETTLED", { settled_at: settledAt });
  }
}
