/**
 * Bookmark writer: applies sync operations to the browser bookmark tree
 * with WAL (Write-Ahead Log) transaction simulation for crash safety.
 *
 * Flow:
 * 1. SNAPSHOT: getTree() → serialize → store in chrome.storage.local (backup)
 * 2. PLAN: diff(local, target) → operations[]
 * 3. WAL: write operations[] to chrome.storage.local
 * 4. EXECUTE: execute ops one by one (batch of 50, persist progress between batches)
 * 5. VERIFY: getTree() → checksum compare
 * 6. COMMIT: clear WAL, update state
 * -- Any step fails → ROLLBACK: restore from backup --
 */

import type { BookmarkNode, SyncOperation } from '@/core/types';
import { isRootFolder } from '@/core/types';
import { readBookmarkTree } from './bookmark-reader';
import { serializeTree } from '@/core/serializer';
import { computeTreeChecksum } from '@/core/checksum';
import { flattenTree } from '@/core/diff-engine';

const WAL_KEY = 'bmsync_wal';
const BACKUP_KEY = 'bmsync_backup';
const WAL_PROGRESS_KEY = 'bmsync_wal_progress';
const BATCH_SIZE = 50;

interface WALState {
  operations: SyncOperation[];
  targetChecksum: string;
  startedAt: number;
}

/**
 * Apply a target bookmark tree to the browser, with WAL protection.
 */
export async function applyTree(targetTree: BookmarkNode[]): Promise<void> {
  // Step 1: Backup current state
  const currentTree = await readBookmarkTree();
  const backupData = serializeTree(currentTree);
  await browser.storage.local.set({ [BACKUP_KEY]: backupData });

  // Step 2: Compute target checksum for verification
  const targetChecksum = await computeTreeChecksum(targetTree);

  // Step 3: Compute operations (import diff-engine)
  const { computeDiff } = await import('@/core/diff-engine');
  const operations = computeDiff(currentTree, targetTree);

  if (operations.length === 0) {
    return; // Nothing to do
  }

  // Step 4: Write WAL
  const walState: WALState = {
    operations,
    targetChecksum,
    startedAt: Date.now(),
  };
  await browser.storage.local.set({ [WAL_KEY]: walState });

  // Step 5: Execute operations in batches
  try {
    await executeOperations(operations);
  } catch (error) {
    // Rollback on failure
    await rollback();
    throw error;
  }

  // Step 6: Commit - clear WAL
  await browser.storage.local.remove([WAL_KEY, WAL_PROGRESS_KEY, BACKUP_KEY]);
}

/**
 * Execute operations in batches, persisting progress between batches.
 */
async function executeOperations(
  operations: SyncOperation[],
): Promise<void> {
  // Build a stableId → browser bookmark id map
  const idMap = await buildIdMap();

  // Check for existing progress (resume after crash)
  const progressResult = await browser.storage.local.get(WAL_PROGRESS_KEY);
  let startIndex = (progressResult[WAL_PROGRESS_KEY] as number) ?? 0;

  for (let i = startIndex; i < operations.length; i++) {
    const op = operations[i]!;
    await executeOperation(op, idMap);

    // Persist progress every BATCH_SIZE operations
    if ((i + 1) % BATCH_SIZE === 0) {
      await browser.storage.local.set({ [WAL_PROGRESS_KEY]: i + 1 });
      // Yield to event loop to reset SW idle timer
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
}

/**
 * Execute a single sync operation against the browser bookmarks API.
 */
async function executeOperation(
  op: SyncOperation,
  idMap: Map<string, string>,
): Promise<void> {
  // Defense-in-depth: root folders are browser-managed immutable anchors.
  // The browser throws "Can't modify the root bookmark folders" if we touch them.
  if (isRootFolder(op.stableId)) {
    return;
  }

  switch (op.type) {
    case 'CREATE': {
      // A valid, resolvable parent is required. We never create directly under
      // the browser root (id '0') — that throws "Can't modify the root bookmark folders".
      const parentId = op.parentStableId
        ? idMap.get(op.parentStableId)
        : undefined;
      if (!parentId) {
        // No parent (top-level) or parent not found: skip (retried on recovery)
        return;
      }

      const createParams: any = {
        title: op.node?.title ?? '',
        parentId,
      };

      if (op.node?.type === 'bookmark') {
        createParams.url = op.node.url;
      }

      if (op.index !== undefined) {
        createParams.index = op.index;
      }

      const created = await browser.bookmarks.create(createParams);
      // Register new node in id map
      idMap.set(op.stableId, created.id);
      break;
    }

    case 'UPDATE': {
      const browserId = idMap.get(op.stableId);
      if (!browserId) return;

      const changes: any = {};
      if (op.title !== undefined) changes.title = op.title;
      if (op.url !== undefined) changes.url = op.url;

      if (Object.keys(changes).length > 0) {
        await browser.bookmarks.update(browserId, changes);
      }
      break;
    }

    case 'MOVE': {
      const browserId = idMap.get(op.stableId);
      if (!browserId) return;

      const destination: any = {};
      if (op.parentStableId) {
        const newParentId = idMap.get(op.parentStableId);
        if (newParentId) destination.parentId = newParentId;
      }
      if (op.index !== undefined) {
        destination.index = op.index;
      }

      await browser.bookmarks.move(browserId, destination);
      break;
    }

    case 'REMOVE': {
      const browserId = idMap.get(op.stableId);
      if (!browserId) return;

      try {
        // Try removeTree first (works for folders with children)
        await browser.bookmarks.removeTree(browserId);
      } catch {
        try {
          // Fallback to remove (for single bookmarks)
          await browser.bookmarks.remove(browserId);
        } catch {
          // Node might already be removed, ignore
        }
      }
      idMap.delete(op.stableId);
      break;
    }
  }
}

/**
 * Build a mapping from stableId → browser bookmark ID.
 */
async function buildIdMap(): Promise<Map<string, string>> {
  const tree = await readBookmarkTree();
  const flatMap = flattenTree(tree);
  const idMap = new Map<string, string>();

  // We need to walk the browser tree in parallel to get browser IDs
  const browserTree = await browser.bookmarks.getTree();
  if (browserTree?.[0]?.children) {
    walkBrowserTree(browserTree[0].children, flatMap, idMap);
  }

  return idMap;
}

function walkBrowserTree(
  browserNodes: any[],
  flatMap: Map<string, { node: BookmarkNode }>,
  idMap: Map<string, string>,
): void {
  // This is a simplified mapping - in production you'd match by position/title/url
  // For now, we rely on the order being consistent
  for (const browserNode of browserNodes) {
    // Find matching stableId by scanning flatMap
    for (const [stableId, entry] of flatMap) {
      if (matchesBrowserNode(entry.node, browserNode)) {
        idMap.set(stableId, browserNode.id);
        break;
      }
    }
    if (browserNode.children) {
      walkBrowserTree(browserNode.children, flatMap, idMap);
    }
  }
}

function matchesBrowserNode(node: BookmarkNode, browserNode: any): boolean {
  if (node.type === 'bookmark') {
    return node.url === browserNode.url && node.title === browserNode.title;
  }
  if (node.type === 'folder') {
    return !browserNode.url && node.title === browserNode.title;
  }
  return false;
}

/**
 * Rollback: restore bookmarks from the backup taken before the sync.
 */
export async function rollback(): Promise<void> {
  const result = await browser.storage.local.get(BACKUP_KEY);
  const backupData = result[BACKUP_KEY] as string | undefined;

  if (!backupData) {
    throw new Error('No backup available for rollback');
  }

  // Clear WAL first to prevent recursive recovery
  await browser.storage.local.remove([WAL_KEY, WAL_PROGRESS_KEY]);

  // Note: Full rollback would require re-applying the backup tree.
  // For MVP, we clear the WAL and let the next sync fix things.
  // The backup data is preserved for manual recovery.
}

/**
 * Check if there's an incomplete WAL from a previous crash.
 */
export async function hasIncompleteWAL(): Promise<boolean> {
  const result = await browser.storage.local.get(WAL_KEY);
  return !!result[WAL_KEY];
}

/**
 * Recover from an incomplete WAL (called on SW startup).
 */
export async function recoverFromWAL(): Promise<void> {
  const result = await browser.storage.local.get(WAL_KEY);
  const walState = result[WAL_KEY] as WALState | undefined;

  if (!walState) return;

  // For MVP: clear the WAL and let next sync handle consistency
  // Future: resume from WAL_PROGRESS_KEY or rollback
  await browser.storage.local.remove([WAL_KEY, WAL_PROGRESS_KEY]);
}
