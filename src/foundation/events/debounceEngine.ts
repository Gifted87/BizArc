export interface BalanceMutationEvent {
  accountId: string;
  from: `0x${string}`;
  to: `0x${string}`;
  amount: bigint;
  txHash: `0x${string}`;
  blockNumber: bigint;
  isInternalSettlement: boolean;
}

export class DebounceEngine {
  private debounceWindowMs: number;
  private internalAddresses = new Set<string>();
  private activeTimers = new Map<string, NodeJS.Timeout>();
  private pendingEvents = new Map<string, BalanceMutationEvent[]>();

  constructor(debounceWindowMs = 5000) {
    this.debounceWindowMs = debounceWindowMs;
  }

  public registerInternalAddress(address: string): void {
    this.internalAddresses.add(address.toLowerCase());
  }

  public isInternalAddress(address: string): boolean {
    return this.internalAddresses.has(address.toLowerCase());
  }

  public isInternalSettlement(from: string, to: string): boolean {
    return this.isInternalAddress(from) && this.isInternalAddress(to);
  }

  /**
   * Ingests an event and applies debouncing & origin filtering.
   */
  public ingestEvent(
    event: Omit<BalanceMutationEvent, "isInternalSettlement">,
    onQuiescent: (accountId: string, events: BalanceMutationEvent[]) => Promise<void> | void,
    onInternalSettlement?: (event: BalanceMutationEvent) => void
  ): void {
    const isInternal = this.isInternalSettlement(event.from, event.to);
    const enrichedEvent: BalanceMutationEvent = {
      ...event,
      isInternalSettlement: isInternal,
    };

    if (isInternal) {
      // Feedback loop prevention: internal settlement events do NOT trigger sweep recalculation
      if (onInternalSettlement) {
        onInternalSettlement(enrichedEvent);
      }
      return;
    }

    // External revenue or funding drip: debounce sliding window
    const accountId = event.accountId;
    const existingEvents = this.pendingEvents.get(accountId) ?? [];
    existingEvents.push(enrichedEvent);
    this.pendingEvents.set(accountId, existingEvents);

    const existingTimer = this.activeTimers.get(accountId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(async () => {
      const batched = this.pendingEvents.get(accountId) ?? [];
      this.pendingEvents.delete(accountId);
      this.activeTimers.delete(accountId);
      await onQuiescent(accountId, batched);
    }, this.debounceWindowMs);

    this.activeTimers.set(accountId, timer);
  }

  public flushAll(): void {
    for (const timer of this.activeTimers.values()) {
      clearTimeout(timer);
    }
    this.activeTimers.clear();
    this.pendingEvents.clear();
  }
}
