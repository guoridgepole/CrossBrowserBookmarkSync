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

    const merged = mergeTrees(local, remote, base);
    expect(merged).toHaveLength(1);
    expect(merged[0].stableId).toBe('b1');
  });

  it('should include nodes only on remote side (new additions)', () => {
    const local: BookmarkNode[] = [];
    const remote = [bm('b2', 'Remote Only', 'https://remote.com')];
    const base: BookmarkNode[] = [];

    const merged = mergeTrees(local, remote, base);
    expect(merged).toHaveLength(1);
    expect(merged[0].stableId).toBe('b2');
  });

  it('should take newer version on conflict (LWW)', () => {
    const local = [bm('b1', 'Old Title', 'https://example.com', 1000)];
    const remote = [bm('b1', 'New Title', 'https://example.com', 2000)];
    const base = [bm('b1', 'Old Title', 'https://example.com', 1000)];

    const merged = mergeTrees(local, remote, base);
    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe('New Title');
  });

  it('should propagate deletion when other side unmodified', () => {
    const local: BookmarkNode[] = []; // deleted locally
    const remote = [bm('b1', 'Test', 'https://example.com', 1000)];
    const base = [bm('b1', 'Test', 'https://example.com', 1000)];

    const merged = mergeTrees(local, remote, base);
    expect(merged).toHaveLength(0);
  });

  it('should keep modified version over deletion', () => {
    const local: BookmarkNode[] = []; // deleted locally
    const remote = [bm('b1', 'Modified', 'https://example.com', 2000)];
    const base = [bm('b1', 'Original', 'https://example.com', 1000)];

    const merged = mergeTrees(local, remote, base);
    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe('Modified');
  });

  it('should handle both sides empty', () => {
    const merged = mergeTrees([], [], []);
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

    const merged = mergeTrees(local, remote, base);
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
    expect(bookmarks[0].lastModified).toBe(2000);
  });

  it('should merge folders with same title', () => {
    const tree: BookmarkNode[] = [
      folder('f1', 'Work', [bm('b1', 'A', 'https://a.com')]),
      folder('f2', 'work', [bm('b2', 'B', 'https://b.com')]),
    ];

    const deduped = deduplicateTree(tree);
    const folders = deduped.filter((n) => n.type === 'folder');
    expect(folders).toHaveLength(1);
    expect(folders[0].children).toHaveLength(2);
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
    expect(deduped[0].children).toHaveLength(1);
  });
});
