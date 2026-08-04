import { runSync } from '@/sync/engine';
import { getSettings, getSyncStatus, saveSettings, getConflicts, resolveConflict } from '@/config/store';
import { recoverFromWAL } from '@/browser/bookmark-writer';
import { findBrowserIdByStableId } from '@/browser/bookmark-reader';
import { createStorageBackend } from '@/storage/factory';
import { getRequiredOrigins } from '@/storage/origins';
import { setupPeriodicSync, getPeriodicSyncAlarmName } from '@/platform/alarms';
import { recordSWActivation, wasInterruptedMidSync } from '@/platform/sw-lifecycle';
import {
  initEncryption,
  disableEncryption,
  changePassword,
  loadCipher,
} from '@/config/key-manager';
import { extractSalt } from '@/core/encryption';
import { logger } from '@/utils/logger';
import type { AppSettings } from '@/core/types';
import { isRootFolder } from '@/core/types';

/** Messages accepted from popup / options pages */
interface ExtensionMessage {
  type:
    | 'TRIGGER_SYNC'
    | 'GET_STATUS'
    | 'TEST_CONNECTION'
    | 'SETUP_ENCRYPTION'
    | 'DISABLE_ENCRYPTION'
    | 'CHANGE_PASSWORD'
    | 'GET_CONFLICTS'
    | 'RESOLVE_CONFLICT';
  /** Optional config payload for TEST_CONNECTION (test current form values) */
  config?: AppSettings;
  /** Password payloads for encryption management */
  password?: string;
  oldPassword?: string;
  newPassword?: string;
  /** Conflict resolution payloads */
  stableId?: string;
  choice?: 'local' | 'remote';
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

      if (message.type === 'SETUP_ENCRYPTION') {
        setupEncryption(message.password ?? '')
          .then((result) => sendResponse(result))
          .catch((err) => sendResponse({ success: false, error: String(err) }));
        return true;
      }

      if (message.type === 'DISABLE_ENCRYPTION') {
        disableEncryptionFlow()
          .then((result) => sendResponse(result))
          .catch((err) => sendResponse({ success: false, error: String(err) }));
        return true;
      }

      if (message.type === 'CHANGE_PASSWORD') {
        changePasswordFlow(message.oldPassword ?? '', message.newPassword ?? '')
          .then((result) => sendResponse(result))
          .catch((err) => sendResponse({ success: false, error: String(err) }));
        return true;
      }

      if (message.type === 'GET_CONFLICTS') {
        getConflicts()
          .then((conflicts) => sendResponse({ status: 'ok', conflicts }))
          .catch((err) => sendResponse({ status: 'error', message: String(err) }));
        return true;
      }

      if (message.type === 'RESOLVE_CONFLICT') {
        resolveConflictFlow(message.stableId ?? '', message.choice ?? 'local')
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

    const backend = await createStorageBackend(settings);
    await backend.testConnection();
    return { success: true };
  } catch (err) {
    logger.error(`Connection test failed: ${err}`);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Enable end-to-end encryption: derive + persist a key from the master password,
 * reusing the remote salt if data is already encrypted (multi-device), and
 * migrate any existing plaintext snapshot to encrypted form.
 */
async function setupEncryption(
  password: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!password) {
      return { success: false, error: 'Master password is required' };
    }
    const settings = await getSettings();
    if (!settings) {
      return { success: false, error: 'No storage backend configured' };
    }

    // Probe the remote object without a cipher to inspect its raw body.
    const plainBackend = await createStorageBackend({
      ...settings,
      encryption: undefined,
    });
    const raw = await plainBackend.peekRawSnapshot();
    const existingSalt = raw ? extractSalt(raw) : null;

    // Derive and persist the key (reuse remote salt so all devices match).
    await initEncryption(password, existingSalt ?? undefined);

    // Persist the encryption flag IMMEDIATELY after the key is stored.
    // This eliminates the race window where a concurrent sync (alarm, bookmark
    // change) would see the old flag and fail on encrypted remote data.
    // A backend with a cipher handles both plaintext and encrypted downloads
    // transparently, so this is safe even before migration completes.
    settings.encryption = { enabled: true };
    await saveSettings(settings);

    if (existingSalt && raw) {
      // Remote is already encrypted: verify this password can decrypt it.
      const cipher = await loadCipher();
      try {
        await cipher.decrypt(raw);
      } catch {
        // Wrong password: roll back the key AND the settings flag.
        await disableEncryption();
        settings.encryption = { enabled: false };
        await saveSettings(settings);
        return {
          success: false,
          error: 'Wrong master password: cannot decrypt the existing encrypted data.',
        };
      }
    } else if (raw) {
      // Remote is plaintext: migrate by re-uploading it encrypted.
      const snapshot = await plainBackend.download();
      if (snapshot) {
        const encBackend = await createStorageBackend({
          ...settings,
          encryption: { enabled: true },
        });
        await encBackend.upload(snapshot);
      }
    }

    logger.info('Encryption enabled');
    return { success: true };
  } catch (err) {
    logger.error(`Setup encryption failed: ${err}`);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Disable encryption: download the (encrypted) snapshot while the key still
 * exists, remove key material, then re-upload the snapshot as plaintext.
 */
async function disableEncryptionFlow(): Promise<{ success: boolean; error?: string }> {
  try {
    const settings = await getSettings();
    if (!settings) {
      return { success: false, error: 'No storage backend configured' };
    }
    const encBackend = await createStorageBackend(settings);
    const snapshot = await encBackend.download();

    await disableEncryption();

    if (snapshot) {
      const plainBackend = await createStorageBackend({
        ...settings,
        encryption: undefined,
      });
      await plainBackend.upload(snapshot);
    }

    settings.encryption = { enabled: false };
    await saveSettings(settings);
    logger.info('Encryption disabled');
    return { success: true };
  } catch (err) {
    logger.error(`Disable encryption failed: ${err}`);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Change the master password: download with the current key, re-derive the key
 * from the new password (same salt), then re-upload re-encrypted with the new key.
 */
async function changePasswordFlow(
  oldPassword: string,
  newPassword: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!newPassword) {
      return { success: false, error: 'New master password is required' };
    }
    const settings = await getSettings();
    if (!settings) {
      return { success: false, error: 'No storage backend configured' };
    }
    // Download with the CURRENT (old) key before rotating.
    const oldBackend = await createStorageBackend(settings);
    const snapshot = await oldBackend.download();

    // Throws if the old password is incorrect.
    await changePassword(oldPassword, newPassword);

    // Re-upload with the NEW key.
    if (snapshot) {
      const newBackend = await createStorageBackend(settings);
      await newBackend.upload(snapshot);
    }
    logger.info('Master password changed');
    return { success: true };
  } catch (err) {
    logger.error(`Change password failed: ${err}`);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Resolve a recorded merge conflict by keeping the user's chosen version.
 * Locates the live browser bookmark by stableId, updates it to the chosen
 * title/url, marks the conflict resolved, then triggers a sync to propagate
 * the decision to other devices.
 */
async function resolveConflictFlow(
  stableId: string,
  choice: 'local' | 'remote',
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!stableId) {
      return { success: false, error: 'stableId is required' };
    }
    const conflicts = await getConflicts();
    const conflict = conflicts.find((c) => c.stableId === stableId && !c.resolved);
    if (!conflict) {
      return { success: false, error: 'Conflict not found or already resolved' };
    }

    const chosen = choice === 'local' ? conflict.local : conflict.remote;

    // Apply the chosen version to the live browser bookmark (if it still exists).
    // Root folders are browser-managed and cannot be updated via the API.
    const browserId = isRootFolder(stableId) ? null : await findBrowserIdByStableId(stableId);
    if (browserId) {
      const changes: { title: string; url?: string } = { title: chosen.title };
      if (chosen.type === 'bookmark' && chosen.url) {
        changes.url = chosen.url;
      }
      await browser.bookmarks.update(browserId, changes);
    } else if (!isRootFolder(stableId)) {
      logger.info(`Bookmark for conflict ${stableId} no longer exists locally; marking resolved only`);
    }

    await resolveConflict(stableId, choice);
    logger.info(`Conflict ${stableId} resolved, keeping ${choice} version`);

    // Propagate the resolution; a failure here does not undo the local resolve.
    try {
      await runSync('manual');
    } catch (err) {
      logger.error(`Post-resolve sync failed: ${err}`);
    }
    return { success: true };
  } catch (err) {
    logger.error(`Resolve conflict failed: ${err}`);
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
