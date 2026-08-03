/**
 * Three-way merge algorithm for bookmark trees.
 * This module has ZERO browser API dependencies.
 *
 * Inputs: local_tree, remote_tree, base_tree (last synced snapshot)
 * Output: merged_tree
 *
 * Rules (by priority):
 * 1. Node only on one side → include (new addition)
 * 2. Same stableId, different lastModified → take the newer one (LWW)
 * 3. One side deleted + other side unmodified → propagate deletion
 * 4. One side deleted + other side modified → keep modified version
 * 5. Dedup: same parent + same normalized URL → keep newest
 * 6. Dedup: same parent + same folder title → merge children
 */

import type { BookmarkNode } from './types';
import { flattenTree } from './diff-engine';
import { normalizeURL } from './stable-id';

interface FlatEntry {
  node: BookmarkNode;
  parentStableId?: string;
  index: number;
}

/**
 * Perform a three-way merge of bookmark trees.
 */
export function mergeTrees(
  localTree: BookmarkNode[],
  remoteTree: BookmarkNode[],
  baseTree: BookmarkNode[],
): BookmarkNode[] {
  const localMap = flattenTree(localTree);
  const remoteMap = flattenTree(remoteTree);
  const baseMap = flattenTree(baseTree);

  const mergedMap = new Map<string, FlatEntry>();

  // Collect all unique stableIds
  const allIds = new Set<string>([
    ...localMap.keys(),
    ...remoteMap.keys(),
    ...baseMap.keys(),
  ]);

  for (const stableId of allIds) {
    const local = localMap.get(stableId);
    const remote = remoteMap.get(stableId);
    const base = baseMap.get(stableId);

    const result = mergeNode(stableId, local, remote, base, localMap, remoteMap, baseMap);
    if (result) {
      mergedMap.set(stableId, result);
    }
  }

  // Reconstruct tree from flat map
  return reconstructTree(mergedMap);
}

function mergeNode(
  stableId: string,
  local: FlatEntry | undefined,
  remote: FlatEntry | undefined,
  base: FlatEntry | undefined,
  localMap: Map<string, FlatEntry>,
  remoteMap: Map<string, FlatEntry>,
  baseMap: Map<string, FlatEntry>,
): FlatEntry | null {
  // Case 1: Only exists on one side (new addition)
  if (local && !remote) {
    // Check if it was deleted on remote (existed in base)
    if (base) {
      // Was in base, gone from remote → remote deleted it
      // Keep local if local itself OR any descendant was added/modified
      if (
        local.node.lastModified > (base.node.lastModified ?? 0) ||
        subtreeHasChanges(stableId, localMap, baseMap)
      ) {
        return local; // Local (or its subtree) modified, keep it
      }
      return null; // Propagate deletion
    }
    return local; // New on local, include
  }

  if (!local && remote) {
    // Check if it was deleted on local (existed in base)
    if (base) {
      // Was in base, gone from local → local deleted it
      // Keep remote if remote itself OR any descendant was added/modified
      if (
        remote.node.lastModified > (base.node.lastModified ?? 0) ||
        subtreeHasChanges(stableId, remoteMap, baseMap)
      ) {
        return remote; // Remote (or its subtree) modified, keep it
      }
      return null; // Propagate deletion
    }
    return remote; // New on remote, include
  }

  if (!local && !remote) {
    return null; // Deleted on both sides
  }

  // After the three guards above, both local and remote are guaranteed defined.
  // Explicit narrowing so TypeScript treats them as FlatEntry (not undefined).
  if (!local || !remote) {
    return null;
  }

  // Both exist - resolve conflict
  const localNode = local.node;
  const remoteNode = remote.node;

  // If both are soft-deleted
  if (localNode.deleted && remoteNode.deleted) {
    return null;
  }

  // One side soft-deleted
  if (localNode.deleted) {
    // Local deleted, remote has it
    if (base && remoteNode.lastModified > (base.node.lastModified ?? 0)) {
      return remote; // Remote modified after base, keep remote
    }
    return null; // Propagate local deletion
  }

  if (remoteNode.deleted) {
    // Remote deleted, local has it
    if (base && localNode.lastModified > (base.node.lastModified ?? 0)) {
      return local; // Local modified after base, keep local
    }
    return null; // Propagate remote deletion
  }

  // Both alive - Last-Write-Wins
  if (localNode.lastModified >= remoteNode.lastModified) {
    return local;
  }
  return remote;
}

/**
 * Check whether the subtree rooted at `rootId` on one side contains any node
 * that is new (absent from base) or modified (newer than base).
 * This ensures a folder is not deleted when the other side added content inside it,
 * even though the folder's own lastModified was not bumped.
 */
function subtreeHasChanges(
  rootId: string,
  sideMap: Map<string, FlatEntry>,
  baseMap: Map<string, FlatEntry>,
): boolean {
  // Build a parent → children index for the side map
  const childrenOf = new Map<string, string[]>();
  for (const [id, entry] of sideMap) {
    if (entry.parentStableId) {
      if (!childrenOf.has(entry.parentStableId)) {
        childrenOf.set(entry.parentStableId, []);
      }
      childrenOf.get(entry.parentStableId)!.push(id);
    }
  }

  // BFS over descendants of rootId
  const queue: string[] = [rootId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const childId of childrenOf.get(current) ?? []) {
      const sideEntry = sideMap.get(childId)!;
      const baseEntry = baseMap.get(childId);
      if (!baseEntry) {
        return true; // New node added after base
      }
      if (sideEntry.node.lastModified > (baseEntry.node.lastModified ?? 0)) {
        return true; // Node modified after base
      }
      queue.push(childId);
    }
  }
  return false;
}

/**
 * Reconstruct a tree structure from a flat map of entries.
 */
function reconstructTree(map: Map<string, FlatEntry>): BookmarkNode[] {
  // Group by parent
  const childrenOf = new Map<string | undefined, FlatEntry[]>();

  for (const [, entry] of map) {
    const parentId = entry.parentStableId;
    if (!childrenOf.has(parentId)) {
      childrenOf.set(parentId, []);
    }
    childrenOf.get(parentId)!.push(entry);
  }

  // Sort children by index
  for (const [, entries] of childrenOf) {
    entries.sort((a, b) => a.index - b.index);
  }

  // Build tree recursively
  function buildNodes(parentId?: string): BookmarkNode[] {
    const entries = childrenOf.get(parentId) ?? [];
    return entries.map((entry) => {
      const node: BookmarkNode = { ...entry.node };
      if (node.type === 'folder') {
        node.children = buildNodes(node.stableId);
      }
      return node;
    });
  }

  return buildNodes(undefined);
}

/**
 * Deduplicate a bookmark tree in-place.
 * - Bookmarks: same parent + same normalized URL → keep newest
 * - Folders: same parent + same title → merge children
 */
export function deduplicateTree(tree: BookmarkNode[]): BookmarkNode[] {
  return dedupLevel(tree);
}

function dedupLevel(nodes: BookmarkNode[]): BookmarkNode[] {
  const bookmarkByUrl = new Map<string, BookmarkNode>();
  const folderByTitle = new Map<string, BookmarkNode>();
  const others: BookmarkNode[] = [];

  for (const node of nodes) {
    if (node.type === 'bookmark' && node.url) {
      const key = normalizeURL(node.url);
      const existing = bookmarkByUrl.get(key);
      if (!existing || node.lastModified > existing.lastModified) {
        bookmarkByUrl.set(key, node);
      }
    } else if (node.type === 'folder') {
      const key = node.title.trim().toLowerCase();
      const existing = folderByTitle.get(key);
      if (existing) {
        // Merge children
        existing.children = [
          ...(existing.children ?? []),
          ...(node.children ?? []),
        ];
        // Keep the newer metadata
        if (node.lastModified > existing.lastModified) {
          existing.lastModified = node.lastModified;
        }
      } else {
        folderByTitle.set(key, node);
      }
    } else {
      others.push(node);
    }
  }

  // Recursively dedup folder children
  for (const folder of folderByTitle.values()) {
    if (folder.children) {
      folder.children = dedupLevel(folder.children);
    }
  }

  return [
    ...folderByTitle.values(),
    ...bookmarkByUrl.values(),
    ...others,
  ];
}
