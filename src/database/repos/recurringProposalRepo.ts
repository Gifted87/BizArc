import { DbClient } from "../dbClient.js";
import { DynamicRecordsService } from "../../records/dynamicRecordsService.js";

export interface RecurringLiabilityProposalRecord {
  proposal_id: string;
  action_type: "ADD" | "EDIT" | "REMOVE";
  liability_id?: string;
  account_id: string;
  vendor_id: string;
  proposed_by: "HUMAN" | string; // e.g. 'LiabilityRadarAgent', 'HUMAN'
  details: {
    title: string;
    category?: string;
    amountUsdc: string;
    payoutAddress: string;
    frequencyCron: string;
    dueDateIso: string;
    poReference?: string;
    documentHash?: string;
    rationale?: string;
  };
  status: "PENDING_HUMAN_APPROVAL" | "APPROVED" | "REJECTED";
  sprs_request_id?: string;
  created_at?: Date;
  updated_at?: Date;
}

export class RecurringProposalRepo {
  /**
   * Submits a proposed recurring liability change.
   * If submitted by an AGENT, it defaults to PENDING_HUMAN_APPROVAL (Human Gate invariant).
   * If submitted directly by a verified HUMAN, it can be auto-committed or staged.
   */
  public static async submitProposal(params: {
    actionType: "ADD" | "EDIT" | "REMOVE";
    liabilityId?: string;
    accountId: string;
    vendorId: string;
    proposedBy: string;
    details: RecurringLiabilityProposalRecord["details"];
    isHumanInitiated?: boolean;
  }): Promise<RecurringLiabilityProposalRecord> {
    const proposalId = `PROP_REC_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const status: RecurringLiabilityProposalRecord["status"] = params.isHumanInitiated
      ? "APPROVED"
      : "PENDING_HUMAN_APPROVAL";

    const text = `
      INSERT INTO recurring_liability_proposals (
        proposal_id, action_type, liability_id, account_id,
        vendor_id, proposed_by, details, status, sprs_request_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *;
    `;
    const values = [
      proposalId,
      params.actionType,
      params.liabilityId || null,
      params.accountId,
      params.vendorId,
      params.proposedBy,
      JSON.stringify(params.details),
      status,
      params.isHumanInitiated ? null : `SPRS_${proposalId}`,
    ];

    const result = await DbClient.query<RecurringLiabilityProposalRecord>(text, values);
    const proposal = result.rows[0];

    // If human-initiated and approved, immediately enact on Dynamic Record 1
    if (status === "APPROVED") {
      await this.enactProposal(proposal);
    }

    return proposal;
  }

  public static async getProposalById(proposalId: string): Promise<RecurringLiabilityProposalRecord | null> {
    const text = `SELECT * FROM recurring_liability_proposals WHERE proposal_id = $1 LIMIT 1;`;
    const res = await DbClient.query<RecurringLiabilityProposalRecord>(text, [proposalId]);
    if (res.rows.length === 0) return null;
    return res.rows[0];
  }

  public static async getPendingProposals(): Promise<RecurringLiabilityProposalRecord[]> {
    const text = `SELECT * FROM recurring_liability_proposals WHERE status = 'PENDING_HUMAN_APPROVAL' ORDER BY created_at ASC;`;
    const res = await DbClient.query<RecurringLiabilityProposalRecord>(text);
    return res.rows;
  }

  /**
   * Human Approval of an Agent's Proposal.
   * Ratifies the addition, modification, or cancellation of the recurring liability.
   */
  public static async approveProposal(
    proposalId: string,
    adminInstruction?: string
  ): Promise<RecurringLiabilityProposalRecord> {
    const text = `
      UPDATE recurring_liability_proposals
      SET status = 'APPROVED', updated_at = NOW()
      WHERE proposal_id = $1
      RETURNING *;
    `;
    const res = await DbClient.query<RecurringLiabilityProposalRecord>(text, [proposalId]);
    if (res.rows.length === 0) {
      throw new Error(`Proposal '${proposalId}' not found.`);
    }

    const proposal = res.rows[0];
    await this.enactProposal(proposal);
    return proposal;
  }

  public static async rejectProposal(
    proposalId: string,
    adminInstruction?: string
  ): Promise<RecurringLiabilityProposalRecord> {
    const text = `
      UPDATE recurring_liability_proposals
      SET status = 'REJECTED', updated_at = NOW()
      WHERE proposal_id = $1
      RETURNING *;
    `;
    const res = await DbClient.query<RecurringLiabilityProposalRecord>(text, [proposalId]);
    if (res.rows.length === 0) {
      throw new Error(`Proposal '${proposalId}' not found.`);
    }
    return res.rows[0];
  }

  /**
   * Enacts an approved recurring liability proposal directly into account_liabilities
   */
  private static async enactProposal(proposal: RecurringLiabilityProposalRecord): Promise<void> {
    const dynamicRecords = new DynamicRecordsService();
    const d = typeof proposal.details === "string" ? JSON.parse(proposal.details) : proposal.details;

    if (proposal.action_type === "ADD") {
      await dynamicRecords.upsertLiability({
        accountId: proposal.account_id,
        vendorId: proposal.vendor_id,
        title: d.title,
        category: d.category || "SUBSCRIPTION",
        amountUsdc: d.amountUsdc,
        payoutAddress: d.payoutAddress,
        dueDate: new Date(d.dueDateIso),
        frequency: d.frequencyCron as any,
        documentHash: d.documentHash || "DOC_PROPOSED_0x0",
        poReference: d.poReference,
        status: "SCHEDULED",
      });
    } else if (proposal.action_type === "EDIT" && proposal.liability_id) {
      await DbClient.query(
        `UPDATE account_liabilities 
         SET amount_usdc = $1, due_date = $2, frequency_cron = $3, updated_at = NOW() 
         WHERE liability_id = $4;`,
        [d.amountUsdc, new Date(d.dueDateIso).toISOString(), d.frequencyCron, proposal.liability_id]
      );
    } else if (proposal.action_type === "REMOVE" && proposal.liability_id) {
      await dynamicRecords.updateLiabilityStatus(proposal.liability_id, "CANCELLED" as any);
    }
  }
}
