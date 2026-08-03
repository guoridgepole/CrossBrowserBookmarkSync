/**
 * Periodic sync scheduling via chrome.alarms.
 *
 * chrome.alarms is the only reliable timer in Manifest V3 — it survives
 * Service Worker termination and browser restarts.
 * Minimum interval: 1 minute (Chrome enforces this for packaged extensions).
 */

import { logger } from '@/utils/logger';

const ALARM_NAME = 'periodic-sync';

/** Minimum allowed sync interval in minutes (Chrome enforces >= 1) */
export const MIN_SYNC_INTERVAL_MINUTES = 1;

/**
 * Create or update the periodic sync alarm.
 * @param intervalMinutes - Sync interval in minutes (clamped to >= 1)
 */
export async function setupPeriodicSync(intervalMinutes: number): Promise<void> {
  const clamped = Math.max(intervalMinutes, MIN_SYNC_INTERVAL_MINUTES);

  // Clear existing alarm before recreating (idempotent)
  await browser.alarms.clear(ALARM_NAME);
  await browser.alarms.create(ALARM_NAME, {
    periodInMinutes: clamped,
    // Fire the first sync shortly after setup (delayInMinutes minimum is also enforced)
    delayInMinutes: MIN_SYNC_INTERVAL_MINUTES,
  });

  logger.info(`Periodic sync alarm set: every ${clamped} minute(s)`);
}

/**
 * Remove the periodic sync alarm (disables auto-sync).
 */
export async function clearPeriodicSync(): Promise<void> {
  await browser.alarms.clear(ALARM_NAME);
  logger.info('Periodic sync alarm cleared');
}

/**
 * Check whether the periodic sync alarm is currently active.
 */
export async function isPeriodicSyncActive(): Promise<boolean> {
  const alarm = await browser.alarms.get(ALARM_NAME);
  return alarm !== undefined;
}

/**
 * Get the alarm name used for periodic sync.
 */
export function getPeriodicSyncAlarmName(): string {
  return ALARM_NAME;
}
