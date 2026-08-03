/**
 * Sync mutex: prevents concurrent sync operations.
 * Uses chrome.storage.session for in-memory locking (cleared on browser restart).
 */

const LOCK_KEY = 'bmsync_sync_lock';
const LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes max lock duration

interface LockInfo {
  lockedAt: number;
  source: string;
}

/**
 * Acquire the sync lock. Returns true if acquired, false if already locked.
 */
export async function acquireLock(source: string): Promise<boolean> {
  const result = await browser.storage.session.get(LOCK_KEY);
  const existing = result[LOCK_KEY] as LockInfo | undefined;

  if (existing) {
    // Check if lock is stale (expired)
    if (Date.now() - existing.lockedAt > LOCK_TIMEOUT_MS) {
      // Stale lock, override
      await browser.storage.session.remove(LOCK_KEY);
    } else {
      return false; // Already locked by another operation
    }
  }

  await browser.storage.session.set({
    [LOCK_KEY]: { lockedAt: Date.now(), source } satisfies LockInfo,
  });
  return true;
}

/**
 * Release the sync lock.
 */
export async function releaseLock(): Promise<void> {
  await browser.storage.session.remove(LOCK_KEY);
}

/**
 * Check if a sync operation is currently in progress.
 */
export async function isLocked(): Promise<boolean> {
  const result = await browser.storage.session.get(LOCK_KEY);
  const existing = result[LOCK_KEY] as LockInfo | undefined;

  if (!existing) return false;

  // Check for stale lock
  if (Date.now() - existing.lockedAt > LOCK_TIMEOUT_MS) {
    await browser.storage.session.remove(LOCK_KEY);
    return false;
  }

  return true;
}
