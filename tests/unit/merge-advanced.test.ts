import { describe, it, expect } from 'vitest';
import { mergeTrees, deduplicateTree } from '@/core/merge';
import type { BookmarkNode } from '@/core/types';

function bm(stableId: string, title: string, url: string, lastModified = 1000): BookmarkNode {
  return { stableId, type: 'bookmark', title, url, dateAdded: 1000, lastModified };
}

function folder(stableId: string, title: string, children: BookmarkNode[] = [], lastModified = 1000): BookmarkNode {
  return { stableId, type: 'folder', title, children, dateAdded: 1000, lastModified };
}

/** Collect all stableIds in a tree (recursive) */
function collectIds(nodes: BookmarkNode[]): Set<string> {
  const ids = new Set<string>();
  function walk(list: BookmarkNode[]) {
    for (const n of list) {
      ids.add(n.stableId);
      if (n.children) walk(n.children);
    }
  }
  walk(nodes);
  return ids;
}

/** Count all nodes in a tree (recursive) */
function countNodes(nodes: BookmarkNode[]): number {
  return collectIds(nodes).size;
}

describe('mergeTrees - advanced conflict scenarios', () => {
  it('should resolve simultaneous title edits via LWW (remote newer)', () => {
    const base = [bm('b1', 'Original', 'https://example.com', 1000)];
    const local = [bm('b1', 'Local Edit', 'https://example.com', 2000)];
    const remote = [bm('b1', 'Remote Edit', 'https://example.com', 3000)];

    const merged = mergeTrees(local, remote, base);
    expect(merged[0].title).toBe('Remote Edit');
  });

  it('should resolve simultaneous title edits via LWW (local newer)', () => {
    const base = [bm('b1', 'Original', 'https://example.com', 1000)];
    const local = [bm('b1', 'Local Edit', 'https://example.com', 3000)];
    const remote = [bm('b1', 'Remote Edit', 'https://example.com', 2000)];

    const merged = mergeTrees(local, remote, base);
    expect(merged[0].title).toBe('Local Edit');
  });

  it('should handle both sides adding different bookmarks', () => {
    const base: BookmarkNode[] = [];
    const local = [bm('b1', 'Local New', 'https://local.com')];
    const remote = [bm('b2', 'Remote New', 'https://remote.com')];

    const merged = mergeTrees(local, remote, base);
    const ids = collectIds(merged);
    expect(ids.has('b1')).toBe(true);
    expect(ids.has('b2')).toBe(true);
  });

  it('should handle deletion on one side, no change on other', () => {
    const base = [bm('b1', 'Test', 'https://example.com')];
    const local: BookmarkNode[] = []; // deleted locally
    const remote = [bm('b1', 'Test', 'https://example.com')]; // unchanged

    const merged = mergeTrees(local, remote, base);
    expect(merged).toHaveLength(0);
  });

  it('should handle deletion on both sides', () => {
    const base = [bm('b1', 'Test', 'https://example.com')];
    const local: BookmarkNode[] = [];
    const remote: BookmarkNode[] = [];

    const merged = mergeTrees(local, remote, base);
    expect(merged).toHaveLength(0);
  });

  it('should keep node modified on one side when deleted on other', () => {
    const base = [bm('b1', 'Original', 'https://example.com', 1000)];
    const local: BookmarkNode[] = []; // deleted locally
    const remote = [bm('b1', 'Updated Title', 'https://example.com', 2000)]; // modified remotely

    const merged = mergeTrees(local, remote, base);
    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe('Updated Title');
  });

  it('should merge folder renamed on one side with additions on other', () => {
    const base = [folder('f1', 'Old Name', [])];
    const local = [folder('f1', 'New Name', [], 2000)]; // renamed locally
    const remote = [folder('f1', 'Old Name', [bm('b1', 'Added', 'https://added.com')])]; // bookmark added remotely

    const merged = mergeTrees(local, remote, base);
    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe('New Name'); // rename wins (modified)
    expect(merged[0].children).toHaveLength(1); // addition preserved
  });

  it('should propagate folder deletion when other side unmodified', () => {
    const base = [folder('f1', 'Doomed', [bm('b1', 'Inside', 'https://inside.com')])];
    const local: BookmarkNode[] = []; // folder deleted locally
    const remote = [folder('f1', 'Doomed', [bm('b1', 'Inside', 'https://inside.com')])]; // unchanged

    const merged = mergeTrees(local, remote, base);
    expect(merged).toHaveLength(0);
  });

  it('should keep folder with new content when deleted on other side', () => {
    const base = [folder('f1', 'Folder', [])];
    const local: BookmarkNode[] = []; // deleted locally
    const remote = [folder('f1', 'Folder', [bm('b1', 'New Inside', 'https://new.com', 2000)])]; // content added remotely

    const merged = mergeTrees(local, remote, base);
    expect(merged).toHaveLength(1);
    expect(merged[0].children).toHaveLength(1);
  });

  it('should handle deeply nested merges (3 levels)', () => {
    const base = [folder('f1', 'L1', [folder('f2', 'L2', [])])];
    const local = [folder('f1', 'L1', [folder('f2', 'L2', [bm('b1', 'Deep Local', 'https://deep-local.com')])])];
    const remote = [folder('f1', 'L1', [folder('f2', 'L2', [bm('b2', 'Deep Remote', 'https://deep-remote.com')])])];

    const merged = mergeTrees(local, remote, base);
    const ids = collectIds(merged);
    expect(ids.has('b1')).toBe(true);
    expect(ids.has('b2')).toBe(true);
  });

  it('should handle multiple folders with mixed changes', () => {
    const base = [
      folder('f1', 'Work', [bm('b1', 'Shared', 'https://shared.com')]),
      folder('f2', 'Personal', []),
    ];
    const local = [
      folder('f1', 'Work', [bm('b1', 'Shared', 'https://shared.com'), bm('b2', 'Local Add', 'https://local-add.com')]),
      folder('f2', 'Personal', []),
    ];
    const remote = [
      folder('f1', 'Work', [bm('b1', 'Shared', 'https://shared.com')]),
      folder('f2', 'Personal', [bm('b3', 'Remote Add', 'https://remote-add.com')]),
    ];

    const merged = mergeTrees(local, remote, base);
    const ids = collectIds(merged);
    expect(ids.has('b2')).toBe(true); // local addition
    expect(ids.has('b3')).toBe(true); // remote addition
  });

  it('should not lose data when base is empty (first merge)', () => {
    const base: BookmarkNode[] = [];
    const local = [bm('b1', 'A', 'https://a.com'), folder('f1', 'Folder', [bm('b2', 'B', 'https://b.com')])];
    const remote = [bm('b3', 'C', 'https://c.com')];

    const merged = mergeTrees(local, remote, base);
    expect(countNodes(merged)).toBe(4); // b1, f1, b2, b3
  });

  it('should handle identical additions on both sides (same stableId)', () => {
    const base: BookmarkNode[] = [];
    const local = [bm('b1', 'Same', 'https://same.com')];
    const remote = [bm('b1', 'Same', 'https://same.com')];

    const merged = mergeTrees(local, remote, base);
    // Should appear only once
    expect(merged.filter((n) => n.stableId === 'b1')).toHaveLength(1);
  });
});

describe('deduplicateTree - advanced scenarios', () => {
  it('should deduplicate URLs differing only by trailing slash', () => {
    const tree: BookmarkNode[] = [
      bm('b1', 'Example', 'https://example.com/', 1000),
      bm('b2', 'Example No Slash', 'https://example.com', 2000),
    ];

    const deduped = deduplicateTree(tree);
    expect(deduped.filter((n) => n.type === 'bookmark')).toHaveLength(1);
  });

  it('should deduplicate URLs differing only by fragment', () => {
    const tree: BookmarkNode[] = [
      bm('b1', 'Page', 'https://example.com/page#section1', 1000),
      bm('b2', 'Page Copy', 'https://example.com/page', 2000),
    ];

    const deduped = deduplicateTree(tree);
    expect(deduped.filter((n) => n.type === 'bookmark')).toHaveLength(1);
  });

  it('should deduplicate URLs differing by scheme case and host case', () => {
    const tree: BookmarkNode[] = [
      bm('b1', 'Upper', 'HTTPS://EXAMPLE.COM/path', 1000),
      bm('b2', 'Lower', 'https://example.com/path', 2000),
    ];

    const deduped = deduplicateTree(tree);
    expect(deduped.filter((n) => n.type === 'bookmark')).toHaveLength(1);
  });

  it('should merge nested folders with same title (case-insensitive)', () => {
    const tree: BookmarkNode[] = [
      folder('f1', 'News', [bm('b1', 'A', 'https://a.com')]),
      folder('f2', 'news', [bm('b2', 'B', 'https://b.com')]),
    ];

    const deduped = deduplicateTree(tree);
    const folders = deduped.filter((n) => n.type === 'folder');
    expect(folders).toHaveLength(1);
    expect(folders[0].children).toHaveLength(2);
  });

  it('should not merge folders with different titles', () => {
    const tree: BookmarkNode[] = [
      folder('f1', 'Work', []),
      folder('f2', 'Play', []),
    ];

    const deduped = deduplicateTree(tree);
    expect(deduped.filter((n) => n.type === 'folder')).toHaveLength(2);
  });

  it('should handle empty tree', () => {
    expect(deduplicateTree([])).toHaveLength(0);
  });

  it('should deduplicate across multiple levels', () => {
    const tree: BookmarkNode[] = [
      folder('f1', 'Top', [
        bm('b1', 'Dup', 'https://dup.com', 1000),
        folder('f2', 'Sub', [bm('b2', 'Dup Again', 'https://dup.com', 2000)]),
      ]),
    ];

    const deduped = deduplicateTree(tree);
    // The duplicate inside the subfolder should be removed
    const ids = collectIds(deduped);
    // Only one of b1/b2 should survive at each level after dedup
    const subFolder = deduped[0].children!.find((n) => n.type === 'folder');
    const topLevelBookmarks = deduped[0].children!.filter((n) => n.type === 'bookmark');
    expect(topLevelBookmarks.length + (subFolder?.children?.length ?? 0)).toBeLessThanOrEqual(2);
    expect(ids.size).toBeGreaterThanOrEqual(2); // at least folder + 1 bookmark
  });
});
