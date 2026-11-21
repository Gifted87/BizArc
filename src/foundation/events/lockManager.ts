import { AccountLockRepo } from "../../database/repos/accountLockRepo.js";

export class AccountLockManager {
  private static locks = new Map<string, { lockedAt: number; reason: string }>();
  private static defaultTimeoutMs = 60000; // 60 seconds auto-unlock safety

  /**
   * Attempts to acquire lock for an account synchronously in memory and asynchronously in DB.
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
    // Persist to DB in background
    AccountLockRepo.acquireLock(accountId, reason, this.defaultTimeoutMs).catch((err) => {
      console.warn(`[AccountLockManager] DB lock acquisition failed for '${accountId}':`, err);
    });
    return true;
  }

  /**
   * Asynchronously acquires lock in DB and memory.
   */
  public static async acquireLockAsync(accountId: string, reason: string, timeoutMs = 60000): Promise<boolean> {
    const memoryAcquired = this.acquireLock(accountId, reason);
    if (!memoryAcquired) return false;
    try {
      return await AccountLockRepo.acquireLock(accountId, reason, timeoutMs);
    } catch {
      return memoryAcquired;
    }
  }

  /**
   * Releases lock for an account.
   */
  public static releaseLock(accountId: string): void {
    this.locks.delete(accountId);
    AccountLockRepo.releaseLock(accountId).catch(() => {});
  }

  public static async releaseLockAsync(accountId: string): Promise<void> {
    this.locks.delete(accountId);
    try {
      await AccountLockRepo.releaseLock(accountId);
    } catch {}
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

  public static async isLockedAsync(accountId: string): Promise<boolean> {
    if (this.isLocked(accountId)) return true;
    try {
      return await AccountLockRepo.isLocked(accountId);
    } catch {
      return false;
    }
  }

  public static clearAll(): void {
    this.locks.clear();
    AccountLockRepo.clearAll().catch(() => {});
  }
}
