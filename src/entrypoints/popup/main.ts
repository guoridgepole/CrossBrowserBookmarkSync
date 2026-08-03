const statusEl = document.getElementById('status')!;
const lastSyncEl = document.getElementById('last-sync')!;
const syncBtn = document.getElementById('sync-btn') as HTMLButtonElement;
const optionsBtn = document.getElementById('options-btn')!;

// Get current status on load
browser.runtime.sendMessage({ type: 'GET_STATUS' }).then((response: any) => {
  if (response) {
    statusEl.textContent = response.state ?? 'IDLE';
    statusEl.title = '';
    if (response.state === 'ERROR' && response.lastError) {
      statusEl.textContent = `Error: ${response.lastError}`;
      statusEl.title = response.lastError;
    }
    if (response.lastSyncTime) {
      lastSyncEl.textContent = `Last sync: ${new Date(response.lastSyncTime).toLocaleString()}`;
    }
  }
});

// Trigger manual sync
syncBtn.addEventListener('click', () => {
  syncBtn.disabled = true;
  statusEl.textContent = 'Syncing...';
  statusEl.title = '';

  browser.runtime.sendMessage({ type: 'TRIGGER_SYNC' }).then((response: any) => {
    if (response?.status === 'ok') {
      statusEl.textContent = 'Sync complete';
      statusEl.title = '';
    } else {
      const detail = response?.message ?? 'Unknown error';
      statusEl.textContent = `Sync failed: ${detail}`;
      statusEl.title = detail;
      console.error('[BookmarkSync] Sync failed:', detail);
    }
    syncBtn.disabled = false;
  }).catch((err: unknown) => {
    statusEl.textContent = `Sync failed: ${err}`;
    statusEl.title = String(err);
    syncBtn.disabled = false;
  });
});

// Open options page
optionsBtn.addEventListener('click', () => {
  browser.runtime.openOptionsPage();
});
