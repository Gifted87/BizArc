/**
 * Session-based ERP Synchronization Service.
 * Implements Onboarding Path B: streams invoices, purchase orders, and goods receipts
 * from authenticated Odoo or ERPNext instances into prefill draft payloads.
 */

import { OdooConnector, OdooConfig, OdooAccountMove, OdooPurchaseOrder, IOdooTransport } from "./odooConnector.js";
import { ErpNextConnector, ErpNextConfig, ErpNextPurchaseInvoice, ErpNextPurchaseOrder, IErpNextTransport } from "./erpNextConnector.js";
import { TenantOAuthRepo } from "../database/repos/tenantOAuthRepo.js";
import { MasterJournalRepo } from "../database/repos/masterJournalRepo.js";

export interface DiscoveredErpCostCenter {
  accountId: string;
  name: string;
  role: "OPEX_DEV" | "OPEX_INFRA" | "PAYROLL" | "TREASURY_RESERVE";
  systemOrigin: "ODOO" | "ERPNEXT";
}

export interface DiscoveredErpLiability {
  invoiceId: string;
  vendorName: string;
  amountUsdc: number;
  dueDate: string;
  costCenterTag: string;
  systemOrigin: "ODOO" | "ERPNEXT";
  threeWayMatchVerified: boolean;
  poNumber?: string;
}

export interface ErpSyncResult {
  companyId: string;
  systemType: "ODOO" | "ERPNEXT";
  connected: boolean;
  discoveredCostCenters: DiscoveredErpCostCenter[];
  discoveredLiabilities: DiscoveredErpLiability[];
  totalPayablesUsdc: number;
  syncTimestamp: string;
}

export class SessionErpSyncService {
  /**
   * Connects to live Odoo ERP instance via JSON-RPC.
   */
  public static async syncOdoo(
    companyId: string,
    overrideConfig?: Partial<OdooConfig>,
    transport?: IOdooTransport
  ): Promise<ErpSyncResult> {
    let config: Partial<OdooConfig> = overrideConfig || {};

    const oauth = await TenantOAuthRepo.getToken(companyId, "ODOO_SESSION");
    if (oauth && oauth.session_metadata) {
      config = {
        baseUrl: oauth.session_metadata.baseUrl || config.baseUrl,
        db: oauth.session_metadata.db || config.db,
        username: oauth.session_metadata.username || config.username,
        password: oauth.access_token_encrypted || config.password,
      };
    }

    const odoo = new OdooConnector(config, transport);
    const discoveredCostCenters: DiscoveredErpCostCenter[] = [];
    const discoveredLiabilities: DiscoveredErpLiability[] = [];

    let totalPayables = 0;
    try {
      const vendorBills = await odoo.getVendorBills();
      const purchaseOrders = await odoo.getPurchaseOrders();
      const pickings = await odoo.getStockPickings();

      for (const bill of vendorBills) {
        totalPayables += bill.amount_residual;
        const vendorName = Array.isArray(bill.partner_id) ? bill.partner_id[1] : `Vendor-${bill.partner_id}`;

        const matchingPo = purchaseOrders.find((po) => po.amount_total === bill.amount_total);
        const matchingPicking = matchingPo ? pickings.find((p) => p.origin === matchingPo.name && p.state === "done") : undefined;
        const threeWayMatchVerified = Boolean(matchingPo && matchingPicking);

        discoveredLiabilities.push({
          invoiceId: bill.name,
          vendorName,
          amountUsdc: bill.amount_residual,
          dueDate: bill.invoice_date_due || new Date(Date.now() + 86400000 * 14).toISOString().split("T")[0],
          costCenterTag: "OPEX_OPERATIONS",
          systemOrigin: "ODOO",
          threeWayMatchVerified,
          poNumber: matchingPo?.name,
        });
      }

      discoveredCostCenters.push(
        { accountId: "acc_odoo_operations", name: "Odoo Core Operations", role: "OPEX_DEV", systemOrigin: "ODOO" },
        { accountId: "acc_odoo_logistics", name: "Odoo Supply & Logistics", role: "OPEX_INFRA", systemOrigin: "ODOO" }
      );

      await MasterJournalRepo.appendEntry({
        account_id: "acc_odoo_operations",
        action_type: "ERP_ODOO_SESSION_SYNCED",
        company_id: companyId,
        debit_account: "5000_OPEX_SYNC",
        credit_account: "1000_TREASURY_SYNC",
        amount_usdc: 0,
        document_ref: `ODOO_SYNC_${Date.now()}`,
      });

      return {
        companyId,
        systemType: "ODOO",
        connected: true,
        discoveredCostCenters,
        discoveredLiabilities,
        totalPayablesUsdc: Math.round(totalPayables * 1e6) / 1e6,
        syncTimestamp: new Date().toISOString(),
      };
    } catch (err: any) {
      return {
        companyId,
        systemType: "ODOO",
        connected: false,
        discoveredCostCenters: [],
        discoveredLiabilities: [],
        totalPayablesUsdc: 0,
        syncTimestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Connects to live ERPNext instance via REST API.
   */
  public static async syncErpNext(
    companyId: string,
    overrideConfig?: Partial<ErpNextConfig>,
    transport?: IErpNextTransport
  ): Promise<ErpSyncResult> {
    let config: Partial<ErpNextConfig> = overrideConfig || {};

    const oauth = await TenantOAuthRepo.getToken(companyId, "ERPNEXT_KEY");
    if (oauth && oauth.session_metadata) {
      config = {
        baseUrl: oauth.session_metadata.baseUrl || config.baseUrl,
        apiKey: oauth.access_token_encrypted || config.apiKey,
        apiSecret: oauth.refresh_token_encrypted || config.apiSecret,
      };
    }

    const erpnext = new ErpNextConnector(config as any, transport);
    const discoveredCostCenters: DiscoveredErpCostCenter[] = [];
    const discoveredLiabilities: DiscoveredErpLiability[] = [];

    let totalPayables = 0;
    try {
      const purchaseInvoices = await erpnext.getPurchaseInvoices();
      const purchaseOrders = await erpnext.getPurchaseOrders();
      const purchaseReceipts = await erpnext.getPurchaseReceipts();

      for (const inv of purchaseInvoices) {
        totalPayables += inv.outstanding_amount;

        const matchingPo = purchaseOrders.find((po) => po.supplier === inv.supplier);
        const matchingReceipt = matchingPo ? purchaseReceipts.find((r) => r.purchase_order === matchingPo.name && r.status === "Completed") : undefined;
        const threeWayMatchVerified = Boolean(matchingPo && matchingReceipt);

        discoveredLiabilities.push({
          invoiceId: inv.name,
          vendorName: inv.supplier,
          amountUsdc: inv.outstanding_amount,
          dueDate: inv.due_date || new Date(Date.now() + 86400000 * 14).toISOString().split("T")[0],
          costCenterTag: "OPEX_DEV",
          systemOrigin: "ERPNEXT",
          threeWayMatchVerified,
          poNumber: matchingPo?.name,
        });
      }

      discoveredCostCenters.push(
        { accountId: "acc_erpnext_general", name: "ERPNext General Operating", role: "OPEX_DEV", systemOrigin: "ERPNEXT" },
        { accountId: "acc_erpnext_payroll", name: "ERPNext Human Resources & Payroll", role: "PAYROLL", systemOrigin: "ERPNEXT" }
      );

      await MasterJournalRepo.appendEntry({
        account_id: "acc_erpnext_general",
        action_type: "ERP_ERPNEXT_SESSION_SYNCED",
        company_id: companyId,
        debit_account: "5000_OPEX_SYNC",
        credit_account: "1000_TREASURY_SYNC",
        amount_usdc: 0,
        document_ref: `ERPNEXT_SYNC_${Date.now()}`,
      });

      return {
        companyId,
        systemType: "ERPNEXT",
        connected: true,
        discoveredCostCenters,
        discoveredLiabilities,
        totalPayablesUsdc: Math.round(totalPayables * 1e6) / 1e6,
        syncTimestamp: new Date().toISOString(),
      };
    } catch (err: any) {
      return {
        companyId,
        systemType: "ERPNEXT",
        connected: false,
        discoveredCostCenters: [],
        discoveredLiabilities: [],
        totalPayablesUsdc: 0,
        syncTimestamp: new Date().toISOString(),
      };
    }
  }
}
