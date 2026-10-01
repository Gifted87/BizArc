import crypto from "crypto";
import { DbClient } from "../dbClient.js";

export const GENESIS_PREVIOUS_HASH = "0".repeat(64);

export interface MasterJournalRecord {
  sequence_id?: string;
  timestamp?: Date;
  account_id: string;
  action_type: string;
  debit_account: string;
  credit_account: string;
  amount_usdc: number;
  document_ref: string;
  previous_hash: string;
  current_hash: string;
}

export interface AppendJournalInput {
  account_id: string;
  action_type: string;
  debit_account: string;
  credit_account: string;
  amount_usdc: number;
  document_ref: string;
}

export class MasterJournalRepo {
  /**
   * Computes deterministic SHA-256 hash for a journal entry linked to previous hash
   */
  public static computeHash(params: {
    previousHash: string;
    accountId: string;
    actionType: string;
    debitAccount: string;
    creditAccount: string;
    amountUsdc: number;
    documentRef: string;
    timestampIso: string;
  }): string {
    const raw = [
      params.previousHash,
      params.accountId,
      params.actionType,
      params.debitAccount,
      params.creditAccount,
      params.amountUsdc.toFixed(6), // Strict 6-decimal USDC precision (Rule 5: No silent rounding)
      params.documentRef,
      params.timestampIso,
    ].join("|");

    return crypto.createHash("sha256").update(raw).digest("hex");
  }

  /**
   * Appends an immutable, document-linked, hash-chained journal entry.
   * Atomic across concurrent writers using a transaction and table lock.
   */
  public static async appendEntry(
    input: AppendJournalInput
  ): Promise<MasterJournalRecord> {
    if (input.amount_usdc <= 0) {
      throw new Error(`MasterJournal: amount_usdc must be positive, got ${input.amount_usdc}`);
    }
    if (!input.document_ref || input.document_ref.trim() === "") {
      // Rule 1: Document-Linked Ledgers Only
      throw new Error("MasterJournal: Rule 1 violation — ledger entries MUST link to a verifiable document reference.");
    }

    return DbClient.withTransaction(async (client) => {
      // Lock table against concurrent sequence race conditions
      await client.query("LOCK TABLE master_system_journal IN EXCLUSIVE MODE;");

      const latestRes = await client.query<MasterJournalRecord>(
        "SELECT * FROM master_system_journal ORDER BY sequence_id DESC LIMIT 1;"
      );

      const previousHash =
        latestRes.rows.length > 0
          ? latestRes.rows[0].current_hash
          : GENESIS_PREVIOUS_HASH;

      const now = new Date();
      const timestampIso = now.toISOString();

      const currentHash = MasterJournalRepo.computeHash({
        previousHash,
        accountId: input.account_id,
        actionType: input.action_type,
        debitAccount: input.debit_account,
        creditAccount: input.credit_account,
        amountUsdc: input.amount_usdc,
        documentRef: input.document_ref,
        timestampIso,
      });

      const insertText = `
        INSERT INTO master_system_journal (
          timestamp, account_id, action_type, debit_account,
          credit_account, amount_usdc, document_ref, previous_hash, current_hash
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *;
      `;
      const insertValues = [
        now,
        input.account_id,
        input.action_type,
        input.debit_account,
        input.credit_account,
        input.amount_usdc,
        input.document_ref,
        previousHash,
        currentHash,
      ];

      const res = await client.query<MasterJournalRecord>(insertText, insertValues);
      const row = res.rows[0];
      return {
        ...row,
        amount_usdc: Number(row.amount_usdc),
      };
    });
  }

  public static async getLatestEntry(): Promise<MasterJournalRecord | null> {
    const text = `SELECT * FROM master_system_journal ORDER BY sequence_id DESC LIMIT 1;`;
    const res = await DbClient.query<MasterJournalRecord>(text);
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      ...row,
      amount_usdc: Number(row.amount_usdc),
    };
  }

  public static async getEntriesByAccount(
    accountId: string,
    limit = 100
  ): Promise<MasterJournalRecord[]> {
    const text = `
      SELECT * FROM master_system_journal
      WHERE account_id = $1
      ORDER BY sequence_id ASC
      LIMIT $2;
    `;
    const res = await DbClient.query<MasterJournalRecord>(text, [accountId, limit]);
    return res.rows.map((row) => ({
      ...row,
      amount_usdc: Number(row.amount_usdc),
    }));
  }

  public static async getAllEntries(): Promise<MasterJournalRecord[]> {
    const text = `SELECT * FROM master_system_journal ORDER BY sequence_id ASC;`;
    const res = await DbClient.query<MasterJournalRecord>(text);
    return res.rows.map((row) => ({
      ...row,
      amount_usdc: Number(row.amount_usdc),
    }));
  }

  /**
   * Cryptographic verification of the entire master journal hash chain.
   * Detects if any historical transaction, debit, credit, or document reference has been tampered with.
   */
  public static async verifyChainIntegrity(): Promise<{
    valid: boolean;
    totalEntries: number;
    brokenAtSequence?: string;
    details?: string;
  }> {
    const entries = await this.getAllEntries();
    if (entries.length === 0) {
      return { valid: true, totalEntries: 0 };
    }

    let expectedPrevHash = GENESIS_PREVIOUS_HASH;

    for (const entry of entries) {
      if (entry.previous_hash !== expectedPrevHash) {
        return {
          valid: false,
          totalEntries: entries.length,
          brokenAtSequence: entry.sequence_id,
          details: `Previous hash mismatch at sequence ${entry.sequence_id}: expected ${expectedPrevHash}, got ${entry.previous_hash}`,
        };
      }

      const recomputedHash = MasterJournalRepo.computeHash({
        previousHash: entry.previous_hash,
        accountId: entry.account_id,
        actionType: entry.action_type,
        debitAccount: entry.debit_account,
        creditAccount: entry.credit_account,
        amountUsdc: entry.amount_usdc,
        documentRef: entry.document_ref,
        timestampIso: new Date(entry.timestamp!).toISOString(),
      });

      if (recomputedHash !== entry.current_hash) {
        return {
          valid: false,
          totalEntries: entries.length,
          brokenAtSequence: entry.sequence_id,
          details: `Hash integrity failure at sequence ${entry.sequence_id}: stored ${entry.current_hash}, computed ${recomputedHash}`,
        };
      }

      expectedPrevHash = entry.current_hash;
    }

    return { valid: true, totalEntries: entries.length };
  }
}
