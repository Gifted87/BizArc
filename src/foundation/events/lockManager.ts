export class AccountLockManager {
  private static locks = new Map<string, { lockedAt: number; reason: string }>();
  private static defaultTimeoutMs = 60000; // 60 seconds auto-unlock safety

  /**
   * Attempts to acquire lock for an account. Returns true if acquired, false if already locked.
   */
  public static acquireLock(accountId: string, reason: string): boolean {
    const existing = this.locks.get(accountId);
    const now = Date.now();

    if (existing) {
      if (now - existing.lockedAt > this.defaultTimeoutMs) {
        console.warn(`[AccountLockManager] Auto-releasing expired lock on '${accountId}' (was locked for: ${existing.reason})`);
        this.locks.delete(accountId);
      } else {
        return false;
      }
    }

    this.locks.set(accountId, { lockedAt: now, reason });
    return true;
  }

  /**
   * Releases lock for an account.
   */
  public static releaseLock(accountId: string): void {
    this.locks.delete(accountId);
  }

  /**
   * Checks if an account is currently locked.
   */
  public static isLocked(accountId: string): boolean {
    const existing = this.locks.get(accountId);
    if (!existing) return false;
    if (Date.now() - existing.lockedAt > this.defaultTimeoutMs) {
      this.locks.delete(accountId);
      return false;
    }
    return true;
  }

  public static clearAll(): void {
    this.locks.clear();
  }
}
