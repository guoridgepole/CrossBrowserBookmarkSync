/**
 * Lightweight i18n for the popup and options pages.
 *
 * The chosen language is persisted in chrome.storage.local. On first launch
 * (no stored language yet) it defaults to the system language via
 * navigator.language: any "zh" variant maps to Chinese, everything else
 * falls back to English.
 */

export type Language = 'en' | 'zh';

const LANGUAGE_KEY = 'bmsync_language';

/** Translation dictionaries keyed by language. */
const messages: Record<Language, Record<string, string>> = {
  en: {
    'lang.label': 'Language',

    // Sync states (popup status line)
    'state.IDLE': 'Idle',
    'state.READING_LOCAL': 'Reading local bookmarks',
    'state.DOWNLOADING': 'Downloading',
    'state.MERGING': 'Merging',
    'state.UPLOADING': 'Uploading',
    'state.WRITING_LOCAL': 'Writing local bookmarks',
    'state.DONE': 'Done',
    'state.ERROR': 'Error',

    // Popup
    'popup.error': 'Error: {detail}',
    'popup.lastSync': 'Last sync: {time}',
    'popup.conflictText': 'conflict(s) need review',
    'popup.syncNow': 'Sync Now',
    'popup.settings': 'Settings',
    'popup.syncing': 'Syncing...',
    'popup.syncComplete': 'Sync complete',
    'popup.syncFailed': 'Sync failed: {detail}',

    // Options page (static markup)
    'options.title': 'CrossBrowserBookmarkSync - Settings',
    'options.h1': 'CrossBrowserBookmarkSync Settings',
    'options.storageBackend': 'Storage Backend',
    'options.backendType': 'Backend Type',
    'options.webdavUrl': 'WebDAV URL',
    'options.username': 'Username',
    'options.password': 'Password',
    'options.s3Endpoint': 'Endpoint URL',
    'options.s3Bucket': 'Bucket',
    'options.s3Region': 'Region',
    'options.s3AccessKey': 'Access Key ID',
    'options.s3SecretKey': 'Secret Access Key',
    'options.pathStyle':
      'Path-style endpoint (enable for MinIO / self-hosted; leave off for AWS, Tencent COS, Cloudflare R2)',
    'options.syncSchedule': 'Sync Schedule',
    'options.syncInterval': 'Sync Interval',
    'options.interval5': 'Every 5 minutes',
    'options.interval15': 'Every 15 minutes',
    'options.interval30': 'Every 30 minutes',
    'options.interval60': 'Every hour',
    'options.interval360': 'Every 6 hours',
    'options.interval720': 'Every 12 hours',
    'options.interval1440': 'Every 24 hours',
    'options.encryption': 'Encryption',
    'options.encryptionHint':
      'Encrypt bookmarks end-to-end before uploading, so your storage provider only ever sees ciphertext. All devices must use the same master password.',
    'options.masterPassword': 'Master Password',
    'options.confirmPassword': 'Confirm Password',
    'options.enableEncryption': 'Enable Encryption',
    'options.encryptionEnabled': 'Encryption is enabled on this device.',
    'options.currentPassword': 'Current Password',
    'options.newPassword': 'New Password',
    'options.changePassword': 'Change Password',
    'options.disableEncryption': 'Disable Encryption',
    'options.conflicts': 'Conflicts',
    'options.conflictsHint':
      'When the same bookmark is edited on two devices before they sync, the newer edit wins automatically and the conflict is listed here for review.',
    'options.noConflicts': 'No unresolved conflicts.',
    'options.testConnection': 'Test Connection',
    'options.saveSettings': 'Save Settings',

    // Input placeholders
    'ph.username': 'username',
    'ph.password': 'password',
    'ph.masterPassword': 'master password',
    'ph.repeatPassword': 'repeat password',
    'ph.currentPassword': 'current password',
    'ph.newPassword': 'new password',

    // Options page (dynamic messages)
    'msg.webdavUrlRequired': 'Please enter a WebDAV URL',
    'msg.s3Required': 'Please enter S3 bucket and access key',
    'msg.hostPermissionDenied':
      'Host permission denied. The extension cannot reach your storage without it.',
    'msg.permissionFailed': 'Permission request failed: {detail}',
    'msg.settingsSaved': 'Settings saved! Periodic sync schedule updated.',
    'msg.testing': 'Testing connection...',
    'msg.connectionOk': 'Connection successful!',
    'msg.connectionFailed': 'Connection failed: {detail}',
    'msg.connectionError': 'Connection test error: {detail}',
    'msg.masterPasswordRequired': 'Please enter a master password',
    'msg.passwordMismatch': 'Passwords do not match',
    'msg.backendRequired':
      'Please fill in the storage backend above before enabling encryption.',
    'msg.enablingEncryption': 'Enabling encryption...',
    'msg.encryptionEnabled': 'Encryption enabled. Remote data is now encrypted.',
    'msg.enableEncryptionFailed': 'Failed to enable encryption: {detail}',
    'msg.encryptionError': 'Encryption error: {detail}',
    'msg.disablingEncryption': 'Disabling encryption...',
    'msg.encryptionDisabled':
      'Encryption disabled. Remote data is now stored in plaintext.',
    'msg.disableEncryptionFailed': 'Failed to disable encryption: {detail}',
    'msg.newPasswordRequired': 'Please enter a new password',
    'msg.changingPassword': 'Changing password...',
    'msg.passwordChanged':
      'Master password changed and remote data re-encrypted.',
    'msg.changePasswordFailed': 'Failed to change password: {detail}',

    // Conflict review
    'conflict.untitled': '(untitled)',
    'conflict.local': 'local',
    'conflict.remote': 'remote',
    'conflict.localPanel': 'Local',
    'conflict.remotePanel': 'Remote',
    'conflict.keeping': 'Currently keeping the {choice} version.',
    'conflict.keepLocal': 'Keep Local',
    'conflict.keepRemote': 'Keep Remote',
    'conflict.resolving': 'Resolving conflict (keeping {choice})...',
    'conflict.resolved':
      'Conflict resolved. The {choice} version was kept and is syncing.',
    'conflict.resolveFailed': 'Failed to resolve conflict: {detail}',
    'conflict.resolveError': 'Resolve error: {detail}',

    'common.unknownError': 'Unknown error',
  },

  zh: {
    'lang.label': '语言',

    'state.IDLE': '空闲',
    'state.READING_LOCAL': '正在读取本地书签',
    'state.DOWNLOADING': '正在下载',
    'state.MERGING': '正在合并',
    'state.UPLOADING': '正在上传',
    'state.WRITING_LOCAL': '正在写入本地书签',
    'state.DONE': '完成',
    'state.ERROR': '错误',

    'popup.error': '错误：{detail}',
    'popup.lastSync': '上次同步：{time}',
    'popup.conflictText': '个冲突待处理',
    'popup.syncNow': '立即同步',
    'popup.settings': '设置',
    'popup.syncing': '同步中...',
    'popup.syncComplete': '同步完成',
    'popup.syncFailed': '同步失败：{detail}',

    'options.title': 'CrossBrowserBookmarkSync - 设置',
    'options.h1': 'CrossBrowserBookmarkSync 设置',
    'options.storageBackend': '存储后端',
    'options.backendType': '后端类型',
    'options.webdavUrl': 'WebDAV 地址',
    'options.username': '用户名',
    'options.password': '密码',
    'options.s3Endpoint': '服务端点 URL',
    'options.s3Bucket': '存储桶（Bucket）',
    'options.s3Region': '区域（Region）',
    'options.s3AccessKey': 'Access Key ID',
    'options.s3SecretKey': 'Secret Access Key',
    'options.pathStyle':
      'Path-style 端点（MinIO / 自建存储需开启；AWS、腾讯 COS、Cloudflare R2 请保持关闭）',
    'options.syncSchedule': '同步计划',
    'options.syncInterval': '同步间隔',
    'options.interval5': '每 5 分钟',
    'options.interval15': '每 15 分钟',
    'options.interval30': '每 30 分钟',
    'options.interval60': '每小时',
    'options.interval360': '每 6 小时',
    'options.interval720': '每 12 小时',
    'options.interval1440': '每 24 小时',
    'options.encryption': '加密',
    'options.encryptionHint':
      '上传前对书签进行端到端加密，存储服务商只能看到密文。所有设备必须使用相同的主密码。',
    'options.masterPassword': '主密码',
    'options.confirmPassword': '确认密码',
    'options.enableEncryption': '启用加密',
    'options.encryptionEnabled': '本设备已启用加密。',
    'options.currentPassword': '当前密码',
    'options.newPassword': '新密码',
    'options.changePassword': '修改密码',
    'options.disableEncryption': '停用加密',
    'options.conflicts': '冲突',
    'options.conflictsHint':
      '当同一书签在同步前被两台设备分别修改时，较新的修改会自动保留，冲突会列在这里供你复核。',
    'options.noConflicts': '没有未解决的冲突。',
    'options.testConnection': '测试连接',
    'options.saveSettings': '保存设置',

    'ph.username': '用户名',
    'ph.password': '密码',
    'ph.masterPassword': '主密码',
    'ph.repeatPassword': '再次输入密码',
    'ph.currentPassword': '当前密码',
    'ph.newPassword': '新密码',

    'msg.webdavUrlRequired': '请输入 WebDAV 地址',
    'msg.s3Required': '请输入 S3 存储桶和访问密钥',
    'msg.hostPermissionDenied': '主机权限被拒绝。没有该权限，扩展无法访问你的存储。',
    'msg.permissionFailed': '权限请求失败：{detail}',
    'msg.settingsSaved': '设置已保存！定时同步计划已更新。',
    'msg.testing': '正在测试连接...',
    'msg.connectionOk': '连接成功！',
    'msg.connectionFailed': '连接失败：{detail}',
    'msg.connectionError': '连接测试出错：{detail}',
    'msg.masterPasswordRequired': '请输入主密码',
    'msg.passwordMismatch': '两次输入的密码不一致',
    'msg.backendRequired': '请先在上方填写存储后端配置，再启用加密。',
    'msg.enablingEncryption': '正在启用加密...',
    'msg.encryptionEnabled': '加密已启用。远端数据现在已加密。',
    'msg.enableEncryptionFailed': '启用加密失败：{detail}',
    'msg.encryptionError': '加密操作出错：{detail}',
    'msg.disablingEncryption': '正在停用加密...',
    'msg.encryptionDisabled': '加密已停用。远端数据现在以明文存储。',
    'msg.disableEncryptionFailed': '停用加密失败：{detail}',
    'msg.newPasswordRequired': '请输入新密码',
    'msg.changingPassword': '正在修改密码...',
    'msg.passwordChanged': '主密码已修改，远端数据已重新加密。',
    'msg.changePasswordFailed': '修改密码失败：{detail}',

    'conflict.untitled': '（无标题）',
    'conflict.local': '本地',
    'conflict.remote': '远程',
    'conflict.localPanel': '本地',
    'conflict.remotePanel': '远程',
    'conflict.keeping': '当前保留的是{choice}版本。',
    'conflict.keepLocal': '保留本地',
    'conflict.keepRemote': '保留远程',
    'conflict.resolving': '正在解决冲突（保留{choice}版本）...',
    'conflict.resolved': '冲突已解决。已保留{choice}版本并正在同步。',
    'conflict.resolveFailed': '解决冲突失败：{detail}',
    'conflict.resolveError': '解决冲突时出错：{detail}',

    'common.unknownError': '未知错误',
  },
};

/** In-memory cache of the active language for the current page. */
let currentLanguage: Language | null = null;

/**
 * Guess the UI language from the browser/system locale.
 * Any "zh" variant (zh-CN, zh-TW, ...) maps to Chinese; otherwise English.
 */
export function detectSystemLanguage(): Language {
  const lang = (navigator.languages?.[0] ?? navigator.language ?? 'en').toLowerCase();
  return lang.startsWith('zh') ? 'zh' : 'en';
}

/**
 * Get the active language. On first run (nothing stored yet) it is derived
 * from the system language and persisted.
 */
export async function getLanguage(): Promise<Language> {
  if (currentLanguage) return currentLanguage;

  try {
    const result = await browser.storage.local.get(LANGUAGE_KEY);
    const stored = result[LANGUAGE_KEY];
    if (stored === 'en' || stored === 'zh') {
      currentLanguage = stored;
      return currentLanguage;
    }
  } catch {
    // Storage unavailable (e.g. in tests); fall through to detection.
  }

  currentLanguage = detectSystemLanguage();
  try {
    await browser.storage.local.set({ [LANGUAGE_KEY]: currentLanguage });
  } catch {
    // Best-effort persistence; detection still works next time.
  }
  return currentLanguage;
}

/** Persist a user-selected language. */
export async function setLanguage(lang: Language): Promise<void> {
  currentLanguage = lang;
  await browser.storage.local.set({ [LANGUAGE_KEY]: lang });
}

/**
 * Translate a key, interpolating `{name}` placeholders from `params`.
 * Falls back to English, then to the raw key.
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const lang = currentLanguage ?? 'en';
  const template = messages[lang][key] ?? messages.en[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    params[name] !== undefined ? String(params[name]) : match,
  );
}

/**
 * Apply translations to the current document. Elements opt in via:
 * - data-i18n="key"             → textContent
 * - data-i18n-placeholder="key" → placeholder attribute
 * - data-i18n-title="key"       → title attribute
 */
export function applyI18n(): void {
  document.documentElement.lang = currentLanguage === 'zh' ? 'zh-CN' : 'en';

  for (const el of document.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.getAttribute('data-i18n')!);
  }
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n-placeholder]')) {
    el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')!));
  }
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n-title]')) {
    el.setAttribute('title', t(el.getAttribute('data-i18n-title')!));
  }
}

/** Load the language (detecting it on first run) and translate the page. */
export async function initI18n(): Promise<Language> {
  const lang = await getLanguage();
  applyI18n();
  return lang;
}

/**
 * Wire up a language <select>: reflects the current language, persists
 * changes, re-translates the page and invokes `onChanged` so the page can
 * refresh any dynamically rendered content.
 */
export async function initLanguageSelect(
  select: HTMLSelectElement,
  onChanged?: () => void | Promise<void>,
): Promise<void> {
  select.value = await getLanguage();
  select.addEventListener('change', async () => {
    const next = select.value as Language;
    if (next === currentLanguage) return;
    await setLanguage(next);
    applyI18n();
    await onChanged?.();
  });
}
