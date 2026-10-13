/**
 * Holistic Autonomous Treasury Daemon.
 * =====================================
 * The unified runtime process that activates all physical triggers:
 * 1. Physical HTTP Ingress Server (REST endpoints & Webhooks)
 * 2. Physical Blockchain Event Listener (viem watchEvent on Arc L1 for USDC & System Emitter transfers)
 * 3. Physical Temporal Background Scheduler (Interval clock for due liabilities & connected app sync)
 * 4. Master State Machine Orchestrator connecting the 5 unbroken cognitive agent chains.
 */

import { SystemHttpServer } from "../ingress/systemHttpServer.js";
import { ArcEventListener } from "../foundation/events/arcEventListener.js";
import { AutonomousSchedulerService } from "../services/autonomousSchedulerService.js";
import { TreasuryStateMachineOrchestrator } from "../orchestration/treasuryStateMachineOrchestrator.js";
import { TreasuryAccountsRepo } from "../database/repos/treasuryAccountsRepo.js";
import { BalanceMutationEvent } from "../services/treasurySentinelService.js";
import { AccountFundingService } from "../services/accountFundingService.js";

export interface TreasuryDaemonOptions {
  httpPort?: number;
  enableBlockchainListener?: boolean;
  enableScheduler?: boolean;
  schedulerIntervalMs?: number;
}

export class TreasuryDaemon {
  public readonly orchestrator: TreasuryStateMachineOrchestrator;
  public readonly httpServer: SystemHttpServer;
  public readonly arcListener?: ArcEventListener;
  public readonly scheduler?: AutonomousSchedulerService;
  public readonly accountFundingService: AccountFundingService;
  private isRunning = false;

  constructor(options?: TreasuryDaemonOptions) {
    this.orchestrator = new TreasuryStateMachineOrchestrator();
    this.httpServer = new SystemHttpServer(this.orchestrator, options?.httpPort ?? 3000);
    this.accountFundingService = new AccountFundingService({
      dynamicRecords: (this.orchestrator as any).dynamicRecords,
    });

    if (options?.enableBlockchainListener !== false) {
      this.arcListener = new ArcEventListener();
    }

    if (options?.enableScheduler !== false) {
      this.scheduler = new AutonomousSchedulerService({
        pollingIntervalMs: options?.schedulerIntervalMs ?? 60000,
        disbursalRouter: (this.orchestrator.disbursalMachine as any).disbursalRouter,
        dynamicRecords: (this.orchestrator as any).dynamicRecords,
        treasurySentinel: (this.orchestrator.yieldMachine as any).sentinelService,
      });
    }
  }

  /**
   * Starts all physical triggers and state machine listeners.
   */
  public async start(): Promise<{ httpPort: number; status: string }> {
    if (this.isRunning) {
      return { httpPort: (this.httpServer as any).port, status: "ALREADY_RUNNING" };
    }

    console.log("[TreasuryDaemon] Initializing Holistic Multi-Agent Treasury System...");

    // 1. Start Physical HTTP Server
    const actualPort = await this.httpServer.start();

    // 2. Start Physical Arc L1 Blockchain Event Listener
    if (this.arcListener) {
      try {
        const accounts = await TreasuryAccountsRepo.getAllAccounts();
        const addressMap = new Map<string, string>();
        for (const acc of accounts) {
          if (acc.wallet_address) {
            addressMap.set(acc.wallet_address.toLowerCase(), acc.account_id);
          }
        }

        await this.arcListener.startListening(async (accountId, rawEvents) => {
          const totalAmountUsdc = rawEvents.reduce((acc, e) => acc + Number(e.amount) / 1e6, 0);
          const firstEvent = rawEvents[0];

          // Reconcile onchain native Arc deposit into account ledger & dynamic records
          if (totalAmountUsdc > 0 && firstEvent) {
            try {
              await this.accountFundingService.reconcileDeposit({
                accountId,
                amountUsdc: totalAmountUsdc,
                depositReference: firstEvent.txHash,
                method: "CRYPTO_ARC_NATIVE",
                sourceTxHash: firstEvent.txHash,
              });
            } catch (err: any) {
              console.warn(`[TreasuryDaemon] Failed to reconcile deposit for account '${accountId}': ${err.message}`);
            }
          }

          const mutationEvent: BalanceMutationEvent = {
            accountId,
            amountUsdc: totalAmountUsdc,
            currentLiquidBalanceUsdc: 0, // Recalculated dynamically inside machine
            origin: "ARC_L1_BLOCKCHAIN_EVENT",
            txHash: firstEvent.txHash,
            from: firstEvent.from,
            to: firstEvent.to,
            timestamp: new Date(),
          };

          await this.orchestrator.onBalanceMutation(mutationEvent);
        }, addressMap);

        console.log("[TreasuryDaemon] Physical Arc L1 Event Listener activated.");
      } catch (err: any) {
        console.warn(`[TreasuryDaemon] Note: Arc L1 listener start note: ${err.message}`);
      }
    }

    // 3. Start Physical Background Scheduler
    if (this.scheduler) {
      this.scheduler.start();
      console.log("[TreasuryDaemon] Physical Background Scheduler started.");
    }

    this.isRunning = true;
    console.log("[TreasuryDaemon] All 5 Reactive State Machines are active and bound to physical triggers.");

    return { httpPort: actualPort, status: "RUNNING" };
  }

  /**
   * Gracefully stops all listeners and servers.
   */
  public async stop(): Promise<void> {
    if (!this.isRunning) return;

    if (this.scheduler) {
      this.scheduler.stop();
    }

    if (this.arcListener) {
      this.arcListener.stop();
    }

    await this.httpServer.stop();
    this.isRunning = false;
    console.log("[TreasuryDaemon] Treasury Daemon stopped cleanly.");
  }
}
