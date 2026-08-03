/**
 * Options page logic: backend configuration, sync interval, connection test.
 */

import type { AppSettings, BackendType } from '@/core/types';
import { getSettings, saveSettings } from '@/config/store';
import { getRequiredOrigins } from '@/storage/origins';

const backendType = document.getElementById('backend-type') as HTMLSelectElement;
const webdavConfig = document.getElementById('webdav-config')!;
const s3Config = document.getElementById('s3-config')!;
const saveBtn = document.getElementById('save-btn')!;
const testBtn = document.getElementById('test-btn')!;
const messageEl = document.getElementById('message')!;

// Input elements
const inputs = {
  webdavUrl: document.getElementById('webdav-url') as HTMLInputElement,
  webdavUsername: document.getElementById('webdav-username') as HTMLInputElement,
  webdavPassword: document.getElementById('webdav-password') as HTMLInputElement,
  s3Endpoint: document.getElementById('s3-endpoint') as HTMLInputElement,
  s3Bucket: document.getElementById('s3-bucket') as HTMLInputElement,
  s3Region: document.getElementById('s3-region') as HTMLInputElement,
  s3AccessKey: document.getElementById('s3-access-key') as HTMLInputElement,
  s3SecretKey: document.getElementById('s3-secret-key') as HTMLInputElement,
  s3PathStyle: document.getElementById('s3-path-style') as HTMLInputElement,
  syncInterval: document.getElementById('sync-interval') as HTMLSelectElement,
};

// Toggle backend config sections
backendType.addEventListener('change', () => {
  const isWebdav = backendType.value === 'webdav';
  webdavConfig.classList.toggle('hidden', !isWebdav);
  s3Config.classList.toggle('hidden', isWebdav);
});

// Load saved settings
async function loadSettings(): Promise<void> {
  const settings = await getSettings();
  if (!settings) return;

  backendType.value = settings.backendType ?? 'webdav';
  backendType.dispatchEvent(new Event('change'));

  if (settings.s3) {
    inputs.s3Endpoint.value = settings.s3.endpoint ?? '';
    inputs.s3Bucket.value = settings.s3.bucket ?? '';
    inputs.s3Region.value = settings.s3.region ?? '';
    inputs.s3AccessKey.value = settings.s3.accessKeyId ?? '';
    inputs.s3SecretKey.value = settings.s3.secretAccessKey ?? '';
    inputs.s3PathStyle.checked = settings.s3.pathStyle ?? false;
  }

  if (settings.webdav) {
    inputs.webdavUrl.value = settings.webdav.url ?? '';
    inputs.webdavUsername.value = settings.webdav.username ?? '';
    inputs.webdavPassword.value = settings.webdav.password ?? '';
  }

  inputs.syncInterval.value = String(settings.syncIntervalMinutes ?? 30);
}

/**
 * Read an AppSettings object from the current form values (synchronous).
 * The deviceId is a fresh UUID; callers that persist settings should preserve
 * the existing deviceId separately. Returns the settings, or a validation
 * error string.
 */
function readFormSettings(): AppSettings | string {
  const type = backendType.value as BackendType;
  if (type === 'webdav' && !inputs.webdavUrl.value.trim()) {
    return 'Please enter a WebDAV URL';
  }
  if (type === 's3' && (!inputs.s3Bucket.value.trim() || !inputs.s3AccessKey.value.trim())) {
    return 'Please enter S3 bucket and access key';
  }

  const settings: AppSettings = {
    backendType: type,
    syncIntervalMinutes: Number(inputs.syncInterval.value),
    deviceId: crypto.randomUUID(),
  };

  if (type === 's3') {
    settings.s3 = {
      endpoint: inputs.s3Endpoint.value.trim(),
      bucket: inputs.s3Bucket.value.trim(),
      region: inputs.s3Region.value.trim() || 'us-east-1',
      accessKeyId: inputs.s3AccessKey.value.trim(),
      secretAccessKey: inputs.s3SecretKey.value,
      pathStyle: inputs.s3PathStyle.checked,
    };
  } else {
    settings.webdav = {
      url: inputs.webdavUrl.value.trim(),
      username: inputs.webdavUsername.value.trim(),
      password: inputs.webdavPassword.value,
    };
  }

  return settings;
}

/**
 * Request the optional host permissions for the given origins.
 * This must be the FIRST async operation in a user-gesture handler so the
 * browser still associates the permission prompt with the click.
 * Returns true if all origins are granted.
 */
async function ensureHostPermissions(origins: string[]): Promise<boolean> {
  if (origins.length === 0) return true;

  // Already granted (static permission on Firefox, or a previous grant)?
  // Skip the prompt — requesting an already-granted permission can throw.
  if (await browser.permissions.contains({ origins })) {
    return true;
  }

  try {
    const granted = await browser.permissions.request({ origins });
    if (!granted) {
      showMessage('Host permission denied. The extension cannot reach your storage without it.', 'error');
    }
    return granted;
  } catch (err) {
    showMessage(`Permission request failed: ${err}`, 'error');
    return false;
  }
}

// Save settings
saveBtn.addEventListener('click', async () => {
  const formSettings = readFormSettings();
  if (typeof formSettings === 'string') {
    showMessage(formSettings, 'error');
    return;
  }
  // Request host permissions first (must stay within the user gesture)
  if (!(await ensureHostPermissions(getRequiredOrigins(formSettings)))) {
    return;
  }
  // Preserve the existing deviceId across saves
  const existing = await getSettings();
  const settings: AppSettings = {
    ...formSettings,
    deviceId: existing?.deviceId ?? formSettings.deviceId,
  };
  await saveSettings(settings);
  showMessage('Settings saved! Periodic sync schedule updated.', 'success');
});

// Test connection using the CURRENT form values (no need to save first).
// The config is sent to the background service worker, which builds a
// temporary backend and tests it directly.
testBtn.addEventListener('click', async () => {
  const formSettings = readFormSettings();
  if (typeof formSettings === 'string') {
    showMessage(formSettings, 'error');
    return;
  }
  // Request host permissions first (must stay within the user gesture)
  if (!(await ensureHostPermissions(getRequiredOrigins(formSettings)))) {
    return;
  }

  showMessage('Testing connection...', 'info');
  testBtn.setAttribute('disabled', 'true');

  try {
    const response = (await browser.runtime.sendMessage({
      type: 'TEST_CONNECTION',
      config: formSettings,
    })) as { success?: boolean; error?: string } | undefined;
    if (response?.success) {
      showMessage('Connection successful!', 'success');
    } else {
      showMessage(`Connection failed: ${response?.error ?? 'Unknown error'}`, 'error');
    }
  } catch (err) {
    showMessage(`Connection test error: ${err}`, 'error');
  } finally {
    testBtn.removeAttribute('disabled');
  }
});

function showMessage(text: string, type: 'success' | 'error' | 'info'): void {
  messageEl.textContent = text;
  messageEl.className = `message ${type}`;
  messageEl.classList.remove('hidden');
  setTimeout(() => messageEl.classList.add('hidden'), 5000);
}

loadSettings();
