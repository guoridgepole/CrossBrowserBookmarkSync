/**
 * Bookmark reader: converts browser-native bookmark tree to unified model.
 * This is the ONLY module that reads from chrome.bookmarks API.
 */

import type { BookmarkNode } from '@/core/types';
import { ROOT_IDS, ROOT_NAME_MAP, ROOT_BROWSER_ID_MAP } from '@/core/types';
import {
  generateBookmarkStableId,
  generateFolderStableId,
  generateSeparatorStableId,
} from '@/core/stable-id';

/**
 * Read the entire bookmark tree from the browser and convert to unified model.
 */
export async function readBookmarkTree(): Promise<BookmarkNode[]> {
  const tree = await browser.bookmarks.getTree();
  if (!tree || tree.length === 0) {
    return [];
  }

  // The root node (tree[0]) contains children which are the top-level folders
  const rootNode = tree[0];
  if (!rootNode?.children) {
    return [];
  }

  const result: BookmarkNode[] = [];

  for (const child of rootNode.children) {
    const converted = await convertNode(child, undefined, 0, true);
    if (converted) {
      result.push(converted);
    }
  }

  return result;
}

/**
 * Convert a browser bookmark node to our unified BookmarkNode.
 */
async function convertNode(
  node: any,
  parentStableId: string | undefined,
  index: number,
  isRoot: boolean = false,
): Promise<BookmarkNode | null> {
  // Determine type
  const isFolder = !node.url && node.type !== 'separator';
  const isSeparator = node.type === 'separator' || (!node.url && !node.title && !isFolder);

  let stableId: string;
  let type: BookmarkNode['type'];

  if (isRoot) {
    // Root folders get well-known IDs. Resolve by browser-native ID first
    // (language-independent), then by title (multilingual), then fallback.
    stableId = resolveRootStableId(node, index);
    type = 'folder';
  } else if (isSeparator || node.type === 'separator') {
    stableId = await generateSeparatorStableId(parentStableId ?? 'root', index);
    type = 'separator';
  } else if (isFolder) {
    stableId = await generateFolderStableId(
      parentStableId ?? 'root',
      node.title ?? '',
    );
    type = 'folder';
  } else {
    stableId = await generateBookmarkStableId(
      node.url ?? '',
      node.title ?? '',
    );
    type = 'bookmark';
  }

  const result: BookmarkNode = {
    stableId,
    type,
    title: node.title ?? '',
    dateAdded: node.dateAdded ?? Date.now(),
    lastModified: node.dateGroupModified ?? node.dateAdded ?? Date.now(),
  };

  if (type === 'bookmark') {
    result.url = node.url;
  }

  if (type === 'folder' && node.children) {
    result.children = [];
    for (let i = 0; i < node.children.length; i++) {
      const child = await convertNode(node.children[i], stableId, i);
      if (child) {
        result.children.push(child);
      }
    }
  }

  return result;
}

/**
 * Resolve a well-known root folder stableId for a top-level browser node.
 * Prefers the browser-native ID (fixed per browser, locale-independent),
 * falls back to the localized title, then to a positional placeholder.
 */
function resolveRootStableId(node: any, index: number): string {
  const byId = ROOT_BROWSER_ID_MAP[node.id];
  if (byId) {
    return ROOT_IDS[byId];
  }
  const byTitle = ROOT_NAME_MAP[node.title ?? ''];
  if (byTitle) {
    return ROOT_IDS[byTitle];
  }
  return `root-unknown-${index}`;
}
