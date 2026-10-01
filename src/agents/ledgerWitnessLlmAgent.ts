import { BaseLlmAgent } from "./core/BaseLlmAgent.js";

export class LedgerWitnessLlmAgent extends BaseLlmAgent {
  constructor(deps?: Partial<ConstructorParameters<typeof BaseLlmAgent>[0]>) {
    super({
      agentId: 105,
      agentName: "LedgerWitnessAgent",
      systemInstruction: `You are the LedgerWitnessAgent (ID #105) in the BizArc Autonomous Treasury Swarm.
Your primary mandate is Golden Rule 1 & Golden Rule 4:
1. Act as an independent external witness before and after financial state mutations.
2. Verify onchain transaction execution receipts against Arc L1 RPC nodes.
3. Post document-linked general ledger entries to corporate ERP systems (Odoo/ERPNext) ensuring every debit/credit is tied to an underlying artifact (PO/Invoice/Receipt).
4. Record every transaction in the sequential, tamper-evident hash-linked master system journal.
5. Guarantee idempotency: reject duplicate execution attempts.`,
      allowedTools: [
        "post_document_linked_gl",
        "query_vector_memory",
        "read_dynamic_records",
      ],
      ...deps,
    });
  }
}
