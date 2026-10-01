import { PublicClient, parseAbiItem, Log } from "viem";
import { ARC_CONSTANTS } from "../arc/constants.js";
import { ArcClientManager } from "../arc/client.js";
import { DebounceEngine, BalanceMutationEvent } from "./debounceEngine.js";

export class ArcEventListener {
  private client: PublicClient;
  private debounceEngine: DebounceEngine;
  private unwatchList: Array<() => void> = [];
  private isListening = false;

  constructor(debounceEngine?: DebounceEngine, client?: PublicClient) {
    this.client = client ?? ArcClientManager.getPublicClient();
    this.debounceEngine = debounceEngine ?? new DebounceEngine(5000);
  }

  public getDebounceEngine(): DebounceEngine {
    return this.debounceEngine;
  }

  /**
   * Starts listening to USDC ERC-20 transfers and System Emitter events on Arc L1.
   */
  public async startListening(
    onMutation: (accountId: string, events: BalanceMutationEvent[]) => Promise<void> | void,
    accountAddressToIdMap: Map<string, string>
  ): Promise<void> {
    if (this.isListening) return;
    this.isListening = true;

    const transferEvent = parseAbiItem(
      "event Transfer(address indexed from, address indexed to, uint256 value)"
    );

    // 1. Watch USDC Predeploy Transfer Events
    const unwatchUsdc = (this.client as any).watchEvent({
      address: ARC_CONSTANTS.USDC_PREDEPLOY,
      event: transferEvent as any,
      onLogs: (logs: Log[]) => {
        this.processLogs(logs, accountAddressToIdMap, onMutation);
      },
      onError: (err: unknown) => {
        console.error("[ArcEventListener] USDC watch error:", err);
      },
    });
    this.unwatchList.push(unwatchUsdc);

    // 2. Watch System Emitter Predeploy Transfer Events (for native transfers)
    const unwatchEmitter = (this.client as any).watchEvent({
      address: ARC_CONSTANTS.SYSTEM_EMITTER,
      event: transferEvent as any,
      onLogs: (logs: Log[]) => {
        this.processLogs(logs, accountAddressToIdMap, onMutation);
      },
      onError: (err: unknown) => {
        console.error("[ArcEventListener] System Emitter watch error:", err);
      },
    });
    this.unwatchList.push(unwatchEmitter);
  }

  private processLogs(
    logs: Log[],
    accountMap: Map<string, string>,
    onMutation: (accountId: string, events: BalanceMutationEvent[]) => Promise<void> | void
  ): void {
    for (const log of logs) {
      const args = (log as any).args as {
        from?: `0x${string}`;
        to?: `0x${string}`;
        value?: bigint;
      };

      if (!args || !args.from || !args.to || args.value === undefined) continue;

      const fromAddr = args.from.toLowerCase();
      const toAddr = args.to.toLowerCase();

      // Determine which internal account was affected (sender or receiver)
      const affectedAccountId = accountMap.get(fromAddr) ?? accountMap.get(toAddr);
      if (!affectedAccountId) {
        continue; // Unrelated transfer
      }

      this.debounceEngine.ingestEvent(
        {
          accountId: affectedAccountId,
          from: args.from,
          to: args.to,
          amount: args.value,
          txHash: log.transactionHash ?? "0x0",
          blockNumber: log.blockNumber ?? 0n,
        },
        onMutation,
        (internalEvent) => {
          console.log(
            `[ArcEventListener] Filtered INTERNAL_SETTLEMENT event on '${internalEvent.accountId}': ${internalEvent.amount} USDC (tx: ${internalEvent.txHash})`
          );
        }
      );
    }
  }

  public stop(): void {
    for (const unwatch of this.unwatchList) {
      try {
        unwatch();
      } catch {
        // clean up silently
      }
    }
    this.unwatchList = [];
    this.debounceEngine.flushAll();
    this.isListening = false;
  }
}
