/**
 * S3 storage backend implementation using aws4fetch (AWS Signature V4).
 * Supports AWS S3 and S3-compatible services (MinIO, Cloudflare R2, etc.).
 *
 * URL styles:
 * - AWS: virtual-hosted style → https://{bucket}.s3.{region}.amazonaws.com/{key}
 * - Custom endpoint: path style → {endpoint}/{bucket}/{key}
 */

import { AwsClient } from 'aws4fetch';
import type { S3Config, SyncSnapshot } from '@/core/types';
import { StorageError } from '@/core/types';
import { serializeSnapshot, deserializeSnapshot } from '@/core/serializer';
import type { IStorageBackend } from './types';

const DEFAULT_KEY = 'bookmark-sync/snapshot.json';

/**
 * Extract a concise "Code: Message" string from an S3/COS XML error body.
 * Returns '' if no recognizable error structure is present.
 */
function extractS3Error(body: string): string {
  const code = body.match(/<Code>(.*?)<\/Code>/)?.[1];
  const message = body.match(/<Message>(.*?)<\/Message>/)?.[1];
  if (code || message) {
    return `${code ?? 'Error'}${message ? `: ${message}` : ''}. `;
  }
  return '';
}

export class S3Backend implements IStorageBackend {
  private client: AwsClient;
  private objectKey: string;
  private baseUrl: string;

  constructor(private config: S3Config) {
    this.client = new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      region: config.region || 'us-east-1',
      // Must be 's3': aws4fetch defaults to 'execute-api', which produces an
      // invalid SigV4 credential scope for S3 / S3-compatible services (AWS S3,
      // Tencent COS, MinIO, R2...) and yields 403 SignatureDoesNotMatch.
      service: 's3',
    });
    this.objectKey = config.key || DEFAULT_KEY;
    this.baseUrl = this.buildBaseUrl();
  }

  /**
   * Build the base URL for S3 operations.
   * Custom endpoint → path style; AWS → virtual-hosted style.
   */
  private buildBaseUrl(): string {
    if (this.config.endpoint) {
      const endpoint = this.config.endpoint.replace(/\/+$/, '');
      if (this.config.pathStyle) {
        // Path style (MinIO / self-hosted): {endpoint}/{bucket}
        return `${endpoint}/${this.config.bucket}`;
      }
      // Virtual-hosted style (AWS / Tencent COS / Cloudflare R2): prepend the
      // bucket as a subdomain of the endpoint host.
      // https://cos.ap-beijing.myqcloud.com → https://{bucket}.cos.ap-beijing.myqcloud.com
      const url = new URL(endpoint);
      return `${url.protocol}//${this.config.bucket}.${url.host}`;
    }
    // AWS S3 virtual-hosted style (no custom endpoint)
    const region = this.config.region || 'us-east-1';
    return `https://${this.config.bucket}.s3.${region}.amazonaws.com`;
  }

  private get objectUrl(): string {
    return `${this.baseUrl}/${this.objectKey}`;
  }

  private backupUrl(timestamp: number): string {
    return `${this.baseUrl}/${this.objectKey}.backup.${timestamp}`;
  }

  async upload(snapshot: SyncSnapshot): Promise<void> {
    const body = serializeSnapshot(snapshot);

    const response = await this.client.fetch(this.objectUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    if (!response.ok) {
      throw new StorageError(
        `S3 upload failed: ${response.status} ${response.statusText}`,
        'UPLOAD_FAILED',
        response.status,
      );
    }
  }

  async download(): Promise<SyncSnapshot | null> {
    const response = await this.client.fetch(this.objectUrl, {
      method: 'GET',
    });

    if (response.status === 404 || response.status === 403) {
      // 404: object doesn't exist yet; 403: some providers return 403 for missing objects
      return null;
    }

    if (!response.ok) {
      throw new StorageError(
        `S3 download failed: ${response.status} ${response.statusText}`,
        'DOWNLOAD_FAILED',
        response.status,
      );
    }

    const text = await response.text();
    try {
      return deserializeSnapshot(text);
    } catch (error) {
      throw new StorageError(
        `Failed to parse remote snapshot: ${error}`,
        'PARSE_ERROR',
      );
    }
  }

  async delete(): Promise<void> {
    const response = await this.client.fetch(this.objectUrl, {
      method: 'DELETE',
    });

    // S3 returns 204 on successful delete; 404 is also acceptable (idempotent)
    if (!response.ok && response.status !== 404) {
      throw new StorageError(
        `S3 delete failed: ${response.status} ${response.statusText}`,
        'DELETE_FAILED',
        response.status,
      );
    }
  }

  async testConnection(): Promise<boolean> {
    let response: Response;
    try {
      // HEAD request on the snapshot object.
      // 200 = exists, 404 = doesn't exist yet but credentials work.
      response = await this.client.fetch(this.objectUrl, {
        method: 'HEAD',
      });
    } catch (err) {
      throw new StorageError(
        `Cannot reach S3 (${err instanceof Error ? err.message : 'network error'}). ` +
          'Check the endpoint and ensure host permissions are granted.',
        'CONNECTION_FAILED',
      );
    }

    if (response.ok || response.status === 404) {
      return true;
    }
    if (response.status === 403) {
      // HEAD responses carry no body, so issue a GET to retrieve COS/S3's
      // XML error code (SignatureDoesNotMatch / AccessDenied / InvalidAccessKeyId...).
      const detail = await this.fetchErrorDetail();
      throw new StorageError(
        `S3 access denied (403). ${detail}Check access key, secret key, region, and bucket permissions.`,
        'AUTH_FAILED',
        403,
      );
    }
    throw new StorageError(
      `S3 returned ${response.status} ${response.statusText}.`,
      'CONNECTION_FAILED',
      response.status,
    );
  }

  /**
   * Best-effort retrieval of the provider's error code/message from a GET on the
   * object (used to enrich 403 diagnostics, since HEAD has no response body).
   */
  private async fetchErrorDetail(): Promise<string> {
    try {
      const resp = await this.client.fetch(this.objectUrl, { method: 'GET' });
      const body = await resp.text();
      return extractS3Error(body);
    } catch {
      return '';
    }
  }

  async uploadBackup(snapshot: SyncSnapshot, timestamp: number): Promise<void> {
    const body = serializeSnapshot(snapshot);

    const response = await this.client.fetch(this.backupUrl(timestamp), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    if (!response.ok) {
      throw new StorageError(
        `S3 backup upload failed: ${response.status}`,
        'BACKUP_FAILED',
        response.status,
      );
    }
  }

  async downloadBackup(timestamp: number): Promise<SyncSnapshot | null> {
    const response = await this.client.fetch(this.backupUrl(timestamp), {
      method: 'GET',
    });

    if (response.status === 404 || response.status === 403) {
      return null;
    }

    if (!response.ok) {
      throw new StorageError(
        `S3 backup download failed: ${response.status}`,
        'BACKUP_DOWNLOAD_FAILED',
        response.status,
      );
    }

    const text = await response.text();
    return deserializeSnapshot(text);
  }
}
