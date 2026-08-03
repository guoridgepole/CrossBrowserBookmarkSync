import { describe, it, expect } from 'vitest';
import {
  canonicalStringify,
  serializeSnapshot,
  deserializeSnapshot,
  serializeTree,
  deserializeTree,
} from '@/core/serializer';
import type { BookmarkNode, SyncSnapshot } from '@/core/types';

describe('canonicalStringify', () => {
  it('should sort object keys alphabetically', () => {
    const obj = { z: 1, a: 2, m: 3 };
    const result = canonicalStringify(obj);
    expect(result).toBe('{"a":2,"m":3,"z":1}');
  });

  it('should handle nested objects', () => {
    const obj = { b: { z: 1, a: 2 }, a: 1 };
    const result = canonicalStringify(obj);
    expect(result).toBe('{"a":1,"b":{"a":2,"z":1}}');
  });

  it('should not sort arrays', () => {
    const arr = [3, 1, 2];
    const result = canonicalStringify(arr);
    expect(result).toBe('[3,1,2]');
  });

  it('should produce deterministic output', () => {
    const obj1 = { b: 1, a: 2 };
    const obj2 = { a: 2, b: 1 };
    expect(canonicalStringify(obj1)).toBe(canonicalStringify(obj2));
  });
});

describe('serializeSnapshot / deserializeSnapshot', () => {
  const sampleSnapshot: SyncSnapshot = {
    version: 1,
    revision: 5,
    deviceId: 'device-123',
    timestamp: 1700000000000,
    checksum: 'abc123',
    tree: [
      {
        stableId: 'b1',
        type: 'bookmark',
        title: 'Test',
        url: 'https://example.com',
        dateAdded: 1000,
        lastModified: 2000,
      },
    ],
  };

  it('should round-trip a snapshot', () => {
    const json = serializeSnapshot(sampleSnapshot);
    const restored = deserializeSnapshot(json);
    expect(restored).toEqual(sampleSnapshot);
  });

  it('should reject invalid version', () => {
    const json = JSON.stringify({ ...sampleSnapshot, version: 99 });
    expect(() => deserializeSnapshot(json)).toThrow('Unsupported snapshot version');
  });

  it('should reject missing tree', () => {
    const json = JSON.stringify({ ...sampleSnapshot, tree: 'invalid' });
    expect(() => deserializeSnapshot(json)).toThrow('tree must be an array');
  });
});

describe('serializeTree / deserializeTree', () => {
  it('should round-trip a tree', () => {
    const tree: BookmarkNode[] = [
      {
        stableId: 'f1',
        type: 'folder',
        title: 'Folder',
        children: [
          {
            stableId: 'b1',
            type: 'bookmark',
            title: 'BM',
            url: 'https://test.com',
            dateAdded: 1000,
            lastModified: 2000,
          },
        ],
        dateAdded: 1000,
        lastModified: 1000,
      },
    ];

    const json = serializeTree(tree);
    const restored = deserializeTree(json);
    expect(restored).toEqual(tree);
  });

  it('should reject non-array input', () => {
    expect(() => deserializeTree('{"not": "array"}')).toThrow(
      'must be an array',
    );
  });
});
