import { LiabilityRepo, LiabilityDbRecord } from "../database/repos/liabilityRepo.js";
import { VendorMasterRepo } from "../database/repos/vendorMasterRepo.js";
import { VendorBankRepo, VendorBankAccountRecord } from "../database/repos/vendorBankRepo.js";
import {
  VendorPaymentPreferenceRepo,
  VendorPaymentPreferenceRecord,
  PaymentRailType,
  FiatSubMethodType,
} from "../database/repos/vendorPaymentPreferenceRepo.js";

export interface ConfigurePaymentMethodParams {
  companyId: string;
  vendorId: string;
  liabilityId?: string; // Optional if configuring at vendor level
  preferredRail: PaymentRailType;
  preferredSubMethod?: FiatSubMethodType | string;
  cryptoDetails?: {
    walletAddress?: `0x${string}` | string;
    chainId?: number;
    tokenSymbol?: string;
    sessionKeyId?: string;
    serviceEndpointUrl?: string;
  };
  fiatDetails?: {
    accountHolderName: string;
    ibanOrAccountNumber: string;
    routingOrSwift: string;
    bankName?: string;
    bankCountry?: string;
    cardToken?: string;
    cardLast4?: string;
    cardNetwork?: string;
  };
  disbursalRules?: {
    autoPayThresholdUsdc?: number;
    requireThreeWayMatch?: boolean;
    preFlightLeadTimeHours?: number;
  };
}

export interface PaymentMethodConfigResult {
  success: boolean;
  vendorId: string;
  liabilityId?: string;
  preferredRail: PaymentRailType;
  preferredSubMethod?: string;
  bankAccountId?: string;
  walletAddress?: string;
  preferenceId?: string;
  updatedAt: string;
}

/**
 * LiabilitySettingsService
 *
 * Enables administrators to configure and edit payment pathways during onboarding,
 * subsequent setups, or editing liability settings.
 *
 * Supports both:
 * - Crypto Pathways:
 *     Rail 1: DISBURSAL_VAULT (Arc L1 Vault)
 *     Rail 2: ERC3009_AUTHORIZATION (Pre-signed Pull Mandates)
 *     Rail 3: MODULAR_SESSION_KEY (Scoped Autonomous Recurring Keys)
 *     Rail 4: GATEWAY_X402 (HTTP 402 Pay-Per-Call Micropayments)
 * - Fiat Pathways:
 *     Rail 5: FIAT_PAYOUT (Fedwire, ACH, Push-to-Card, SEPA, SWIFT)
 */
export class LiabilitySettingsService {
  /**
   * Configures payment method for a liability and/or vendor master.
   */
  public async configurePaymentMethod(
    params: ConfigurePaymentMethodParams
  ): Promise<PaymentMethodConfigResult> {
    const timestamp = new Date().toISOString();
    let bankAccountId: string | undefined;

    // 1. Process Fiat Details if provided
    if (params.preferredRail === "FIAT_PAYOUT" || params.fiatDetails) {
      if (params.fiatDetails) {
        const subMethod = params.preferredSubMethod || (params.fiatDetails.cardToken ? "PUSH_TO_CARD" : "FEDWIRE");
        const iban = params.fiatDetails.ibanOrAccountNumber || (params.fiatDetails as any).ibanAccountNumber || "";
        const routing = params.fiatDetails.routingOrSwift || (params.fiatDetails as any).routingSwift || (subMethod === "PUSH_TO_CARD" ? "CARD_OCT" : "");
        const bankRecord = await VendorBankRepo.createBankAccount({
          vendor_id: params.vendorId,
          account_holder_name: params.fiatDetails.accountHolderName,
          iban_account_number: iban,
          routing_swift: routing,
          bank_name: params.fiatDetails.bankName,
          bank_country: params.fiatDetails.bankCountry || "US",
          payment_sub_method: subMethod,
          card_token: params.fiatDetails.cardToken || null,
          card_last4: params.fiatDetails.cardLast4 || (iban.length === 16 ? iban.slice(-4) : null),
          card_network: params.fiatDetails.cardNetwork || null,
          is_verified: true,
          verified_by_admin: "ADMIN_ONBOARDING",
        });
        bankAccountId = bankRecord.bank_account_id;
      }
    }

    // 2. Process Crypto Details & Ensure Vendor Master has verified address
    let walletAddress = params.cryptoDetails?.walletAddress;
    if (params.preferredRail !== "FIAT_PAYOUT" && walletAddress) {
      const existingVendor = await VendorMasterRepo.getVendorById(params.vendorId);
      if (!existingVendor) {
        await VendorMasterRepo.registerVendor({
          vendor_id: params.vendorId,
          name: params.vendorId,
          verified_payout_address: walletAddress as `0x${string}`,
          verified_by_admin: "ADMIN_SETUP",
          last_verified_at: new Date(),
          change_lock: true,
        });
      }
    }

    // 3. Persist to VendorPaymentPreferenceRepo
    const prefRecord = await VendorPaymentPreferenceRepo.setPreference({
      vendor_id: params.vendorId,
      preferred_rail: params.preferredRail,
      preferred_sub_method: params.preferredSubMethod || null,
      crypto_wallet_address: walletAddress || null,
      crypto_chain_id: params.cryptoDetails?.chainId ?? 5042,
      crypto_token_symbol: params.cryptoDetails?.tokenSymbol || "USDC",
      bank_account_id: bankAccountId || null,
      service_endpoint_url: params.cryptoDetails?.serviceEndpointUrl || null,
      session_key_id: params.cryptoDetails?.sessionKeyId || null,
      configuration_payload: {
        disbursalRules: params.disbursalRules,
        fiatDetails: params.fiatDetails ? {
          accountHolderName: params.fiatDetails.accountHolderName,
          bankCountry: params.fiatDetails.bankCountry,
          bankName: params.fiatDetails.bankName,
          cardLast4: params.fiatDetails.cardLast4,
        } : undefined,
      },
    });

    // 4. Update Liability Record if liabilityId is provided and is a valid UUID
    const isUuid = params.liabilityId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.liabilityId);
    if (params.liabilityId && isUuid) {
      try {
        const liability = await LiabilityRepo.getLiabilityByIdAndCompany(params.liabilityId, params.companyId);
        if (liability) {
          const updatedConfig = {
            ...liability.payment_rail_config,
            subMethod: params.preferredSubMethod,
            bankAccountId,
            serviceUrl: params.cryptoDetails?.serviceEndpointUrl,
            sessionKeyId: params.cryptoDetails?.sessionKeyId,
            beneficiaryBank: params.fiatDetails,
          };

          const updatedDisbursalRules = params.disbursalRules
            ? { ...liability.disbursal_rules, ...params.disbursalRules }
            : liability.disbursal_rules;

          await LiabilityRepo.updateLiability(
            params.liabilityId,
            params.companyId,
            {
              preferred_payment_rail: params.preferredRail,
              payment_rail_config: updatedConfig,
              disbursal_rules: updatedDisbursalRules,
            }
          );
        }
      } catch {
        // Non-fatal if liability not found
      }
    }

    return {
      success: true,
      vendorId: params.vendorId,
      liabilityId: params.liabilityId,
      preferredRail: params.preferredRail,
      preferredSubMethod: params.preferredSubMethod || undefined,
      bankAccountId,
      walletAddress: walletAddress || undefined,
      preferenceId: prefRecord.preference_id,
      updatedAt: timestamp,
    };
  }

  /**
   * Retrieves active payment settings for a liability or vendor.
   */
  public async getPaymentMethod(params: {
    companyId: string;
    vendorId: string;
    liabilityId?: string;
  }): Promise<{
    preferredRail: PaymentRailType;
    preferredSubMethod?: string;
    cryptoDetails?: Record<string, any>;
    fiatDetails?: VendorBankAccountRecord | null;
    disbursalRules?: Record<string, any>;
  }> {
    const preference = await VendorPaymentPreferenceRepo.getPreference(params.vendorId);
    let bankRecord: VendorBankAccountRecord | null = null;

    if (preference?.bank_account_id) {
      bankRecord = await VendorBankRepo.getVerifiedBankAccount(params.vendorId);
    }

    let disbursalRules: Record<string, any> = {};
    const isUuid = params.liabilityId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.liabilityId);
    if (params.liabilityId && isUuid) {
      try {
        const liability = await LiabilityRepo.getLiabilityByIdAndCompany(params.liabilityId, params.companyId);
        if (liability) {
          disbursalRules = liability.disbursal_rules || {};
        }
      } catch {
        // Non-fatal
      }
    }

    return {
      preferredRail: preference?.preferred_rail || "DISBURSAL_VAULT",
      preferredSubMethod: preference?.preferred_sub_method || undefined,
      cryptoDetails: {
        walletAddress: preference?.crypto_wallet_address,
        chainId: preference?.crypto_chain_id,
        tokenSymbol: preference?.crypto_token_symbol,
        serviceEndpointUrl: preference?.service_endpoint_url,
        sessionKeyId: preference?.session_key_id,
      },
      fiatDetails: bankRecord,
      disbursalRules,
    };
  }
}
