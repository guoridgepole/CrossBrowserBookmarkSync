/**
 * Sync engine: orchestrates the full sync flow.
 * State machine: IDLE → READING_LOCAL → DOWNLOADING → MERGING → UPLOADING → WRITING_LOCAL → DONE
 */

import type { BookmarkNode, SyncSnapshot, SyncStatus } from '@/core/types';
import { SyncError } from '@/core/types';
import { readBookmarkTree } from '@/browser/bookmark-reader';
import { applyTree } from '@/browser/bookmark-writer';
import { createStorageBackend } from '@/storage/factory';
import { mergeTrees, deduplicateTree } from '@/core/merge';
import { computeSnapshotChecksum } from '@/core/checksum';
import { isForceOverride } from '@/core/override';
import { acquireLock, releaseLock } from './mutex';
import { getSettings, saveSettings, getBaseSnapshot, saveBaseSnapshot, saveSyncStatus, appendConflicts } from '@/config/store';
import { isEncryptionSetup } from '@/config/key-manager';
import { syncKeepAlive, markSyncInProgress } from '@/platform/sw-lifecycle';
import { logger } from '@/utils/logger';

export type SyncTrigger = 'manual' | 'auto' | 'change';

/**
 * Run a full sync cycle.
 */
export async function runSync(trigger: SyncTrigger): Promise<void> {
  const lockAcquired = await acquireLock(trigger);
  if (!lockAcquired) {
    logger.info('Sync already in progress, skipping');
    return;
  }

  try {
    // Keep SW alive during long sync operations
    syncKeepAlive.start();
    await markSyncInProgress(true);

    await updateStatus('READING_LOCAL');
    logger.info(`Sync started (trigger: ${trigger})`);

    // Step 1: Read local bookmarks
    const localTree = await readBookmarkTree();
    logger.info(`Local tree read: ${countNodes(localTree)} nodes`);

    // Step 2: Load settings and create storage backend
    const settings = await getSettings();
    if (!settings) {
      throw new SyncError('No storage backend configured', 'NO_CONFIG');
    }

    // Reconcile encryption state: if a key is persisted but the settings flag
    // was not updated (race between initEncryption and saveSettings during
    // setup, or an interrupted flow), auto-correct so sync can decrypt remote.
    if (settings.encryption?.enabled !== false && await isEncryptionSetup()) {
      if (!settings.encryption?.enabled) {
        settings.encryption = { enabled: true };
        await saveSettings(settings);
        logger.info('Reconciled encryption flag: key exists, enabling in settings');
      }
    }

    const backend = await createStorageBackend(settings);

    // Step 3: Download remote snapshot
    await updateStatus('DOWNLOADING');
    const remoteSnapshot = await backend.download();

    // Step 4: Determine merge strategy
    let mergedTree: BookmarkNode[];
    let newRevision: number;

    if (!remoteSnapshot) {
      // First sync: no remote data, just upload local
      logger.info('No remote data found, uploading local tree');
      mergedTree = localTree;
      newRevision = 1;
    } else if (isForceOverride(remoteSnapshot, settings.deviceId)) {
      // Remote has a force-override from another device
      logger.info('Remote force-override detected, adopting remote tree');
      mergedTree = remoteSnapshot.tree;
      newRevision = remoteSnapshot.revision;

      // Write remote tree to local browser
      await updateStatus('WRITING_LOCAL');
      await applyTree(mergedTree);
    } else {
      // Normal merge
      await updateStatus('MERGING');
      const baseTree = await getBaseSnapshot();
      const mergeResult = mergeTrees(localTree, remoteSnapshot.tree, baseTree);
      mergedTree = deduplicateTree(mergeResult.tree);
      newRevision = Math.max(remoteSnapshot.revision, 0) + 1;

      // Record true conflicts (non-blocking) for later user review.
      if (mergeResult.conflicts.length > 0) {
        await appendConflicts(mergeResult.conflicts);
        logger.info(`Recorded ${mergeResult.conflicts.length} conflict(s) for review`);
      }
      logger.info(`Merge complete: ${countNodes(mergedTree)} nodes, revision ${newRevision}`);
    }

    // Step 5: Create and upload new snapshot
    await updateStatus('UPLOADING');
    const snapshot = await createSnapshot(mergedTree, settings.deviceId, newRevision);
    await backend.upload(snapshot);
    logger.info('Snapshot uploaded successfully');

    // Step 6: Write merged tree to local browser (if changed)
    if (remoteSnapshot && !isForceOverride(remoteSnapshot, settings.deviceId)) {
      await updateStatus('WRITING_LOCAL');
      await applyTree(mergedTree);
      logger.info('Local bookmarks updated');
    }

    // Step 7: Save base snapshot for next merge
    await saveBaseSnapshot(mergedTree);

    // Done
    await updateStatus('DONE', null, newRevision);
    logger.info('Sync completed successfully');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Sync failed: ${message}`);
    await updateStatus('ERROR', message);
    throw error;
  } finally {
    syncKeepAlive.stop();
    await markSyncInProgress(false).catch(() => {});
    await releaseLock();
  }
}

/**
 * Create a SyncSnapshot from a tree.
 */
async function createSnapshot(
  tree: BookmarkNode[],
  deviceId: string,
  revision: number,
): Promise<SyncSnapshot> {
  const partial = {
    version: 1 as const,
    revision,
    deviceId,
    timestamp: Date.now(),
    tree,
  };

  const checksum = await computeSnapshotChecksum(partial);
  return { ...partial, checksum };
}

/**
 * Count total nodes in a tree (recursive).
 */
function countNodes(tree: BookmarkNode[]): number {
  let count = 0;
  for (const node of tree) {
    count++;
    if (node.children) {
      count += countNodes(node.children);
    }
  }
  return count;
}

/**
 * Update sync status in storage.
 */
async function updateStatus(
  state: SyncStatus['state'],
  error?: string | null,
  revision?: number,
): Promise<void> {
  const status: SyncStatus = {
    state,
    lastSyncTime: state === 'DONE' ? Date.now() : undefined as any,
    lastError: error ?? null,
    lastSyncRevision: revision ?? null,
  };

  // Preserve lastSyncTime if not DONE
  if (state !== 'DONE') {
    const existing = await browser.storage.local.get('bmsync_status');
    const prev = existing['bmsync_status'] as SyncStatus | undefined;
    status.lastSyncTime = prev?.lastSyncTime ?? null;
    status.lastSyncRevision = prev?.lastSyncRevision ?? null;
  }

  await saveSyncStatus(status);
}
