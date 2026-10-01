import { BaseLlmAgent } from "./core/BaseLlmAgent.js";

export class LiabilityRadarLlmAgent extends BaseLlmAgent {
  constructor(deps?: Partial<ConstructorParameters<typeof BaseLlmAgent>[0]>) {
    super({
      agentId: 102,
      agentName: "LiabilityRadarAgent",
      systemInstruction: `You are the LiabilityRadarAgent (ID #102) in the BizArc Autonomous Treasury Swarm.
Your primary mandate is Golden Rule 2 & Golden Rule 3:
1. Detect and verify incoming vendor demands, invoices, and debt obligations.
2. ALWAYS execute a strict 3-Way Match comparing:
   - Purchase Order (PO) authorized terms and amounts from Vector Memory.
   - Delivery / Telemetry Receipt proofs.
   - Incoming Vendor Invoice demands.
3. PREVENT PAYEE SUBSTITUTION (Golden Rule 3): Verify that invoice payout addresses match the immutable Vendor Master Registry. Never trust payout addresses written on unverified invoice headers.
4. REFUSE SILENT ROUNDING (Golden Rule 5): All amounts must be exact 6-decimal USDC.
5. Update Dynamic Record 1 (Active Liabilities) upon successful verification.`,
      allowedTools: [
        "query_vector_memory",
        "verify_three_way_match",
        "check_vendor_master",
        "read_dynamic_records",
      ],
      ...deps,
    });
  }

  /**
   * Autonomous LLM Ingestion & Forensic Verification of an incoming Invoice.
   * Runs the ReAct deliberation loop through the model-agnostic LLM engine.
   */
  public async ingestAndVerifyInvoice(
    sessionId: string,
    invoice: {
      accountId: string;
      vendorId: string;
      invoiceId: string;
      amountUsdc: string;
      claimedPayoutAddress: string;
      poReference: string;
    }
  ) {
    const task = `Perform forensic verification and 3-way match on incoming invoice ${invoice.invoiceId} from vendor ${invoice.vendorId} for ${invoice.amountUsdc} USDC on PO ${invoice.poReference} with claimed payout address ${invoice.claimedPayoutAddress}. Verify payee substitution against Vendor Master. If valid, update Dynamic Record 1 for account ${invoice.accountId}. If payee substitution or price mismatch is detected, reject and alert compliance.`;
    return this.executeTask(sessionId, task, invoice);
  }
}

export { LiabilityRadarLlmAgent as LiabilityRadarAgent };
