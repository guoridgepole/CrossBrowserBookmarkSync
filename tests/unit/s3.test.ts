import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { S3Config, SyncSnapshot } from '@/core/types';
import { StorageError } from '@/core/types';

// Mock aws4fetch's AwsClient so its .fetch() delegates to a controllable mock.
// This avoids relying on global-fetch stub timing (aws4fetch is imported before stubs run).
const mockFetch = vi.hoisted(() => vi.fn());

vi.mock('aws4fetch', () => ({
  AwsClient: class MockAwsClient {
    async fetch(input: string, init?: RequestInit) {
      return mockFetch(input, init);
    }
  },
}));

// Import AFTER mocking aws4fetch
import { S3Backend } from '@/storage/s3';

function makeConfig(overrides: Partial<S3Config> = {}): S3Config {
  return {
    endpoint: '',
    bucket: 'test-bucket',
    region: 'us-east-1',
    accessKeyId: 'AKIA_TEST',
    secretAccessKey: 'SECRET_TEST',
    ...overrides,
  };
}

function makeSnapshot(): SyncSnapshot {
  return {
    version: 1,
    revision: 1,
    deviceId: 'device-1',
    timestamp: 1700000000000,
    checksum: 'abc123',
    tree: [
      { stableId: 'b1', type: 'bookmark', title: 'Test', url: 'https://example.com', dateAdded: 1000, lastModified: 1000 },
    ],
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('S3Backend', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  describe('URL construction', () => {
    it('should use virtual-hosted style for AWS (no custom endpoint)', () => {
      const backend = new S3Backend(makeConfig());
      mockFetch.mockResolvedValue(new Response(null, { status: 204 }));

      backend.delete();

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('https://test-bucket.s3.us-east-1.amazonaws.com/');
    });

    it('should use path style for custom endpoint when pathStyle is true (MinIO)', () => {
      const backend = new S3Backend(makeConfig({ endpoint: 'https://minio.local:9000', pathStyle: true }));
      mockFetch.mockResolvedValue(new Response(null, { status: 204 }));

      backend.delete();

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('https://minio.local:9000/test-bucket/');
    });

    it('should use virtual-hosted style for custom endpoint by default (Tencent COS / R2)', () => {
      const backend = new S3Backend(makeConfig({ endpoint: 'https://cos.ap-beijing.myqcloud.com' }));
      mockFetch.mockResolvedValue(new Response(null, { status: 204 }));

      backend.delete();

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('https://test-bucket.cos.ap-beijing.myqcloud.com/');
    });

    it('should strip trailing slash from custom endpoint', () => {
      const backend = new S3Backend(makeConfig({ endpoint: 'https://minio.local:9000/', pathStyle: true }));
      mockFetch.mockResolvedValue(new Response(null, { status: 204 }));

      backend.delete();

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('https://minio.local:9000/test-bucket/');
      expect(url).not.toContain('//test-bucket');
    });

    it('should use custom object key when provided', () => {
      const backend = new S3Backend(makeConfig({ key: 'custom/path/data.json' }));
      mockFetch.mockResolvedValue(new Response(null, { status: 204 }));

      backend.delete();

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/custom/path/data.json');
    });
  });

  describe('upload', () => {
    it('should PUT serialized snapshot', async () => {
      const backend = new S3Backend(makeConfig());
      mockFetch.mockResolvedValue(new Response(null, { status: 200 }));

      await backend.upload(makeSnapshot());

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('bookmark-sync/snapshot.json');
      expect(init.method).toBe('PUT');
      expect(init.body).toContain('"revision":1');
    });

    it('should throw StorageError on failure', async () => {
      const backend = new S3Backend(makeConfig());
      mockFetch.mockResolvedValue(new Response('Forbidden', { status: 403, statusText: 'Forbidden' }));

      await expect(backend.upload(makeSnapshot())).rejects.toThrow(StorageError);
    });
  });

  describe('download', () => {
    it('should return null on 404 (no remote data)', async () => {
      const backend = new S3Backend(makeConfig());
      mockFetch.mockResolvedValue(new Response(null, { status: 404 }));

      const result = await backend.download();
      expect(result).toBeNull();
    });

    it('should return null on 403 (some providers return 403 for missing objects)', async () => {
      const backend = new S3Backend(makeConfig());
      mockFetch.mockResolvedValue(new Response(null, { status: 403 }));

      const result = await backend.download();
      expect(result).toBeNull();
    });

    it('should parse and return snapshot on success', async () => {
      const backend = new S3Backend(makeConfig());
      const snapshot = makeSnapshot();
      mockFetch.mockResolvedValue(jsonResponse(snapshot));

      const result = await backend.download();
      expect(result).not.toBeNull();
      expect(result!.revision).toBe(1);
      expect(result!.tree).toHaveLength(1);
    });

    it('should throw PARSE_ERROR on invalid JSON', async () => {
      const backend = new S3Backend(makeConfig());
      mockFetch.mockResolvedValue(new Response('not-json{{{', { status: 200 }));

      await expect(backend.download()).rejects.toThrow(StorageError);
    });
  });

  describe('delete', () => {
    it('should succeed on 204', async () => {
      const backend = new S3Backend(makeConfig());
      mockFetch.mockResolvedValue(new Response(null, { status: 204 }));

      await expect(backend.delete()).resolves.toBeUndefined();
    });

    it('should treat 404 as success (idempotent)', async () => {
      const backend = new S3Backend(makeConfig());
      mockFetch.mockResolvedValue(new Response(null, { status: 404 }));

      await expect(backend.delete()).resolves.toBeUndefined();
    });

    it('should throw on server error', async () => {
      const backend = new S3Backend(makeConfig());
      mockFetch.mockResolvedValue(new Response(null, { status: 500, statusText: 'Internal Server Error' }));

      await expect(backend.delete()).rejects.toThrow(StorageError);
    });
  });

  describe('testConnection', () => {
    it('should return true on 200', async () => {
      const backend = new S3Backend(makeConfig());
      mockFetch.mockResolvedValue(new Response(null, { status: 200 }));

      expect(await backend.testConnection()).toBe(true);
    });

    it('should return true on 404 (credentials valid, object missing)', async () => {
      const backend = new S3Backend(makeConfig());
      mockFetch.mockResolvedValue(new Response(null, { status: 404 }));

      expect(await backend.testConnection()).toBe(true);
    });

    it('should throw on network error', async () => {
      const backend = new S3Backend(makeConfig());
      mockFetch.mockRejectedValue(new Error('Network unreachable'));

      await expect(backend.testConnection()).rejects.toThrow(StorageError);
    });

    it('should throw AUTH_FAILED on 403', async () => {
      const backend = new S3Backend(makeConfig());
      mockFetch.mockResolvedValue(new Response(null, { status: 403, statusText: 'Forbidden' }));

      await expect(backend.testConnection()).rejects.toThrow(/access denied/i);
    });

    it('should use HEAD method', async () => {
      const backend = new S3Backend(makeConfig());
      mockFetch.mockResolvedValue(new Response(null, { status: 200 }));

      await backend.testConnection();

      const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(init.method).toBe('HEAD');
    });
  });

  describe('backup operations', () => {
    it('should upload backup with timestamp suffix', async () => {
      const backend = new S3Backend(makeConfig());
      mockFetch.mockResolvedValue(new Response(null, { status: 200 }));

      await backend.uploadBackup(makeSnapshot(), 1700000000000);

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('snapshot.json.backup.1700000000000');
    });

    it('should download backup by timestamp', async () => {
      const backend = new S3Backend(makeConfig());
      mockFetch.mockResolvedValue(jsonResponse(makeSnapshot()));

      const result = await backend.downloadBackup(1700000000000);
      expect(result).not.toBeNull();

      const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('snapshot.json.backup.1700000000000');
    });

    it('should return null for missing backup', async () => {
      const backend = new S3Backend(makeConfig());
      mockFetch.mockResolvedValue(new Response(null, { status: 404 }));

      const result = await backend.downloadBackup(999);
      expect(result).toBeNull();
    });
  });
});
