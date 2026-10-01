import { PolicyLoader } from "../config/policyLoader.js";
import { TreasuryAccountsRepo } from "../database/repos/treasuryAccountsRepo.js";
import { LiabilityRepo } from "../database/repos/liabilityRepo.js";
import { MasterJournalRepo } from "../database/repos/masterJournalRepo.js";
import { CentralTreasuryYieldVaultService } from "../contracts/centralTreasuryYieldVaultService.js";

export interface EvaluationResult {
  targetReserve: number;
  safeToInvest: number;
  action: "SWEEP" | "RECALL" | "NONE";
  actionAmountUsdc: number;
  encodedTx?: `0x${string}`;
}

export class YieldOptimizerService {
  constructor(private vaultService: CentralTreasuryYieldVaultService) {}

  public async evaluateAccount(
    accountId: string,
    liquidBalanceUsdc: number
  ): Promise<EvaluationResult> {
    const account = await TreasuryAccountsRepo.getAccountById(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found in DB`);
    }

    const { profile } = PolicyLoader.getActiveProfile();
    const invRules = profile.investment_rules;

    const opPolicy = profile.operating_accounts.find(
      (a) => a.account_id === accountId
    );
    if (!opPolicy) {
      throw new Error(`Account ${accountId} missing from policy operating_accounts`);
    }

    // Protection rule
    if (
      opPolicy.exclude_from_waterfall_draws ||
      (opPolicy.max_autonomous_sweep_limit !== undefined &&
        opPolicy.max_autonomous_sweep_limit <= 0)
    ) {
      return {
        targetReserve: 0,
        safeToInvest: 0,
        action: "NONE",
        actionAmountUsdc: 0,
      };
    }

    // Liabilities inside the window
    const windowDays = opPolicy.evaluation_window_days;
    const liabilities = await LiabilityRepo.getUpcomingLiabilities(
      windowDays,
      accountId
    );

    const totalLiabilityUsdc = liabilities.reduce(
      (sum, l) => sum + l.amount_usdc,
      0
    );

    const minFloor = account.min_operating_floor_usdc;
    const safetyMultiplier = account.safety_buffer_ratio;

    const targetReserve = totalLiabilityUsdc * safetyMultiplier + minFloor;

    const safeToInvest = Math.max(
      0,
      liquidBalanceUsdc - (targetReserve + invRules.invest_hysteresis_band_usdc)
    );
    const shouldRecall =
      liquidBalanceUsdc <
      targetReserve - invRules.recall_hysteresis_band_usdc;

    let action: "SWEEP" | "RECALL" | "NONE" = "NONE";
    let actionAmountUsdc = 0;
    let encodedTx: `0x${string}` | undefined;

    if (safeToInvest >= invRules.min_sweep_amount_usdc) {
      action = "SWEEP";
      // respect max sweep limit
      actionAmountUsdc = opPolicy.max_autonomous_sweep_limit
        ? Math.min(safeToInvest, opPolicy.max_autonomous_sweep_limit)
        : safeToInvest;

      // Ensure 6-decimal scaling
      const amountBigInt = BigInt(Math.floor(actionAmountUsdc * 1_000_000));
      encodedTx = this.vaultService.encodeSweepFromAccount(
        accountId,
        account.wallet_address,
        amountBigInt
      );

      // System Journal Log
      await MasterJournalRepo.appendEntry({
        account_id: accountId,
        action_type: "AUTONOMOUS_SWEEP",
        debit_account: accountId,
        credit_account: "CENTRAL_YIELD_VAULT",
        amount_usdc: actionAmountUsdc,
        document_ref: "SWEEP_EVAL_" + Date.now(),
      });
    } else if (shouldRecall) {
      action = "RECALL";
      actionAmountUsdc = targetReserve - liquidBalanceUsdc; // Need to top up to target reserve
      const amountBigInt = BigInt(Math.floor(actionAmountUsdc * 1_000_000));
      encodedTx = this.vaultService.encodeRecallForAccount(
        accountId,
        amountBigInt
      );

      // System Journal Log
      await MasterJournalRepo.appendEntry({
        account_id: accountId,
        action_type: "AUTONOMOUS_RECALL",
        debit_account: "CENTRAL_YIELD_VAULT",
        credit_account: accountId,
        amount_usdc: actionAmountUsdc,
        document_ref: "RECALL_EVAL_" + Date.now(),
      });
    }

    return {
      targetReserve,
      safeToInvest,
      action,
      actionAmountUsdc,
      encodedTx,
    };
  }
}
