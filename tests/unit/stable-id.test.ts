import { describe, it, expect } from 'vitest';
import {
  normalizeURL,
  sha256Short,
  generateBookmarkStableId,
  generateFolderStableId,
  generateSeparatorStableId,
  resolveRootStableId,
} from '@/core/stable-id';

describe('normalizeURL', () => {
  it('should lowercase scheme and host', () => {
    expect(normalizeURL('HTTP://EXAMPLE.COM/path')).toBe(
      'http://example.com/path',
    );
  });

  it('should remove trailing slash for root path', () => {
    expect(normalizeURL('https://example.com/')).toBe('https://example.com');
  });

  it('should keep trailing slash for non-root paths', () => {
    expect(normalizeURL('https://example.com/path/')).toBe(
      'https://example.com/path/',
    );
  });

  it('should remove fragment', () => {
    expect(normalizeURL('https://example.com/page#section')).toBe(
      'https://example.com/page',
    );
  });

  it('should remove default port 443 for https', () => {
    expect(normalizeURL('https://example.com:443/path')).toBe(
      'https://example.com/path',
    );
  });

  it('should remove default port 80 for http', () => {
    expect(normalizeURL('http://example.com:80/path')).toBe(
      'http://example.com/path',
    );
  });

  it('should keep non-default ports', () => {
    expect(normalizeURL('https://example.com:8080/path')).toBe(
      'https://example.com:8080/path',
    );
  });

  it('should handle invalid URLs gracefully', () => {
    expect(normalizeURL('not-a-url')).toBe('not-a-url');
  });
});

describe('sha256Short', () => {
  it('should return 16 hex characters', async () => {
    const hash = await sha256Short('test input');
    expect(hash).toHaveLength(16);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('should be deterministic', async () => {
    const hash1 = await sha256Short('same input');
    const hash2 = await sha256Short('same input');
    expect(hash1).toBe(hash2);
  });

  it('should produce different hashes for different inputs', async () => {
    const hash1 = await sha256Short('input A');
    const hash2 = await sha256Short('input B');
    expect(hash1).not.toBe(hash2);
  });
});

describe('generateBookmarkStableId', () => {
  it('should generate consistent IDs for same URL+title', async () => {
    const id1 = await generateBookmarkStableId(
      'https://example.com',
      'Example',
    );
    const id2 = await generateBookmarkStableId(
      'https://example.com',
      'Example',
    );
    expect(id1).toBe(id2);
  });

  it('should be case-insensitive for title', async () => {
    const id1 = await generateBookmarkStableId(
      'https://example.com',
      'Example',
    );
    const id2 = await generateBookmarkStableId(
      'https://example.com',
      'example',
    );
    expect(id1).toBe(id2);
  });

  it('should normalize URLs before hashing', async () => {
    const id1 = await generateBookmarkStableId(
      'https://example.com/',
      'Example',
    );
    const id2 = await generateBookmarkStableId(
      'https://example.com',
      'Example',
    );
    expect(id1).toBe(id2);
  });

  it('should produce different IDs for different URLs', async () => {
    const id1 = await generateBookmarkStableId(
      'https://example.com',
      'Example',
    );
    const id2 = await generateBookmarkStableId(
      'https://other.com',
      'Example',
    );
    expect(id1).not.toBe(id2);
  });
});

describe('generateFolderStableId', () => {
  it('should generate consistent IDs', async () => {
    const id1 = await generateFolderStableId('root-toolbar', 'Work');
    const id2 = await generateFolderStableId('root-toolbar', 'Work');
    expect(id1).toBe(id2);
  });

  it('should be case-insensitive for title', async () => {
    const id1 = await generateFolderStableId('root-toolbar', 'Work');
    const id2 = await generateFolderStableId('root-toolbar', 'work');
    expect(id1).toBe(id2);
  });

  it('should produce different IDs for different parents', async () => {
    const id1 = await generateFolderStableId('root-toolbar', 'Work');
    const id2 = await generateFolderStableId('root-menu', 'Work');
    expect(id1).not.toBe(id2);
  });
});

describe('generateSeparatorStableId', () => {
  it('should generate consistent IDs', async () => {
    const id1 = await generateSeparatorStableId('root-toolbar', 0);
    const id2 = await generateSeparatorStableId('root-toolbar', 0);
    expect(id1).toBe(id2);
  });

  it('should produce different IDs for different indices', async () => {
    const id1 = await generateSeparatorStableId('root-toolbar', 0);
    const id2 = await generateSeparatorStableId('root-toolbar', 1);
    expect(id1).not.toBe(id2);
  });
});

describe('resolveRootStableId', () => {
  it('should resolve Chrome toolbar name', () => {
    expect(resolveRootStableId('Bookmarks bar')).toBe('root-toolbar');
  });

  it('should resolve Firefox toolbar name', () => {
    expect(resolveRootStableId('Bookmarks Toolbar')).toBe('root-toolbar');
  });

  it('should resolve Other Bookmarks', () => {
    expect(resolveRootStableId('Other bookmarks')).toBe('root-other');
    expect(resolveRootStableId('Other Bookmarks')).toBe('root-other');
  });

  it('should return null for unknown names', () => {
    expect(resolveRootStableId('Custom Folder')).toBeNull();
  });
});
