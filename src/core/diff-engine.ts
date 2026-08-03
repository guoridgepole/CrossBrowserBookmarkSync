/**
 * Tree diff engine: compares two bookmark trees and generates a minimal
 * set of operations to transform one into the other.
 * This module has ZERO browser API dependencies.
 */

import type { BookmarkNode, SyncOperation } from './types';
import { isRootFolder } from './types';
import { normalizeURL } from './stable-id';

let opCounter = 0;

function nextOpId(): string {
  return `op_${Date.now()}_${opCounter++}`;
}

/**
 * Flatten a bookmark tree into a Map keyed by stableId.
 */
export function flattenTree(
  tree: BookmarkNode[],
  parentStableId?: string,
): Map<string, { node: BookmarkNode; parentStableId?: string; index: number }> {
  const map = new Map<
    string,
    { node: BookmarkNode; parentStableId?: string; index: number }
  >();

  function walk(nodes: BookmarkNode[], parentId?: string) {
    nodes.forEach((node, index) => {
      map.set(node.stableId, { node, parentStableId: parentId, index });
      if (node.children && node.children.length > 0) {
        walk(node.children, node.stableId);
      }
    });
  }

  walk(tree, parentStableId);
  return map;
}

/**
 * Compute the diff between the current local tree and the target tree.
 * Returns an ordered list of operations to transform local → target.
 *
 * Ordering: CREATE folders (depth-first) → CREATE bookmarks → UPDATE → MOVE → REMOVE (reverse depth)
 */
export function computeDiff(
  localTree: BookmarkNode[],
  targetTree: BookmarkNode[],
): SyncOperation[] {
  const localMap = flattenTree(localTree);
  const targetMap = flattenTree(targetTree);

  const creates: SyncOperation[] = [];
  const updates: SyncOperation[] = [];
  const moves: SyncOperation[] = [];
  const removes: SyncOperation[] = [];

  // Find nodes in target but not in local → CREATE
  // (Top-level nodes are browser root folders — immutable anchors, never created.)
  for (const [stableId, { node, parentStableId, index }] of targetMap) {
    if (parentStableId === undefined || isRootFolder(stableId)) continue;
    if (!localMap.has(stableId)) {
      creates.push({
        opId: nextOpId(),
        type: 'CREATE',
        stableId,
        parentStableId,
        index,
        node: stripChildren(node),
      });
    }
  }

  // Find nodes in local but not in target → REMOVE
  // (Top-level root folders must never be removed.)
  for (const [stableId, localEntry] of localMap) {
    if (localEntry.parentStableId === undefined || isRootFolder(stableId)) {
      continue;
    }
    if (!targetMap.has(stableId)) {
      removes.push({
        opId: nextOpId(),
        type: 'REMOVE',
        stableId,
      });
    }
  }

  // Find nodes in both but with differences → UPDATE or MOVE
  // (Top-level root folders must never be updated or moved.)
  for (const [stableId, targetEntry] of targetMap) {
    if (targetEntry.parentStableId === undefined || isRootFolder(stableId)) {
      continue;
    }
    const localEntry = localMap.get(stableId);
    if (!localEntry) continue;

    const localNode = localEntry.node;
    const targetNode = targetEntry.node;

    // Check for title/url changes
    const titleChanged = localNode.title !== targetNode.title;
    const urlChanged = normalizeURL(localNode.url ?? '') !== normalizeURL(targetNode.url ?? '');

    if (titleChanged || urlChanged) {
      updates.push({
        opId: nextOpId(),
        type: 'UPDATE',
        stableId,
        title: targetNode.title,
        url: targetNode.url,
      });
    }

    // Check for parent change (move)
    if (
      targetEntry.parentStableId !== localEntry.parentStableId ||
      targetEntry.index !== localEntry.index
    ) {
      moves.push({
        opId: nextOpId(),
        type: 'MOVE',
        stableId,
        parentStableId: targetEntry.parentStableId,
        index: targetEntry.index,
      });
    }
  }

  // Sort creates: folders first (depth-first), then bookmarks
  creates.sort((a, b) => {
    const aIsFolder = a.node?.type === 'folder' ? 0 : 1;
    const bIsFolder = b.node?.type === 'folder' ? 0 : 1;
    return aIsFolder - bIsFolder;
  });

  // Sort removes: deepest first (to avoid removing parent before children)
  removes.sort((a, b) => {
    const aDepth = getDepth(a.stableId, localMap);
    const bDepth = getDepth(b.stableId, localMap);
    return bDepth - aDepth;
  });

  return [...creates, ...updates, ...moves, ...removes];
}

/**
 * Strip children from a node (for CREATE operations, children are created separately).
 */
function stripChildren(node: BookmarkNode): BookmarkNode {
  const { children: _children, ...rest } = node;
  void _children;
  return rest;
}

/**
 * Get the depth of a node in the tree (for ordering removals).
 */
function getDepth(
  stableId: string,
  map: Map<string, { parentStableId?: string }>,
): number {
  let depth = 0;
  let current = map.get(stableId);
  while (current?.parentStableId) {
    depth++;
    current = map.get(current.parentStableId);
  }
  return depth;
}
