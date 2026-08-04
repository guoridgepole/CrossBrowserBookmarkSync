import { describe, it, expect } from 'vitest';
import { mergeTrees, deduplicateTree } from '@/core/merge';
import type { BookmarkNode } from '@/core/types';

function bm(stableId: string, title: string, url: string, lastModified = 1000): BookmarkNode {
  return { stableId, type: 'bookmark', title, url, dateAdded: 1000, lastModified };
}

function folder(stableId: string, title: string, children: BookmarkNode[] = [], lastModified = 1000): BookmarkNode {
  return { stableId, type: 'folder', title, children, dateAdded: 1000, lastModified };
}

describe('mergeTrees', () => {
  it('should include nodes only on local side (new additions)', () => {
    const local = [bm('b1', 'Local Only', 'https://local.com')];
    const remote: BookmarkNode[] = [];
    const base: BookmarkNode[] = [];

    const { tree: merged } = mergeTrees(local, remote, base);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.stableId).toBe('b1');
  });

  it('should include nodes only on remote side (new additions)', () => {
    const local: BookmarkNode[] = [];
    const remote = [bm('b2', 'Remote Only', 'https://remote.com')];
    const base: BookmarkNode[] = [];

    const { tree: merged } = mergeTrees(local, remote, base);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.stableId).toBe('b2');
  });

  it('should take newer version on conflict (LWW)', () => {
    const local = [bm('b1', 'Old Title', 'https://example.com', 1000)];
    const remote = [bm('b1', 'New Title', 'https://example.com', 2000)];
    const base = [bm('b1', 'Old Title', 'https://example.com', 1000)];

    const { tree: merged } = mergeTrees(local, remote, base);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.title).toBe('New Title');
  });

  it('should propagate deletion when other side unmodified', () => {
    const local: BookmarkNode[] = []; // deleted locally
    const remote = [bm('b1', 'Test', 'https://example.com', 1000)];
    const base = [bm('b1', 'Test', 'https://example.com', 1000)];

    const { tree: merged } = mergeTrees(local, remote, base);
    expect(merged).toHaveLength(0);
  });

  it('should keep modified version over deletion', () => {
    const local: BookmarkNode[] = []; // deleted locally
    const remote = [bm('b1', 'Modified', 'https://example.com', 2000)];
    const base = [bm('b1', 'Original', 'https://example.com', 1000)];

    const { tree: merged } = mergeTrees(local, remote, base);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.title).toBe('Modified');
  });

  it('should handle both sides empty', () => {
    const { tree: merged } = mergeTrees([], [], []);
    expect(merged).toHaveLength(0);
  });

  it('should merge nested folder structures', () => {
    const local = [
      folder('f1', 'Work', [bm('b1', 'Local BM', 'https://local.com')]),
    ];
    const remote = [
      folder('f1', 'Work', [bm('b2', 'Remote BM', 'https://remote.com')]),
    ];
    const base = [folder('f1', 'Work', [])];

    const { tree: merged } = mergeTrees(local, remote, base);
    expect(merged).toHaveLength(1);
    // Both bookmarks should be present
    const allIds = new Set<string>();
    function collectIds(nodes: BookmarkNode[]) {
      for (const n of nodes) {
        allIds.add(n.stableId);
        if (n.children) collectIds(n.children);
      }
    }
    collectIds(merged);
    expect(allIds.has('b1')).toBe(true);
    expect(allIds.has('b2')).toBe(true);
  });
});

describe('deduplicateTree', () => {
  it('should remove duplicate bookmarks with same URL', () => {
    const tree: BookmarkNode[] = [
      bm('b1', 'Example', 'https://example.com', 1000),
      bm('b2', 'Example Copy', 'https://example.com', 2000),
    ];

    const deduped = deduplicateTree(tree);
    const bookmarks = deduped.filter((n) => n.type === 'bookmark');
    expect(bookmarks).toHaveLength(1);
    // Should keep the newer one
    expect(bookmarks[0]!.lastModified).toBe(2000);
  });

  it('should merge folders with same title', () => {
    const tree: BookmarkNode[] = [
      folder('f1', 'Work', [bm('b1', 'A', 'https://a.com')]),
      folder('f2', 'work', [bm('b2', 'B', 'https://b.com')]),
    ];

    const deduped = deduplicateTree(tree);
    const folders = deduped.filter((n) => n.type === 'folder');
    expect(folders).toHaveLength(1);
    expect(folders[0]!.children).toHaveLength(2);
  });

  it('should not deduplicate different URLs', () => {
    const tree: BookmarkNode[] = [
      bm('b1', 'A', 'https://a.com'),
      bm('b2', 'B', 'https://b.com'),
    ];

    const deduped = deduplicateTree(tree);
    expect(deduped.filter((n) => n.type === 'bookmark')).toHaveLength(2);
  });

  it('should recursively deduplicate folder children', () => {
    const tree: BookmarkNode[] = [
      folder('f1', 'Folder', [
        bm('b1', 'Dup', 'https://dup.com', 1000),
        bm('b2', 'Dup Copy', 'https://dup.com', 2000),
      ]),
    ];

    const deduped = deduplicateTree(tree);
    expect(deduped[0]!.children).toHaveLength(1);
  });
});

describe('mergeTrees - conflict detection', () => {
  it('should record a conflict when both sides modified with different content', () => {
    const base = [bm('b1', 'Original', 'https://example.com', 1000)];
    const local = [bm('b1', 'Local Edit', 'https://example.com', 2000)];
    const remote = [bm('b1', 'Remote Edit', 'https://example.com', 3000)];

    const { tree, conflicts } = mergeTrees(local, remote, base);

    // LWW still produces a merged tree (non-blocking).
    expect(tree).toHaveLength(1);
    expect(tree[0]!.title).toBe('Remote Edit');

    // The true conflict is recorded for review.
    expect(conflicts).toHaveLength(1);
    const conflict = conflicts[0]!;
    expect(conflict.stableId).toBe('b1');
    expect(conflict.type).toBe('bookmark');
    expect(conflict.local.title).toBe('Local Edit');
    expect(conflict.remote.title).toBe('Remote Edit');
    expect(conflict.base?.title).toBe('Original');
    expect(conflict.autoChosen).toBe('remote'); // remote is newer
    expect(conflict.resolved).toBe(false);
  });

  it('should pick autoChosen=local when local is newer', () => {
    const base = [bm('b1', 'Original', 'https://example.com', 1000)];
    const local = [bm('b1', 'Local Edit', 'https://example.com', 3000)];
    const remote = [bm('b1', 'Remote Edit', 'https://example.com', 2000)];

    const { conflicts } = mergeTrees(local, remote, base);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.autoChosen).toBe('local');
  });

  it('should not record a conflict when only one side modified', () => {
    const base = [bm('b1', 'Original', 'https://example.com', 1000)];
    const local = [bm('b1', 'Original', 'https://example.com', 1000)]; // unchanged
    const remote = [bm('b1', 'Remote Edit', 'https://example.com', 2000)];

    const { tree, conflicts } = mergeTrees(local, remote, base);
    expect(tree[0]!.title).toBe('Remote Edit');
    expect(conflicts).toHaveLength(0);
  });

  it('should not record a conflict when both sides made the same edit', () => {
    const base = [bm('b1', 'Original', 'https://example.com', 1000)];
    const local = [bm('b1', 'Same Edit', 'https://example.com', 2000)];
    const remote = [bm('b1', 'Same Edit', 'https://example.com', 2500)];

    const { conflicts } = mergeTrees(local, remote, base);
    expect(conflicts).toHaveLength(0);
  });

  it('should treat a URL-only difference as a conflict', () => {
    const base = [bm('b1', 'Site', 'https://old.com', 1000)];
    const local = [bm('b1', 'Site', 'https://local.com', 2000)];
    const remote = [bm('b1', 'Site', 'https://remote.com', 3000)];

    const { conflicts } = mergeTrees(local, remote, base);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.autoChosen).toBe('remote');
  });

  it('should record a folder conflict on differing titles', () => {
    const base = [folder('f1', 'Work', [], 1000)];
    const local = [folder('f1', 'Work Local', [], 2000)];
    const remote = [folder('f1', 'Work Remote', [], 3000)];

    const { tree, conflicts } = mergeTrees(local, remote, base);
    expect(tree[0]!.title).toBe('Work Remote');
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.type).toBe('folder');
    expect(conflicts[0]!.autoChosen).toBe('remote');
  });

  it('should not record a conflict without a base (first merge additions)', () => {
    const base: BookmarkNode[] = [];
    const local = [bm('b1', 'Same', 'https://same.com')];
    const remote = [bm('b1', 'Same', 'https://same.com')];

    const { conflicts } = mergeTrees(local, remote, base);
    expect(conflicts).toHaveLength(0);
  });
});
