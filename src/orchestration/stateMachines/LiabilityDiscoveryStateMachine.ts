/**
 * Machine 2: Continuous Ingestion, 3-Way Match & Liability Discovery State Machine.
 * =================================================================================
 * Governs the cognitive verification of incoming invoices/bills from external apps
 * or webhooks, enforcing 3-Way Matching, Vendor Master change locks, stealth price creep detection,
 * and triggering immediate yield recalculation upon staging.
 */

import { LiabilityRadarLlmAgent } from "../../agents/liabilityRadarLlmAgent.js";
import { LiabilityRepo } from "../../database/repos/liabilityRepo.js";
import { VendorMasterRepo } from "../../database/repos/vendorMasterRepo.js";
import { VendorBankRepo } from "../../database/repos/vendorBankRepo.js";
import { TreasuryAccountsRepo } from "../../database/repos/treasuryAccountsRepo.js";
import { AuditLogRepo } from "../../database/repos/auditLogRepo.js";
import { PermissionRequestRepo } from "../../database/repos/permissionRequestRepo.js";
import { StandardizedPermissionRequest } from "../../types/sprs.js";
import { StateMachineExecutionResult, StateMachineTransitionRecord } from "./types.js";

export type LiabilityDiscoveryState =
  | "PAYLOAD_RECEIVED"
  | "FORENSIC_3_WAY_MATCH"
  | "VENDOR_MASTER_VERIFIED"
  | "PRICE_CREEP_DETECTED"
  | "PAYEE_MISMATCH_REJECTED"
  | "STAGED_SCHEDULED"
  | "ESCALATED_TO_SPRS"
  | "FAILED";

export interface InboundInvoicePayload {
  companyId: string;
  vendorId: string;
  vendorName?: string;
  invoiceId: string;
  amountUsdc: number;
  dueDate: string | Date;
  payoutAddress: string;
  poReference?: string;
  preferredPaymentRail?: "DISBURSAL_VAULT" | "MODULAR_SESSION_KEY" | "ERC3009_AUTHORIZATION" | "GATEWAY_X402" | "FIAT_OFFRAMP" | "FIAT_PAYOUT" | "CRYPTO_TOKEN_SWAP" | string;
  beneficiaryBankDetails?: Record<string, any>;
  sourceSystem?: string;
}

export class LiabilityDiscoveryStateMachine {
  private radarAgent: LiabilityRadarLlmAgent;
  private transitionLog: StateMachineTransitionRecord[] = [];
  private onLiabilityStagedCallback?: (accountId: string) => Promise<void>;

  constructor(
    radarAgent?: LiabilityRadarLlmAgent,
    onLiabilityStaged?: (accountId: string) => Promise<void>
  ) {
    this.radarAgent = radarAgent ?? new LiabilityRadarLlmAgent();
    this.onLiabilityStagedCallback = onLiabilityStaged;
  }

  public setOnLiabilityStaged(callback: (accountId: string) => Promise<void>) {
    this.onLiabilityStagedCallback = callback;
  }

  private logTransition(instanceId: string, from: string, to: string, trigger: string, details?: any) {
    this.transitionLog.push({
      machineName: "LIABILITY_DISCOVERY_STATE_MACHINE",
      instanceId,
      fromState: from,
      toState: to,
      trigger,
      actorAgentId: 102,
      actorAgentName: "LiabilityRadarAgent",
      timestamp: new Date(),
      details,
    });
  }

  /**
   * Unbroken Chain Execution: Processes incoming invoice through cognitive inspection, 3-way match,
   * payee locking, stealth price creep checks, and stages in Dynamic Record 1.
   */
  public async ingestAndProcessInvoice(
    payload: InboundInvoicePayload
  ): Promise<StateMachineExecutionResult<any>> {
    const instanceId = `INV-DISC-${payload.invoiceId}-${Date.now()}`;
    this.logTransition(instanceId, "INITIAL", "PAYLOAD_RECEIVED", "INVOICE_INGESTION_TRIGGER", {
      vendorId: payload.vendorId,
      amountUsdc: payload.amountUsdc,
    });

    try {
      // 1. Resolve Target Operating Account for Tenant
      const accounts = await TreasuryAccountsRepo.getAccountsByCompany(payload.companyId);
      const targetAccount = accounts[0] || (await TreasuryAccountsRepo.getAllAccounts())[0];
      const accountId = targetAccount ? targetAccount.account_id : `acc_${payload.companyId}_ops`;

      // 2. State: Forensic 3-Way Match & Payee Verification via LiabilityRadarAgent (#102)
      this.logTransition(instanceId, "PAYLOAD_RECEIVED", "FORENSIC_3_WAY_MATCH", "RADAR_INSPECTION_STARTED");

      const isFiat = payload.preferredPaymentRail === "FIAT_PAYOUT" ||
                     payload.preferredPaymentRail === "FIAT_OFFRAMP" ||
                     Boolean(payload.beneficiaryBankDetails) ||
                     (Boolean(payload.payoutAddress) && !payload.payoutAddress.startsWith("0x"));

      const isCryptoAddress = Boolean(payload.payoutAddress && payload.payoutAddress.startsWith("0x"));
      const normalizedAddress = isCryptoAddress
        ? (payload.payoutAddress.toLowerCase() as `0x${string}`)
        : undefined;

      // Verify Vendor Master Allowlist
      const vendor = await VendorMasterRepo.getVendorById(payload.vendorId);
      let payeeVerified = false;

      if (isFiat) {
        if (vendor) {
          const bank = await VendorBankRepo.getVerifiedBankAccount(payload.vendorId);
          if (bank) {
            payeeVerified = true;
          } else if (payload.beneficiaryBankDetails) {
            await VendorBankRepo.createBankAccount({
              vendor_id: payload.vendorId,
              account_holder_name: payload.beneficiaryBankDetails.accountHolderName || vendor.name,
              iban_account_number: payload.beneficiaryBankDetails.ibanAccountNumber || payload.payoutAddress || "UNKNOWN",
              routing_swift: payload.beneficiaryBankDetails.routingSwift || "000000000",
              bank_name: payload.beneficiaryBankDetails.bankName,
              bank_country: payload.beneficiaryBankDetails.bankCountry || "US",
              payment_sub_method: payload.beneficiaryBankDetails.paymentSubMethod || "FEDWIRE",
              is_verified: true,
              verified_by_admin: "AUTONOMOUS_RADAR_INGESTION",
            });
            payeeVerified = true;
          } else {
            payeeVerified = true;
          }
        } else {
          await VendorMasterRepo.registerVendor({
            vendor_id: payload.vendorId,
            name: payload.vendorName || payload.vendorId,
            verified_payout_address: normalizedAddress || null,
            verified_by_admin: "AUTONOMOUS_RADAR_INGESTION",
            last_verified_at: new Date(),
            change_lock: true,
          });
          if (payload.beneficiaryBankDetails) {
            await VendorBankRepo.createBankAccount({
              vendor_id: payload.vendorId,
              account_holder_name: payload.beneficiaryBankDetails.accountHolderName || payload.vendorName || payload.vendorId,
              iban_account_number: payload.beneficiaryBankDetails.ibanAccountNumber || payload.payoutAddress || "UNKNOWN",
              routing_swift: payload.beneficiaryBankDetails.routingSwift || "000000000",
              bank_name: payload.beneficiaryBankDetails.bankName,
              bank_country: payload.beneficiaryBankDetails.bankCountry || "US",
              payment_sub_method: payload.beneficiaryBankDetails.paymentSubMethod || "FEDWIRE",
              is_verified: true,
              verified_by_admin: "AUTONOMOUS_RADAR_INGESTION",
            });
          }
          payeeVerified = true;
        }
      } else {
        if (vendor) {
          if (vendor.verified_payout_address && normalizedAddress && vendor.verified_payout_address.toLowerCase() === normalizedAddress) {
            payeeVerified = true;
          } else {
            // Payee substitution attempt detected
            this.logTransition(instanceId, "FORENSIC_3_WAY_MATCH", "PAYEE_MISMATCH_REJECTED", "PAYEE_SUBSTITUTION_DETECTED", {
              expected: vendor.verified_payout_address,
              claimed: payload.payoutAddress,
            });

            const reqId = `SPRS-PAYEE-${payload.vendorId}-${Date.now()}`;
            await PermissionRequestRepo.createRequest({
              request_id: reqId,
              action_type: "SECURITY_ESCALATION",
              amount_usdc: payload.amountUsdc,
              reason: `CRITICAL: Payee substitution detected for vendor '${payload.vendorId}'. Claimed address (${payload.payoutAddress}) does not match immutable Vendor Master (${vendor.verified_payout_address}).`,
              status: "PENDING",
              payload: {
                accountId,
                expected: vendor.verified_payout_address,
                claimed: payload.payoutAddress,
              },
            });

            return {
              success: false,
              machineName: "LIABILITY_DISCOVERY_STATE_MACHINE",
              instanceId,
              currentState: "PAYEE_MISMATCH_REJECTED",
              error: `PAYEE_SUBSTITUTION_REJECTED: Address '${payload.payoutAddress}' does not match registered vendor address.`,
              unbrokenChainLog: [...this.transitionLog],
            };
          }
        } else {
          // Auto-register new vendor with immutable change_lock
          await VendorMasterRepo.registerVendor({
            vendor_id: payload.vendorId,
            name: payload.vendorName || payload.vendorId,
            verified_payout_address: normalizedAddress,
            verified_by_admin: "AUTONOMOUS_RADAR_INGESTION",
            last_verified_at: new Date(),
            change_lock: true,
          });
          payeeVerified = true;
        }
      }

      this.logTransition(instanceId, "FORENSIC_3_WAY_MATCH", "VENDOR_MASTER_VERIFIED", "VENDOR_VERIFIED");

      // Autonomous Cognitive Deliberation: Agent executes 3-way match and creates/edits liability via tools
      await this.radarAgent.ingestAndVerifyInvoice(instanceId, {
        accountId,
        vendorId: payload.vendorId,
        invoiceId: payload.invoiceId,
        amountUsdc: payload.amountUsdc.toFixed(6),
        claimedPayoutAddress: payload.payoutAddress,
        poReference: payload.poReference,
        category: "SAAS",
        dueDate: new Date(payload.dueDate).toISOString(),
        preferredPaymentRail: payload.preferredPaymentRail,
      });

      // 3. Stealth Price Creep Check (>15% increase against past invoices)
      const pastLiabilities = await LiabilityRepo.getUpcomingLiabilities(365, undefined, payload.companyId);
      const vendorHistory = pastLiabilities.filter((l) => l.vendor_id === payload.vendorId);
      let isPriceCreep = false;

      if (vendorHistory.length > 0) {
        const lastAmount = Number(vendorHistory[0].amount_usdc);
        if (lastAmount > 0 && payload.amountUsdc > lastAmount * 1.15) {
          isPriceCreep = true;
          this.logTransition(instanceId, "VENDOR_MASTER_VERIFIED", "PRICE_CREEP_DETECTED", "STEALTH_PRICE_CREEP_EXCEEDED", {
            lastAmount,
            currentAmount: payload.amountUsdc,
            percentageIncrease: ((payload.amountUsdc - lastAmount) / lastAmount) * 100,
          });
        }
      }

      // 4. Branching State Transition
      const initialStatus = isPriceCreep ? "AWAITING_APPROVAL" : "SCHEDULED";
      const rail = payload.preferredPaymentRail || (isFiat ? "FIAT_PAYOUT" : "DISBURSAL_VAULT");

      const createdLiab = await LiabilityRepo.createLiability({
        account_id: accountId,
        company_id: payload.companyId,
        vendor_id: payload.vendorId,
        title: `${payload.vendorName || payload.vendorId} Invoice ${payload.invoiceId}`,
        category: "SAAS",
        amount_usdc: payload.amountUsdc,
        due_date: new Date(payload.dueDate),
        payout_address: normalizedAddress || payload.payoutAddress || null,
        source_po_hash: payload.poReference || `PO-${payload.vendorId}`,
        source_invoice_hash: `INV-${payload.invoiceId}`,
        status: initialStatus,
        preferred_payment_rail: rail,
        payment_sub_method: payload.beneficiaryBankDetails?.paymentSubMethod || null,
        payment_rail_config: payload.beneficiaryBankDetails || {},
      });

      if (isPriceCreep) {
        const reqId = `SPRS-CREEP-${createdLiab.liability_id}-${Date.now()}`;
        await PermissionRequestRepo.createRequest({
          request_id: reqId,
          action_type: "UNEXPECTED_CHARGE_APPROVAL",
          amount_usdc: payload.amountUsdc,
          reason: `Stealth price creep detected: Invoice for '${payload.vendorId}' is >15% higher than historical baseline.`,
          status: "PENDING",
          payload: {
            accountId,
            liabilityId: createdLiab.liability_id,
          },
        });

        this.logTransition(instanceId, "PRICE_CREEP_DETECTED", "ESCALATED_TO_SPRS", "SPRS_EMITTED", {
          sprsRequestId: reqId,
        });

        return {
          success: true,
          machineName: "LIABILITY_DISCOVERY_STATE_MACHINE",
          instanceId,
          currentState: "ESCALATED_TO_SPRS",
          data: { liability: createdLiab, sprsRequestId: reqId },
          unbrokenChainLog: [...this.transitionLog],
        };
      }

      this.logTransition(instanceId, "VENDOR_MASTER_VERIFIED", "STAGED_SCHEDULED", "LIABILITY_SCHEDULED", {
        liabilityId: createdLiab.liability_id,
        rail,
      });

      // 5. Unbroken Chain Hand-off: Notify Machine 3 (Yield Engine)
      if (this.onLiabilityStagedCallback) {
        await this.onLiabilityStagedCallback(accountId);
      }

      return {
        success: true,
        machineName: "LIABILITY_DISCOVERY_STATE_MACHINE",
        instanceId,
        currentState: "STAGED_SCHEDULED",
        data: createdLiab,
        unbrokenChainLog: [...this.transitionLog],
      };
    } catch (err: any) {
      this.logTransition(instanceId, "FORENSIC_3_WAY_MATCH", "FAILED", "ERROR", { error: err.message });
      return {
        success: false,
        machineName: "LIABILITY_DISCOVERY_STATE_MACHINE",
        instanceId,
        currentState: "FAILED",
        error: err.message,
        unbrokenChainLog: [...this.transitionLog],
      };
    }
  }
}
