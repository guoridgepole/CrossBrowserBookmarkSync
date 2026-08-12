/**
 * Options page logic: backend configuration, sync interval, connection test.
 */

import type { AppSettings, BackendType, BookmarkNode, SyncConflict } from '@/core/types';
import { getSettings, saveSettings } from '@/config/store';
import { getRequiredOrigins } from '@/storage/origins';
import { initI18n, initLanguageSelect, t } from '@/utils/i18n';

const languageSelect = document.getElementById('language-select') as HTMLSelectElement;
const backendType = document.getElementById('backend-type') as HTMLSelectElement;
const webdavConfig = document.getElementById('webdav-config')!;
const s3Config = document.getElementById('s3-config')!;
const saveBtn = document.getElementById('save-btn')!;
const testBtn = document.getElementById('test-btn')!;
const messageEl = document.getElementById('message')!;

// Encryption elements
const encryptionOff = document.getElementById('encryption-off')!;
const encryptionOn = document.getElementById('encryption-on')!;
const enableEncryptionBtn = document.getElementById('enable-encryption-btn')!;
const disableEncryptionBtn = document.getElementById('disable-encryption-btn')!;
const changePasswordBtn = document.getElementById('change-password-btn')!;
const encInputs = {
  password: document.getElementById('enc-password') as HTMLInputElement,
  passwordConfirm: document.getElementById('enc-password-confirm') as HTMLInputElement,
  oldPassword: document.getElementById('enc-old-password') as HTMLInputElement,
  newPassword: document.getElementById('enc-new-password') as HTMLInputElement,
};

function renderEncryptionState(enabled: boolean): void {
  encryptionOff.classList.toggle('hidden', enabled);
  encryptionOn.classList.toggle('hidden', !enabled);
}

// Conflicts elements
const conflictsEmpty = document.getElementById('conflicts-empty')!;
const conflictsList = document.getElementById('conflicts-list')!;

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

  renderEncryptionState(settings.encryption?.enabled ?? false);
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
    return t('msg.webdavUrlRequired');
  }
  if (type === 's3' && (!inputs.s3Bucket.value.trim() || !inputs.s3AccessKey.value.trim())) {
    return t('msg.s3Required');
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
      showMessage(t('msg.hostPermissionDenied'), 'error');
    }
    return granted;
  } catch (err) {
    showMessage(t('msg.permissionFailed', { detail: String(err) }), 'error');
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
  // Preserve the existing deviceId and encryption flag across saves.
  // The form has no encryption inputs; dropping this field would silently
  // wipe the flag while the persisted key remains, causing the sync engine's
  // reconcile logic to re-enable encryption behind the user's back.
  const existing = await getSettings();
  const settings: AppSettings = {
    ...formSettings,
    deviceId: existing?.deviceId ?? formSettings.deviceId,
    encryption: existing?.encryption,
  };
  await saveSettings(settings);
  showMessage(t('msg.settingsSaved'), 'success');
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

  showMessage(t('msg.testing'), 'info');
  testBtn.setAttribute('disabled', 'true');

  try {
    const response = (await browser.runtime.sendMessage({
      type: 'TEST_CONNECTION',
      config: formSettings,
    })) as { success?: boolean; error?: string } | undefined;
    if (response?.success) {
      showMessage(t('msg.connectionOk'), 'success');
    } else {
      showMessage(
        t('msg.connectionFailed', { detail: response?.error ?? t('common.unknownError') }),
        'error',
      );
    }
  } catch (err) {
    showMessage(t('msg.connectionError', { detail: String(err) }), 'error');
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

// --- Encryption management ---

enableEncryptionBtn.addEventListener('click', async () => {
  const password = encInputs.password.value;
  const confirm = encInputs.passwordConfirm.value;
  if (!password) {
    showMessage(t('msg.masterPasswordRequired'), 'error');
    return;
  }
  if (password !== confirm) {
    showMessage(t('msg.passwordMismatch'), 'error');
    return;
  }

  // Encryption operates on the SAVED backend. If nothing is saved yet, persist
  // the current form first so the background worker can build a storage backend.
  if (!(await getSettings())) {
    const formSettings = readFormSettings();
    if (typeof formSettings === 'string') {
      showMessage(t('msg.backendRequired'), 'error');
      return;
    }
    if (!(await ensureHostPermissions(getRequiredOrigins(formSettings)))) {
      return;
    }
    await saveSettings(formSettings);
  }

  enableEncryptionBtn.setAttribute('disabled', 'true');
  showMessage(t('msg.enablingEncryption'), 'info');
  try {
    const response = (await browser.runtime.sendMessage({
      type: 'SETUP_ENCRYPTION',
      password,
    })) as { success?: boolean; error?: string } | undefined;
    if (response?.success) {
      showMessage(t('msg.encryptionEnabled'), 'success');
      encInputs.password.value = '';
      encInputs.passwordConfirm.value = '';
      renderEncryptionState(true);
    } else {
      showMessage(
        t('msg.enableEncryptionFailed', {
          detail: response?.error ?? t('common.unknownError'),
        }),
        'error',
      );
    }
  } catch (err) {
    showMessage(t('msg.encryptionError', { detail: String(err) }), 'error');
  } finally {
    enableEncryptionBtn.removeAttribute('disabled');
  }
});

disableEncryptionBtn.addEventListener('click', async () => {
  disableEncryptionBtn.setAttribute('disabled', 'true');
  showMessage(t('msg.disablingEncryption'), 'info');
  try {
    const response = (await browser.runtime.sendMessage({
      type: 'DISABLE_ENCRYPTION',
    })) as { success?: boolean; error?: string } | undefined;
    if (response?.success) {
      showMessage(t('msg.encryptionDisabled'), 'success');
      encInputs.oldPassword.value = '';
      encInputs.newPassword.value = '';
      renderEncryptionState(false);
    } else {
      showMessage(
        t('msg.disableEncryptionFailed', {
          detail: response?.error ?? t('common.unknownError'),
        }),
        'error',
      );
    }
  } catch (err) {
    showMessage(t('msg.encryptionError', { detail: String(err) }), 'error');
  } finally {
    disableEncryptionBtn.removeAttribute('disabled');
  }
});

changePasswordBtn.addEventListener('click', async () => {
  const oldPassword = encInputs.oldPassword.value;
  const newPassword = encInputs.newPassword.value;
  if (!newPassword) {
    showMessage(t('msg.newPasswordRequired'), 'error');
    return;
  }
  changePasswordBtn.setAttribute('disabled', 'true');
  showMessage(t('msg.changingPassword'), 'info');
  try {
    const response = (await browser.runtime.sendMessage({
      type: 'CHANGE_PASSWORD',
      oldPassword,
      newPassword,
    })) as { success?: boolean; error?: string } | undefined;
    if (response?.success) {
      showMessage(t('msg.passwordChanged'), 'success');
      encInputs.oldPassword.value = '';
      encInputs.newPassword.value = '';
    } else {
      showMessage(
        t('msg.changePasswordFailed', {
          detail: response?.error ?? t('common.unknownError'),
        }),
        'error',
      );
    }
  } catch (err) {
    showMessage(t('msg.encryptionError', { detail: String(err) }), 'error');
  } finally {
    changePasswordBtn.removeAttribute('disabled');
  }
});

// Initialize i18n first (detects the system language on first launch),
// then wire up the language selector and load page data.
async function init(): Promise<void> {
  await initI18n();
  await initLanguageSelect(languageSelect, () => {
    // Re-render dynamic content in the newly selected language.
    loadConflicts();
  });
  loadSettings();
  loadConflicts();
}
void init();

// --- Conflict review ---

/**
 * Fetch unresolved conflicts from the background worker and render them.
 */
async function loadConflicts(): Promise<void> {
  try {
    const response = (await browser.runtime.sendMessage({ type: 'GET_CONFLICTS' })) as
      | { status?: string; conflicts?: SyncConflict[] }
      | undefined;
    const conflicts = (response?.conflicts ?? []).filter((c) => !c.resolved);
    renderConflicts(conflicts);
  } catch (err) {
    // Background may be unavailable; leave the section in its default state.
    console.error('Failed to load conflicts:', err);
  }
}

function renderConflicts(conflicts: SyncConflict[]): void {
  conflictsList.innerHTML = '';
  conflictsEmpty.classList.toggle('hidden', conflicts.length > 0);

  for (const conflict of conflicts) {
    const card = document.createElement('div');
    card.className = 'conflict-card';

    const heading = document.createElement('div');
    heading.className = 'conflict-title';
    heading.textContent = conflict.title || t('conflict.untitled');
    card.appendChild(heading);

    const versions = document.createElement('div');
    versions.className = 'conflict-versions';
    versions.appendChild(versionBox(t('conflict.localPanel'), conflict.local));
    versions.appendChild(versionBox(t('conflict.remotePanel'), conflict.remote));
    card.appendChild(versions);

    const autoNote = document.createElement('div');
    autoNote.className = 'hint';
    autoNote.textContent = t('conflict.keeping', {
      choice: t(`conflict.${conflict.autoChosen}`),
    });
    card.appendChild(autoNote);

    const actions = document.createElement('div');
    actions.className = 'actions';

    const keepLocal = document.createElement('button');
    keepLocal.className = 'btn-secondary';
    keepLocal.textContent = t('conflict.keepLocal');
    keepLocal.addEventListener('click', () => resolveConflictUI(conflict.stableId, 'local'));

    const keepRemote = document.createElement('button');
    keepRemote.className = 'btn-secondary';
    keepRemote.textContent = t('conflict.keepRemote');
    keepRemote.addEventListener('click', () => resolveConflictUI(conflict.stableId, 'remote'));

    actions.appendChild(keepLocal);
    actions.appendChild(keepRemote);
    card.appendChild(actions);

    conflictsList.appendChild(card);
  }
}

/** Build a small panel showing one version (title + url) of a conflict. */
function versionBox(label: string, node: BookmarkNode): HTMLDivElement {
  const box = document.createElement('div');
  box.className = 'conflict-version';

  const strong = document.createElement('strong');
  strong.textContent = label;
  box.appendChild(strong);
  box.appendChild(document.createElement('br'));
  box.appendChild(document.createTextNode(node.title || t('conflict.untitled')));

  if (node.url) {
    box.appendChild(document.createElement('br'));
    const urlSpan = document.createElement('span');
    urlSpan.className = 'conflict-url';
    urlSpan.textContent = node.url;
    box.appendChild(urlSpan);
  }
  return box;
}

async function resolveConflictUI(
  stableId: string,
  choice: 'local' | 'remote',
): Promise<void> {
  const choiceLabel = t(`conflict.${choice}`);
  showMessage(t('conflict.resolving', { choice: choiceLabel }), 'info');
  try {
    const response = (await browser.runtime.sendMessage({
      type: 'RESOLVE_CONFLICT',
      stableId,
      choice,
    })) as { success?: boolean; error?: string } | undefined;
    if (response?.success) {
      showMessage(t('conflict.resolved', { choice: choiceLabel }), 'success');
      await loadConflicts();
    } else {
      showMessage(
        t('conflict.resolveFailed', { detail: response?.error ?? t('common.unknownError') }),
        'error',
      );
    }
  } catch (err) {
    showMessage(t('conflict.resolveError', { detail: String(err) }), 'error');
  }
}
