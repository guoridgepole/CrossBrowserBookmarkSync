/**
 * Configuration store: manages app settings and sync state in chrome.storage.
 */

import type { AppSettings, BookmarkNode, SyncStatus } from '@/core/types';

const SETTINGS_KEY = 'bmsync_settings';
const STATUS_KEY = 'bmsync_status';
const BASE_SNAPSHOT_KEY = 'bmsync_base_snapshot';

/**
 * Get app settings from storage. Returns null if not configured.
 */
export async function getSettings(): Promise<AppSettings | null> {
  const result = await browser.storage.local.get(SETTINGS_KEY);
  return (result[SETTINGS_KEY] as AppSettings) ?? null;
}

/**
 * Save app settings to storage.
 */
export async function saveSettings(settings: AppSettings): Promise<void> {
  await browser.storage.local.set({ [SETTINGS_KEY]: settings });
}

/**
 * Get the base snapshot (last synced tree) for three-way merge.
 */
export async function getBaseSnapshot(): Promise<BookmarkNode[]> {
  const result = await browser.storage.local.get(BASE_SNAPSHOT_KEY);
  return (result[BASE_SNAPSHOT_KEY] as BookmarkNode[]) ?? [];
}

/**
 * Save the base snapshot after a successful sync.
 */
export async function saveBaseSnapshot(tree: BookmarkNode[]): Promise<void> {
  await browser.storage.local.set({ [BASE_SNAPSHOT_KEY]: tree });
}

/**
 * Get current sync status.
 */
export async function getSyncStatus(): Promise<SyncStatus> {
  const result = await browser.storage.local.get(STATUS_KEY);
  return (
    (result[STATUS_KEY] as SyncStatus) ?? {
      state: 'IDLE',
      lastSyncTime: null,
      lastError: null,
      lastSyncRevision: null,
    }
  );
}

/**
 * Save sync status.
 */
export async function saveSyncStatus(status: SyncStatus): Promise<void> {
  await browser.storage.local.set({ [STATUS_KEY]: status });
}

/**
 * Generate or retrieve a stable device ID.
 */
export async function getOrCreateDeviceId(): Promise<string> {
  const settings = await getSettings();
  if (settings?.deviceId) {
    return settings.deviceId;
  }

  // Generate a new device ID
  const deviceId = crypto.randomUUID();

  // If settings exist, update them
  if (settings) {
    settings.deviceId = deviceId;
    await saveSettings(settings);
  }

  return deviceId;
}
