import { describe, it, expect } from 'vitest';
import { computeDiff, flattenTree } from '@/core/diff-engine';
import type { BookmarkNode } from '@/core/types';
import { ROOT_IDS, isRootFolder } from '@/core/types';

function makeBookmark(
  stableId: string,
  title: string,
  url: string,
  lastModified = 1000,
): BookmarkNode {
  return { stableId, type: 'bookmark', title, url, dateAdded: 1000, lastModified };
}

function makeFolder(
  stableId: string,
  title: string,
  children: BookmarkNode[] = [],
  lastModified = 1000,
): BookmarkNode {
  return { stableId, type: 'folder', title, children, dateAdded: 1000, lastModified };
}

describe('flattenTree', () => {
  it('should flatten a nested tree into a map', () => {
    const tree: BookmarkNode[] = [
      makeFolder('f1', 'Folder 1', [
        makeBookmark('b1', 'Bookmark 1', 'https://example.com'),
        makeBookmark('b2', 'Bookmark 2', 'https://test.com'),
      ]),
    ];

    const flat = flattenTree(tree);
    expect(flat.size).toBe(3);
    expect(flat.get('f1')?.parentStableId).toBeUndefined();
    expect(flat.get('b1')?.parentStableId).toBe('f1');
    expect(flat.get('b2')?.parentStableId).toBe('f1');
  });

  it('should handle empty tree', () => {
    const flat = flattenTree([]);
    expect(flat.size).toBe(0);
  });
});

describe('computeDiff', () => {
  it('should return empty ops for identical trees', () => {
    const tree: BookmarkNode[] = [
      makeBookmark('b1', 'Test', 'https://example.com'),
    ];
    const ops = computeDiff(tree, tree);
    expect(ops).toHaveLength(0);
  });

  it('should generate CREATE for new nodes', () => {
    const local: BookmarkNode[] = [makeFolder('f1', 'Folder')];
    const target: BookmarkNode[] = [
      makeFolder('f1', 'Folder', [
        makeBookmark('b1', 'New', 'https://new.com'),
      ]),
    ];

    const ops = computeDiff(local, target);
    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe('CREATE');
    expect(ops[0].stableId).toBe('b1');
  });

  it('should generate REMOVE for deleted nodes', () => {
    const local: BookmarkNode[] = [
      makeFolder('f1', 'Folder', [
        makeBookmark('b1', 'Old', 'https://old.com'),
      ]),
    ];
    const target: BookmarkNode[] = [makeFolder('f1', 'Folder')];

    const ops = computeDiff(local, target);
    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe('REMOVE');
    expect(ops[0].stableId).toBe('b1');
  });

  it('should generate UPDATE for title changes', () => {
    const local: BookmarkNode[] = [
      makeFolder('f1', 'Folder', [
        makeBookmark('b1', 'Old Title', 'https://example.com'),
      ]),
    ];
    const target: BookmarkNode[] = [
      makeFolder('f1', 'Folder', [
        makeBookmark('b1', 'New Title', 'https://example.com'),
      ]),
    ];

    const ops = computeDiff(local, target);
    const updateOps = ops.filter((op) => op.type === 'UPDATE');
    expect(updateOps).toHaveLength(1);
    expect(updateOps[0].title).toBe('New Title');
  });

  it('should generate CREATE for folder before bookmarks', () => {
    const local: BookmarkNode[] = [];
    const target: BookmarkNode[] = [
      makeFolder('f1', 'Folder', [
        makeBookmark('b1', 'BM', 'https://example.com'),
      ]),
    ];

    const ops = computeDiff(local, target);
    const createOps = ops.filter((op) => op.type === 'CREATE');
    // Folder should come before bookmark
    const folderIdx = createOps.findIndex((op) => op.node?.type === 'folder');
    const bookmarkIdx = createOps.findIndex(
      (op) => op.node?.type === 'bookmark',
    );
    expect(folderIdx).toBeLessThan(bookmarkIdx);
  });

  it('should handle complex tree changes', () => {
    const local: BookmarkNode[] = [
      makeFolder('f1', 'Keep', [
        makeBookmark('b1', 'Remove Me', 'https://remove.com'),
        makeBookmark('b2', 'Keep Me', 'https://keep.com'),
      ]),
    ];
    const target: BookmarkNode[] = [
      makeFolder('f1', 'Keep', [
        makeBookmark('b2', 'Keep Me', 'https://keep.com'),
        makeBookmark('b3', 'Add Me', 'https://add.com'),
      ]),
    ];

    const ops = computeDiff(local, target);
    const types = ops.map((op) => op.type);
    expect(types).toContain('CREATE'); // b3
    expect(types).toContain('REMOVE'); // b1
  });
});

describe('computeDiff - root folder protection', () => {
  const rootIds = Object.values(ROOT_IDS);

  it('isRootFolder should identify well-known root ids', () => {
    for (const id of rootIds) {
      expect(isRootFolder(id)).toBe(true);
    }
    expect(isRootFolder('some-bookmark')).toBe(false);
    expect(isRootFolder('f1')).toBe(false);
  });

  it('should never generate UPDATE ops for root folders (title differs)', () => {
    const local: BookmarkNode[] = [
      makeFolder(ROOT_IDS.toolbar, 'Bookmarks bar', [
        makeBookmark('b1', 'BM', 'https://example.com'),
      ]),
    ];
    const target: BookmarkNode[] = [
      makeFolder(ROOT_IDS.toolbar, 'Bookmarks Toolbar', [
        makeBookmark('b1', 'BM', 'https://example.com'),
      ]),
    ];

    const ops = computeDiff(local, target);
    expect(ops.filter((op) => isRootFolder(op.stableId))).toHaveLength(0);
  });

  it('should never generate MOVE ops for root folders (order differs)', () => {
    const local: BookmarkNode[] = [
      makeFolder(ROOT_IDS.toolbar, 'Bookmarks bar'),
      makeFolder(ROOT_IDS.other, 'Other bookmarks'),
    ];
    // Same roots, reversed order (different indices)
    const target: BookmarkNode[] = [
      makeFolder(ROOT_IDS.other, 'Other bookmarks'),
      makeFolder(ROOT_IDS.toolbar, 'Bookmarks bar'),
    ];

    const ops = computeDiff(local, target);
    expect(ops.filter((op) => isRootFolder(op.stableId))).toHaveLength(0);
  });

  it('should never generate REMOVE ops for root folders', () => {
    const local: BookmarkNode[] = [
      makeFolder(ROOT_IDS.toolbar, 'Bookmarks bar'),
      makeFolder(ROOT_IDS.menu, 'Bookmarks Menu'),
    ];
    // Target drops the menu root entirely
    const target: BookmarkNode[] = [
      makeFolder(ROOT_IDS.toolbar, 'Bookmarks bar'),
    ];

    const ops = computeDiff(local, target);
    expect(ops.filter((op) => isRootFolder(op.stableId))).toHaveLength(0);
  });

  it('should never generate CREATE ops for root folders', () => {
    const local: BookmarkNode[] = [
      makeFolder(ROOT_IDS.toolbar, 'Bookmarks bar'),
    ];
    // Target introduces a new root folder not present locally
    const target: BookmarkNode[] = [
      makeFolder(ROOT_IDS.toolbar, 'Bookmarks bar'),
      makeFolder(ROOT_IDS.mobile, 'Mobile bookmarks'),
    ];

    const ops = computeDiff(local, target);
    expect(ops.filter((op) => isRootFolder(op.stableId))).toHaveLength(0);
  });

  it('should still diff descendants of root folders', () => {
    const local: BookmarkNode[] = [
      makeFolder(ROOT_IDS.toolbar, 'Bookmarks bar', [
        makeBookmark('b1', 'Old', 'https://old.com'),
      ]),
    ];
    const target: BookmarkNode[] = [
      makeFolder(ROOT_IDS.toolbar, 'Bookmarks bar', [
        makeBookmark('b1', 'Old', 'https://old.com'),
        makeBookmark('b2', 'New', 'https://new.com'),
      ]),
    ];

    const ops = computeDiff(local, target);
    // b2 should be created, but no op touches the root folder itself
    expect(ops.some((op) => op.stableId === 'b2' && op.type === 'CREATE')).toBe(
      true,
    );
    expect(ops.filter((op) => isRootFolder(op.stableId))).toHaveLength(0);
  });

  it('should skip unrecognized top-level nodes (e.g. localized roots)', () => {
    // Simulates a localized browser whose root folders were not mapped to
    // well-known IDs (stableId fallback: root-unknown-N). These top-level
    // nodes must STILL never be touched, even though isRootFolder() is false.
    const local: BookmarkNode[] = [
      makeFolder('root-unknown-0', '书签栏', [
        makeBookmark('b1', 'BM', 'https://example.com'),
      ]),
      makeFolder('root-unknown-1', '其他书签'),
    ];
    const target: BookmarkNode[] = [
      // Renamed + reordered top-level folders, plus a new child bookmark
      makeFolder('root-unknown-1', '其他书签'),
      makeFolder('root-unknown-0', '书签工具栏', [
        makeBookmark('b1', 'BM', 'https://example.com'),
        makeBookmark('b2', 'New', 'https://new.com'),
      ]),
    ];

    const ops = computeDiff(local, target);
    // No operation may target a top-level node
    const topLevelOps = ops.filter(
      (op) => op.stableId.startsWith('root-unknown-'),
    );
    expect(topLevelOps).toHaveLength(0);
    // But the new descendant is still created
    expect(ops.some((op) => op.stableId === 'b2' && op.type === 'CREATE')).toBe(
      true,
    );
  });
});
