import { DbClient } from "../database/dbClient.js";
import { ILlmEngine, createLlmEngine } from "../llm/llmEngine.js";
import { IngestDocumentInput, MemorySearchResult } from "./types.js";

export class VectorMemoryService {
  private llmEngine: ILlmEngine;

  constructor(llmEngine?: ILlmEngine) {
    this.llmEngine = llmEngine || createLlmEngine();
  }

  /**
   * Chunks and embeds an enterprise document, storing chunks in PostgreSQL pgvector.
   */
  public async ingestDocument(input: IngestDocumentInput): Promise<number> {
    const { collection, documentId, title, content, metadata = {}, chunkSize = 800 } = input;

    // Remove existing chunks for this document to ensure idempotency
    await DbClient.query(
      `DELETE FROM enterprise_vector_memory WHERE collection = $1 AND document_id = $2;`,
      [collection, documentId]
    );

    const chunks = this.chunkText(content, chunkSize);
    let ingestedCount = 0;

    for (let i = 0; i < chunks.length; i++) {
      const chunkText = chunks[i];
      const embedding = await this.llmEngine.embedText(`${title}\n${chunkText}`);
      const embeddingSql = `[${embedding.join(",")}]`;

      await DbClient.query(
        `INSERT INTO enterprise_vector_memory 
          (collection, document_id, title, chunk_index, content, metadata, embedding)
         VALUES ($1, $2, $3, $4, $5, $6, $7::vector);`,
        [collection, documentId, title, i, chunkText, JSON.stringify(metadata), embeddingSql]
      );
      ingestedCount++;
    }

    return ingestedCount;
  }

  /**
   * Real-time semantic search hook across enterprise documents and ERP memory.
   * Every agent calls this prior to taking autonomous decisions.
   */
  public async queryRelevantMemory(
    query: string,
    collectionFilter?: string[],
    topK: number = 5
  ): Promise<MemorySearchResult[]> {
    const queryEmbedding = await this.llmEngine.embedText(query);
    const queryEmbeddingSql = `[${queryEmbedding.join(",")}]`;

    let sql = `
      SELECT id, collection, document_id, title, chunk_index, content, metadata,
             (1 - (embedding <=> $1::vector)) AS similarity
      FROM enterprise_vector_memory
    `;
    const params: any[] = [queryEmbeddingSql];

    if (collectionFilter && collectionFilter.length > 0) {
      sql += ` WHERE collection = ANY($2::text[])`;
      params.push(collectionFilter);
      sql += ` ORDER BY embedding <=> $1::vector LIMIT $3;`;
      params.push(topK);
    } else {
      sql += ` ORDER BY embedding <=> $1::vector LIMIT $2;`;
      params.push(topK);
    }

    const res = await DbClient.query(sql, params);

    return res.rows.map((row: any) => ({
      id: row.id,
      collection: row.collection,
      documentId: row.document_id,
      title: row.title,
      chunkIndex: row.chunk_index,
      content: row.content,
      metadata: row.metadata || {},
      similarity: parseFloat(row.similarity) || 0,
    }));
  }

  /**
   * Seeds enterprise ground truth documents (Corporate Bylaws, MSAs, POs, Vendor Registry).
   */
  public async seedEnterpriseTruth(): Promise<void> {
    const enterpriseDocs: IngestDocumentInput[] = [
      {
        collection: "company_bylaws",
        documentId: "BYLAWS-2026-TREASURY",
        title: "BizArc Corporate Treasury Policy & Governance Bylaws 2026",
        content: `
ARTICLE 1: ARC L1 TREASURY MANAGEMENT
Section 1.1: All corporate liquidity shall be anchored on the Arc Layer-1 blockchain with USDC as the native settlement asset.
Section 1.2: Operating accounts shall maintain sufficient liquid buffer (min 20% above 7-day scheduled liabilities).
Section 1.3: All idle funds exceeding the target reserve shall be swept into ERC-4626 tokenized US Treasury yield vaults (USYC) with 0-risk short-term government backing.
Section 1.4: Dual authorization: Payments exceeding 50,000 USDC require cryptographic EIP-712 human sign-off from designated treasury officers.
Section 1.5: Autonomous agent transactions are strictly capped at 25,000 USDC per transaction and 100,000 USDC daily per operating pool.
        `,
        metadata: { category: "governance", effective_year: 2026, dual_sign_threshold: 50000 },
      },
      {
        collection: "msas",
        documentId: "MSA-AWS-CLOUD-01",
        title: "Amazon Web Services Enterprise Master Services Agreement",
        content: `
VENDOR MASTER: Amazon Web Services Inc. (Vendor ID: VEND-AWS-01)
AUTHORIZED SETTLEMENT ADDRESS: 0x1111111111111111111111111111111111111111
TERMS OF PAYMENT: Net-15 upon receipt of valid cryptographic billing manifest.
SERVICE DESCRIPTION: Cloud compute, PostgreSQL enterprise clusters, and bandwidth.
MONTHLY SPEND CAP: 20,000.000000 USDC. Any bill exceeding cap requires CFO approval.
PO LINKAGE MANDATE: All invoices must reference active purchase order PO-2026-AWS-01.
        `,
        metadata: {
          vendor_id: "VEND-AWS-01",
          payout_address: "0x1111111111111111111111111111111111111111",
          monthly_cap: 20000,
        },
      },
      {
        collection: "erp_pos",
        documentId: "PO-2026-AWS-01",
        title: "ERP Purchase Order PO-2026-AWS-01 (Odoo/ERPNext Linked)",
        content: `
PURCHASE ORDER: PO-2026-AWS-01
STATUS: APPROVED
VENDOR: Amazon Web Services Inc.
APPROVED AMOUNT: 12,500.000000 USDC
DESCRIPTION: Q3/Q4 Cloud Infrastructure, GPU nodes, and Arc RPC endpoints.
MATCHING REQUIREMENT: Strict 3-Way Match required (PO + CloudWatch Usage Telemetry Receipt + Monthly Invoice).
PAYOUT DESTINATION: 0x1111111111111111111111111111111111111111
HASH REF: 0x7fa26a310c812d87e0ef6b7bfa9c3e981f211320ef2294101e1dc59c4059a4bb
        `,
        metadata: {
          po_number: "PO-2026-AWS-01",
          vendor_id: "VEND-AWS-01",
          amount_usdc: 12500,
          status: "APPROVED",
        },
      },
      {
        collection: "delivery_receipts",
        documentId: "GRN-2026-AWS-01",
        title: "ERP Goods Receipt Note GRN-2026-AWS-01 / Cloud Telemetry Verification",
        content: `
GOODS RECEIPT NOTE (GRN): GRN-2026-AWS-01
LINKED PO: PO-2026-AWS-01
VENDOR: Amazon Web Services Inc. (VEND-AWS-01)
STATUS: VERIFIED_DELIVERED
DELIVERY PROOF: AWS CloudWatch operational metrics confirm 100% compute node uptime, RPC endpoint SLA met, and egress bandwidth consumed as billed.
VERIFIED AMOUNT: 12,500.000000 USDC
COMPLETION DATE: 2026-09-30
TELEMETRY SIGNATURE: 0x9fa180ce82b130e54d89a421b01c38592adfb9129841cda1e92d837651a084c2
        `,
        metadata: {
          po_number: "PO-2026-AWS-01",
          grn_number: "GRN-2026-AWS-01",
          vendor_id: "VEND-AWS-01",
          amount_usdc: 12500,
          status: "VERIFIED_DELIVERED",
        },
      },
      {
        collection: "msas",
        documentId: "MSA-DATADOG-02",
        title: "Datadog Enterprise Monitoring Master Subscription Agreement",
        content: `
VENDOR MASTER: Datadog Inc. (Vendor ID: VEND-DD-02)
AUTHORIZED SETTLEMENT ADDRESS: 0x2222222222222222222222222222222222222222
TERMS OF PAYMENT: Monthly automated debit via DisbursalVault.
MONTHLY SUBSCRIPTION AMOUNT: 3,400.000000 USDC.
SERVICE DESCRIPTION: APM, Synthetics, Real-Time Log Ingestion and Security Audits.
PO LINKAGE MANDATE: Tied to blanket annual purchase order PO-2026-DD-02.
        `,
        metadata: {
          vendor_id: "VEND-DD-02",
          payout_address: "0x2222222222222222222222222222222222222222",
          monthly_amount: 3400,
        },
      },
    ];

    for (const doc of enterpriseDocs) {
      await this.ingestDocument(doc);
    }
  }

  private chunkText(text: string, chunkSize: number): string[] {
    const trimmed = text.trim();
    if (trimmed.length <= chunkSize) {
      return [trimmed];
    }

    const chunks: string[] = [];
    const paragraphs = trimmed.split(/\n\s*\n/);
    let currentChunk = "";

    for (const para of paragraphs) {
      if ((currentChunk + "\n\n" + para).length <= chunkSize) {
        currentChunk = currentChunk ? `${currentChunk}\n\n${para}` : para;
      } else {
        if (currentChunk) chunks.push(currentChunk.trim());
        if (para.length > chunkSize) {
          // Break large paragraph by sentences
          const sentences = para.split(/(?<=[.?!])\s+/);
          let sentenceChunk = "";
          for (const s of sentences) {
            if ((sentenceChunk + " " + s).length <= chunkSize) {
              sentenceChunk = sentenceChunk ? `${sentenceChunk} ${s}` : s;
            } else {
              if (sentenceChunk) chunks.push(sentenceChunk.trim());
              sentenceChunk = s;
            }
          }
          currentChunk = sentenceChunk;
        } else {
          currentChunk = para;
        }
      }
    }

    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }
}
