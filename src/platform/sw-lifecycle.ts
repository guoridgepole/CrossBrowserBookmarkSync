/**
 * Service Worker lifecycle management for Manifest V3.
 *
 * MV3 Service Workers are ephemeral — they can be terminated after ~30s of
 * inactivity. This module provides utilities to:
 * 1. Keep the SW alive during long-running sync operations
 * 2. Persist critical state so work can resume after restart
 * 3. Detect and handle SW restarts gracefully
 */

import { logger } from '@/utils/logger';

const SW_STATE_KEY = 'bmsync_sw_state';

interface SWState {
  /** Timestamp of last SW activation */
  lastActivated: number;
  /** Whether a sync operation was in progress when SW was last seen */
  syncInProgress: boolean;
}

/**
 * Keep-alive mechanism: periodically pings chrome.runtime to prevent
 * the Service Worker from being terminated during long operations.
 *
 * Chrome terminates SWs after ~30s without activity. A pending
 * chrome.runtime.getPlatformInfo() call counts as activity.
 */
export class KeepAlive {
  private timer: ReturnType<typeof setInterval> | null = null;

  /** Start keep-alive pings (every 20s, safely under the 30s limit) */
  start(): void {
    if (this.timer !== null) return;

    this.timer = setInterval(() => {
      // Any extension API call resets the idle timer
      browser.runtime.getPlatformInfo().catch(() => {
        // Ignore errors — the point is just to generate activity
      });
    }, 20_000);

    logger.debug('KeepAlive started');
  }

  /** Stop keep-alive pings */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
      logger.debug('KeepAlive stopped');
    }
  }

  get isActive(): boolean {
    return this.timer !== null;
  }
}

/** Singleton keep-alive instance for sync operations */
export const syncKeepAlive = new KeepAlive();

/**
 * Record SW activation state. Called on every SW startup.
 */
export async function recordSWActivation(): Promise<void> {
  const state: SWState = {
    lastActivated: Date.now(),
    syncInProgress: false,
  };
  await browser.storage.local.set({ [SW_STATE_KEY]: state });
}

/**
 * Mark that a sync operation is in progress (survives SW termination).
 */
export async function markSyncInProgress(inProgress: boolean): Promise<void> {
  const result = await browser.storage.local.get(SW_STATE_KEY);
  const state: SWState = (result[SW_STATE_KEY] as SWState) ?? {
    lastActivated: Date.now(),
    syncInProgress: false,
  };
  state.syncInProgress = inProgress;
  await browser.storage.local.set({ [SW_STATE_KEY]: state });
}

/**
 * Check if the previous SW session was interrupted mid-sync.
 * Used on startup to decide whether recovery is needed.
 */
export async function wasInterruptedMidSync(): Promise<boolean> {
  const result = await browser.storage.local.get(SW_STATE_KEY);
  const state = result[SW_STATE_KEY] as SWState | undefined;
  return state?.syncInProgress ?? false;
}
