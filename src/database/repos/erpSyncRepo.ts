import { DbClient } from "../dbClient.js";

export interface ErpSyncRecord {
  sync_id: string;
  system_type: "ERPNEXT" | "ODOO";
  account_id?: string;
  entity_type: "PURCHASE_INVOICE" | "PAYMENT_ENTRY" | "PURCHASE_ORDER" | "STOCK_PICKING";
  last_sync_timestamp: Date;
  last_synced_document_id?: string;
  sync_checkpoint_data: Record<string, any>;
  status: "SYNCED" | "SYNCING" | "FAILED";
  created_at?: Date;
  updated_at?: Date;
}

export class ErpSyncRepo {
  public static async upsertSyncState(record: ErpSyncRecord): Promise<ErpSyncRecord> {
    const text = `
      INSERT INTO erp_sync_state (
        sync_id, system_type, account_id, entity_type,
        last_sync_timestamp, last_synced_document_id,
        sync_checkpoint_data, status, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT (sync_id) DO UPDATE SET
        last_sync_timestamp = EXCLUDED.last_sync_timestamp,
        last_synced_document_id = EXCLUDED.last_synced_document_id,
        sync_checkpoint_data = EXCLUDED.sync_checkpoint_data,
        status = EXCLUDED.status,
        updated_at = NOW()
      RETURNING *;
    `;
    const values = [
      record.sync_id,
      record.system_type,
      record.account_id || null,
      record.entity_type,
      record.last_sync_timestamp,
      record.last_synced_document_id || null,
      JSON.stringify(record.sync_checkpoint_data || {}),
      record.status,
    ];
    const result = await DbClient.query<ErpSyncRecord>(text, values);
    return result.rows[0];
  }

  public static async getSyncState(syncId: string): Promise<ErpSyncRecord | null> {
    const text = `SELECT * FROM erp_sync_state WHERE sync_id = $1 LIMIT 1;`;
    const result = await DbClient.query<ErpSyncRecord>(text, [syncId]);
    if (result.rows.length === 0) return null;
    return result.rows[0];
  }

  public static async getSyncStatesBySystem(
    systemType: "ERPNEXT" | "ODOO"
  ): Promise<ErpSyncRecord[]> {
    const text = `SELECT * FROM erp_sync_state WHERE system_type = $1 ORDER BY updated_at DESC;`;
    const result = await DbClient.query<ErpSyncRecord>(text, [systemType]);
    return result.rows;
  }

  public static async updateCheckpoint(
    syncId: string,
    lastDocId: string,
    checkpointData: Record<string, any>
  ): Promise<ErpSyncRecord | null> {
    const text = `
      UPDATE erp_sync_state
      SET last_synced_document_id = $2,
          sync_checkpoint_data = $3,
          last_sync_timestamp = NOW(),
          updated_at = NOW(),
          status = 'SYNCED'
      WHERE sync_id = $1
      RETURNING *;
    `;
    const result = await DbClient.query<ErpSyncRecord>(text, [
      syncId,
      lastDocId,
      JSON.stringify(checkpointData),
    ]);
    if (result.rows.length === 0) return null;
    return result.rows[0];
  }

  public static async recordSyncCheckpoint(params: {
    companyId?: string;
    systemType: "ERPNEXT" | "ODOO" | string;
    entityType?: "PURCHASE_INVOICE" | "PAYMENT_ENTRY" | "PURCHASE_ORDER" | "STOCK_PICKING" | string;
    lastSyncedDocumentId?: string;
    status?: "SYNCED" | "SYNCING" | "FAILED" | "SUCCESS" | string;
    threeWayMatchVerified?: boolean;
    txHash?: string;
    invoiceId?: string;
  }): Promise<ErpSyncRecord> {
    const syncId = `SYNC_${params.systemType}_${params.companyId || "default_org"}`;
    return this.upsertSyncState({
      sync_id: syncId,
      system_type: (params.systemType === "ODOO" ? "ODOO" : "ERPNEXT"),
      entity_type: (params.entityType as any) || "PAYMENT_ENTRY",
      last_sync_timestamp: new Date(),
      last_synced_document_id: params.lastSyncedDocumentId,
      sync_checkpoint_data: {
        companyId: params.companyId,
        threeWayMatchVerified: params.threeWayMatchVerified,
        txHash: params.txHash,
        invoiceId: params.invoiceId,
      },
      status: params.status === "FAILED" ? "FAILED" : "SYNCED",
    });
  }

  public static async getLatestSyncCheckpoint(companyId?: string): Promise<ErpSyncRecord | null> {
    const text = `SELECT * FROM erp_sync_state ORDER BY updated_at DESC LIMIT 1;`;
    const result = await DbClient.query<ErpSyncRecord>(text);
    return result.rows.length > 0 ? result.rows[0] : null;
  }
}
