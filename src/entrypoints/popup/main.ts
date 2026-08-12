import { initI18n, initLanguageSelect, t } from '@/utils/i18n';

const languageSelect = document.getElementById('language-select') as HTMLSelectElement;
const statusEl = document.getElementById('status')!;
const lastSyncEl = document.getElementById('last-sync')!;
const syncBtn = document.getElementById('sync-btn') as HTMLButtonElement;
const optionsBtn = document.getElementById('options-btn')!;
const conflictBadge = document.getElementById('conflict-badge')!;
const conflictCountEl = document.getElementById('conflict-count')!;

// Render the sync status reported by the background worker (translated).
function renderStatus(response: any): void {
  const state = response?.state ?? 'IDLE';
  statusEl.textContent = t(`state.${state}`);
  statusEl.title = '';
  if (state === 'ERROR' && response.lastError) {
    statusEl.textContent = t('popup.error', { detail: response.lastError });
    statusEl.title = response.lastError;
  }
  if (response.lastSyncTime) {
    lastSyncEl.textContent = t('popup.lastSync', {
      time: new Date(response.lastSyncTime).toLocaleString(),
    });
  }
}

// Fetch the current status from the background worker.
function refreshStatus(): void {
  browser.runtime
    .sendMessage({ type: 'GET_STATUS' })
    .then((response: any) => {
      if (response) renderStatus(response);
    })
    .catch(() => {
      // Background unavailable; keep the initial idle text.
    });
}

// Show a badge when there are unresolved merge conflicts.
function loadConflictBadge(): void {
  browser.runtime
    .sendMessage({ type: 'GET_CONFLICTS' })
    .then((response: any) => {
      const conflicts = (response?.conflicts ?? []).filter((c: any) => !c.resolved);
      if (conflicts.length > 0) {
        conflictCountEl.textContent = String(conflicts.length);
        conflictBadge.classList.remove('hidden');
      } else {
        conflictBadge.classList.add('hidden');
      }
    })
    .catch(() => {
      // Background unavailable; leave badge hidden.
    });
}

// Clicking the badge opens the options page to review conflicts.
conflictBadge.addEventListener('click', () => {
  browser.runtime.openOptionsPage();
});

// Trigger manual sync
syncBtn.addEventListener('click', () => {
  syncBtn.disabled = true;
  statusEl.textContent = t('popup.syncing');
  statusEl.title = '';

  browser.runtime.sendMessage({ type: 'TRIGGER_SYNC' }).then((response: any) => {
    if (response?.status === 'ok') {
      statusEl.textContent = t('popup.syncComplete');
      statusEl.title = '';
      loadConflictBadge();
    } else {
      const detail = response?.message ?? t('common.unknownError');
      statusEl.textContent = t('popup.syncFailed', { detail });
      statusEl.title = detail;
      console.error('[CrossBrowserBookmarkSync] Sync failed:', detail);
    }
    syncBtn.disabled = false;
  }).catch((err: unknown) => {
    statusEl.textContent = t('popup.syncFailed', { detail: String(err) });
    statusEl.title = String(err);
    syncBtn.disabled = false;
  });
});

// Open options page
optionsBtn.addEventListener('click', () => {
  browser.runtime.openOptionsPage();
});

// Initialize i18n first (detects the system language on first launch),
// then wire up the language selector and load live data.
async function init(): Promise<void> {
  await initI18n();
  await initLanguageSelect(languageSelect, () => {
    // Re-render dynamic content in the newly selected language.
    refreshStatus();
    loadConflictBadge();
  });
  refreshStatus();
  loadConflictBadge();
}
void init();
