const statusEl = document.getElementById('status')!;
const lastSyncEl = document.getElementById('last-sync')!;
const syncBtn = document.getElementById('sync-btn') as HTMLButtonElement;
const optionsBtn = document.getElementById('options-btn')!;
const conflictBadge = document.getElementById('conflict-badge')!;
const conflictCountEl = document.getElementById('conflict-count')!;

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
loadConflictBadge();

// Clicking the badge opens the options page to review conflicts.
conflictBadge.addEventListener('click', () => {
  browser.runtime.openOptionsPage();
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
      loadConflictBadge();
    } else {
      const detail = response?.message ?? 'Unknown error';
      statusEl.textContent = `Sync failed: ${detail}`;
      statusEl.title = detail;
      console.error('[CrossBrowserBookmarkSync] Sync failed:', detail);
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
