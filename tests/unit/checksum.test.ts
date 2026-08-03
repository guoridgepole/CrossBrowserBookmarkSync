import { describe, it, expect } from 'vitest';
import {
  sha256,
  computeTreeChecksum,
  computeSnapshotChecksum,
  verifySnapshotChecksum,
} from '@/core/checksum';
import type { BookmarkNode, SyncSnapshot } from '@/core/types';

describe('sha256', () => {
  it('should produce a 64-char hex string', async () => {
    const hash = await sha256('hello');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('should be deterministic', async () => {
    const h1 = await sha256('test');
    const h2 = await sha256('test');
    expect(h1).toBe(h2);
  });

  it('should produce known hash for "hello"', async () => {
    const hash = await sha256('hello');
    expect(hash).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });
});

describe('computeTreeChecksum', () => {
  it('should produce consistent checksums for same tree', async () => {
    const tree: BookmarkNode[] = [
      {
        stableId: 'b1',
        type: 'bookmark',
        title: 'Test',
        url: 'https://example.com',
        dateAdded: 1000,
        lastModified: 2000,
      },
    ];

    const c1 = await computeTreeChecksum(tree);
    const c2 = await computeTreeChecksum(tree);
    expect(c1).toBe(c2);
  });

  it('should produce different checksums for different trees', async () => {
    const tree1: BookmarkNode[] = [
      { stableId: 'b1', type: 'bookmark', title: 'A', url: 'https://a.com', dateAdded: 1000, lastModified: 1000 },
    ];
    const tree2: BookmarkNode[] = [
      { stableId: 'b2', type: 'bookmark', title: 'B', url: 'https://b.com', dateAdded: 1000, lastModified: 1000 },
    ];

    const c1 = await computeTreeChecksum(tree1);
    const c2 = await computeTreeChecksum(tree2);
    expect(c1).not.toBe(c2);
  });
});

describe('verifySnapshotChecksum', () => {
  it('should verify a valid snapshot', async () => {
    const partial = {
      version: 1 as const,
      revision: 1,
      deviceId: 'dev1',
      timestamp: 1000,
      tree: [] as BookmarkNode[],
    };
    const checksum = await computeSnapshotChecksum(partial);
    const snapshot: SyncSnapshot = { ...partial, checksum };

    expect(await verifySnapshotChecksum(snapshot)).toBe(true);
  });

  it('should reject a tampered snapshot', async () => {
    const partial = {
      version: 1 as const,
      revision: 1,
      deviceId: 'dev1',
      timestamp: 1000,
      tree: [] as BookmarkNode[],
    };
    const checksum = await computeSnapshotChecksum(partial);
    const snapshot: SyncSnapshot = { ...partial, checksum, revision: 999 };

    expect(await verifySnapshotChecksum(snapshot)).toBe(false);
  });
});
