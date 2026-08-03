import { runSync } from '@/sync/engine';
import { getSettings, getSyncStatus } from '@/config/store';
import { recoverFromWAL } from '@/browser/bookmark-writer';
import { createStorageBackend } from '@/storage/factory';
import { getRequiredOrigins } from '@/storage/origins';
import { setupPeriodicSync, getPeriodicSyncAlarmName } from '@/platform/alarms';
import { recordSWActivation, wasInterruptedMidSync } from '@/platform/sw-lifecycle';
import { logger } from '@/utils/logger';
import type { AppSettings } from '@/core/types';

/** Messages accepted from popup / options pages */
interface ExtensionMessage {
  type: 'TRIGGER_SYNC' | 'GET_STATUS' | 'TEST_CONNECTION';
  /** Optional config payload for TEST_CONNECTION (test current form values) */
  config?: AppSettings;
}

/** Debounce delay for bookmark-change-triggered sync (ms) */
const CHANGE_SYNC_DEBOUNCE_MS = 5000;

let changeSyncTimer: ReturnType<typeof setTimeout> | null = null;

export default defineBackground(() => {
  logger.info('Bookmark Sync background loaded');

  // --- Startup sequence ---
  initializeBackground();

  // --- Message routing (popup / options) ---
  browser.runtime.onMessage.addListener(
    (rawMessage: unknown, _sender, sendResponse) => {
      const message = rawMessage as ExtensionMessage;
      if (message.type === 'TRIGGER_SYNC') {
        runSync('manual')
          .then(() => sendResponse({ status: 'ok' }))
          .catch((err) =>
            sendResponse({ status: 'error', message: String(err) }),
          );
        return true; // Keep message channel open for async response
      }

      if (message.type === 'GET_STATUS') {
        getSyncStatus()
          .then((status) => sendResponse(status))
          .catch(() => sendResponse({ state: 'IDLE', lastSyncTime: null }));
        return true;
      }

      if (message.type === 'TEST_CONNECTION') {
        testConnection(message.config)
          .then((result) => sendResponse(result))
          .catch((err) => sendResponse({ success: false, error: String(err) }));
        return true;
      }

      // Unknown message type: keep channel open but send no response.
      // (OnMessageListenerCallback requires returning literal `true`.)
      return true;
    },
  );

  // --- Periodic sync via chrome.alarms ---
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === getPeriodicSyncAlarmName()) {
      logger.info('Periodic sync triggered by alarm');
      runSync('auto').catch((err) => {
        logger.error(`Auto sync failed: ${err}`);
      });
    }
  });

  // --- Bookmark change listener with debounce ---
  // Any local bookmark change schedules a sync after a quiet period,
  // so bulk operations (import, folder restructure) trigger only one sync.
  const scheduleChangeSync = () => {
    if (changeSyncTimer !== null) {
      clearTimeout(changeSyncTimer);
    }
    changeSyncTimer = setTimeout(() => {
      changeSyncTimer = null;
      logger.info('Bookmark change detected, triggering sync');
      runSync('change').catch((err) => {
        logger.error(`Change-triggered sync failed: ${err}`);
      });
    }, CHANGE_SYNC_DEBOUNCE_MS);
  };

  browser.bookmarks.onCreated.addListener(scheduleChangeSync);
  browser.bookmarks.onRemoved.addListener(scheduleChangeSync);
  browser.bookmarks.onChanged.addListener(scheduleChangeSync);
  browser.bookmarks.onMoved.addListener(scheduleChangeSync);

  // --- Settings change listener: update alarm interval ---
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes['bmsync_settings']) return;

    const newSettings = changes['bmsync_settings'].newValue as AppSettings | undefined;
    if (newSettings?.syncIntervalMinutes) {
      setupPeriodicSync(newSettings.syncIntervalMinutes).catch((err) => {
        logger.error(`Failed to update periodic sync: ${err}`);
      });
    }
  });
});

/**
 * Startup: record activation, recover WAL, resume interrupted sync,
 * and configure the periodic sync alarm from saved settings.
 */
async function initializeBackground(): Promise<void> {
  try {
    await recordSWActivation();

    // Recover from incomplete WAL (crash during bookmark writes)
    const interrupted = await wasInterruptedMidSync();
    if (interrupted) {
      logger.info('Previous sync was interrupted, recovering from WAL');
    }
    await recoverFromWAL();

    // Set up periodic sync from saved settings
    const settings = await getSettings();
    if (settings?.syncIntervalMinutes) {
      await setupPeriodicSync(settings.syncIntervalMinutes);
    } else {
      // Default: 30 minutes
      await setupPeriodicSync(30);
    }
  } catch (err) {
    logger.error(`Background initialization error: ${err}`);
  }
}

/**
 * Test the storage backend connection.
 * If `config` is provided (from the options form), test it directly;
 * otherwise fall back to the saved settings.
 */
async function testConnection(config?: AppSettings): Promise<{ success: boolean; error?: string }> {
  try {
    const settings = config ?? (await getSettings());
    if (!settings) {
      return { success: false, error: 'No storage backend configured' };
    }

    // Verify the host permission is actually effective in this (background)
    // context. Firefox in particular may report a granted prompt yet not apply
    // the permission to background fetches, which surfaces as a CORS NetworkError.
    const origins = getRequiredOrigins(settings);
    if (origins.length > 0) {
      const granted = await browser.permissions.contains({ origins });
      if (!granted) {
        return {
          success: false,
          error:
            `Host permission is not active for ${origins.join(', ')}. ` +
            'Open the options page and click "Save" or "Test Connection" to grant it.',
        };
      }
    }

    const backend = createStorageBackend(settings);
    await backend.testConnection();
    return { success: true };
  } catch (err) {
    logger.error(`Connection test failed: ${err}`);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
