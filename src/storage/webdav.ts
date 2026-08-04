/**
 * WebDAV storage backend implementation.
 * Uses a cross-browser HTTP helper (fetch on Chrome, XMLHttpRequest on Firefox
 * to work around Firefox's unreliable fetch CORS bypass for extensions).
 * Supports: PUT (upload), GET (download), MKCOL (create directory), DELETE.
 * Authentication: Basic Auth.
 */

import type { SyncSnapshot, WebDavConfig } from '@/core/types';
import { StorageError } from '@/core/types';
import { serializeSnapshot, deserializeSnapshot } from '@/core/serializer';
import { isEncryptedBody, type Cipher } from '@/core/encryption';
import { httpRequest, type HttpResult } from '@/platform/http';
import type { IStorageBackend } from './types';

const DEFAULT_FILENAME = 'bookmarks-sync.json';

export class WebDavBackend implements IStorageBackend {
  private baseUrl: string;
  private username: string;
  private password: string;
  private filename: string;

  constructor(
    config: WebDavConfig,
    private cipher?: Cipher,
  ) {
    // Ensure URL ends with /
    this.baseUrl = config.url.endsWith('/') ? config.url : `${config.url}/`;
    this.username = config.username;
    this.password = config.password;
    this.filename = DEFAULT_FILENAME;
  }

  /** Serialize a snapshot, encrypting when a cipher is configured. */
  private async serializeBody(snapshot: SyncSnapshot): Promise<string> {
    const json = serializeSnapshot(snapshot);
    return this.cipher ? this.cipher.encrypt(json) : json;
  }

  /** Parse a remote body, decrypting if it is an encrypted envelope.
   * `sourceUrl` is included in errors so misconfigured URLs (or leftover
   * remote files) can be identified at a glance. */
  private async parseBody(text: string, sourceUrl: string): Promise<SyncSnapshot> {
    let json = text;
    if (isEncryptedBody(text)) {
      if (!this.cipher) {
        throw new StorageError(
          'Remote data is encrypted but encryption is disabled on this device. ' +
            'Enable encryption using the same master password. ' +
            `(Encrypted object found at: ${sourceUrl})`,
          'DECRYPT_FAILED',
        );
      }
      try {
        json = await this.cipher.decrypt(text);
      } catch (err) {
        throw new StorageError(
          `Failed to decrypt remote snapshot (${err instanceof Error ? err.message : 'error'}). ` +
            'Wrong master password?',
          'DECRYPT_FAILED',
        );
      }
    }
    try {
      return deserializeSnapshot(json);
    } catch (error) {
      throw new StorageError(
        `Failed to parse remote snapshot: ${error}`,
        'PARSE_ERROR',
      );
    }
  }

  private get remotePath(): string {
    return `${this.baseUrl}${this.filename}`;
  }

  private get authHeader(): string {
    const credentials = btoa(`${this.username}:${this.password}`);
    return `Basic ${credentials}`;
  }

  async upload(snapshot: SyncSnapshot): Promise<void> {
    const body = await this.serializeBody(snapshot);

    let response: HttpResult;
    try {
      response = await httpRequest(this.remotePath, {
        method: 'PUT',
        headers: {
          Authorization: this.authHeader,
          'Content-Type': 'application/json',
        },
        body,
      });
    } catch (err) {
      throw new StorageError(
        `Cannot reach server during upload (${err instanceof Error ? err.message : 'network error'}). ` +
          'Ensure host permissions are granted and the URL is reachable.',
        'CONNECTION_FAILED',
      );
    }

    if (!response.ok) {
      throw new StorageError(
        `WebDAV upload failed: ${response.status} ${response.statusText}`,
        'UPLOAD_FAILED',
        response.status,
      );
    }
  }

  async download(): Promise<SyncSnapshot | null> {
    let response: HttpResult;
    try {
      response = await httpRequest(this.remotePath, {
        method: 'GET',
        headers: {
          Authorization: this.authHeader,
        },
      });
    } catch (err) {
      throw new StorageError(
        `Cannot reach server during download (${err instanceof Error ? err.message : 'network error'}). ` +
          'Ensure host permissions are granted and the URL is reachable.',
        'CONNECTION_FAILED',
      );
    }

    if (response.status === 404) {
      return null; // No remote data yet
    }

    if (!response.ok) {
      throw new StorageError(
        `WebDAV download failed: ${response.status} ${response.statusText}`,
        'DOWNLOAD_FAILED',
        response.status,
      );
    }

    const text = await response.text();
    // Some gateways/proxies answer a missing file with 200 + empty body;
    // treat that as "no remote data" just like a 404.
    if (!text.trim()) {
      return null;
    }
    return this.parseBody(text, this.remotePath);
  }

  async delete(): Promise<void> {
    const response = await httpRequest(this.remotePath, {
      method: 'DELETE',
      headers: {
        Authorization: this.authHeader,
      },
    });

    if (!response.ok && response.status !== 404) {
      throw new StorageError(
        `WebDAV delete failed: ${response.status} ${response.statusText}`,
        'DELETE_FAILED',
        response.status,
      );
    }
  }

  async testConnection(): Promise<boolean> {
    let response: HttpResult;
    try {
      // Try PROPFIND on the base directory
      response = await httpRequest(this.baseUrl, {
        method: 'PROPFIND',
        headers: {
          Authorization: this.authHeader,
          Depth: '0',
        },
      });
    } catch (err) {
      // Network-level failure: unreachable host, CORS, or missing host permission
      throw new StorageError(
        `Cannot reach server (${err instanceof Error ? err.message : 'network error'}). ` +
          'Check the URL and ensure host permissions are granted.',
        'CONNECTION_FAILED',
      );
    }

    // 207 Multi-Status is the expected success response for PROPFIND
    if (response.ok || response.status === 207) {
      return true;
    }
    if (response.status === 401 || response.status === 403) {
      throw new StorageError(
        `Authentication failed (${response.status}). Check your username and password.`,
        'AUTH_FAILED',
        response.status,
      );
    }
    if (response.status === 404) {
      throw new StorageError(
        'WebDAV path not found (404). Check the URL points to a valid directory.',
        'NOT_FOUND',
        404,
      );
    }
    throw new StorageError(
      `Server returned ${response.status} ${response.statusText}.`,
      'CONNECTION_FAILED',
      response.status,
    );
  }

  async uploadBackup(snapshot: SyncSnapshot, timestamp: number): Promise<void> {
    const backupPath = `${this.baseUrl}${this.filename}.backup.${timestamp}`;
    const body = await this.serializeBody(snapshot);

    const response = await httpRequest(backupPath, {
      method: 'PUT',
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/json',
      },
      body,
    });

    if (!response.ok) {
      throw new StorageError(
        `WebDAV backup upload failed: ${response.status}`,
        'BACKUP_FAILED',
        response.status,
      );
    }
  }

  async downloadBackup(timestamp: number): Promise<SyncSnapshot | null> {
    const backupPath = `${this.baseUrl}${this.filename}.backup.${timestamp}`;

    const response = await httpRequest(backupPath, {
      method: 'GET',
      headers: {
        Authorization: this.authHeader,
      },
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new StorageError(
        `WebDAV backup download failed: ${response.status}`,
        'BACKUP_DOWNLOAD_FAILED',
        response.status,
      );
    }

    const text = await response.text();
    if (!text.trim()) {
      return null;
    }
    return this.parseBody(text, backupPath);
  }

  async peekRawSnapshot(): Promise<string | null> {
    let response: HttpResult;
    try {
      response = await httpRequest(this.remotePath, {
        method: 'GET',
        headers: { Authorization: this.authHeader },
      });
    } catch (err) {
      throw new StorageError(
        `Cannot reach server (${err instanceof Error ? err.message : 'network error'}).`,
        'CONNECTION_FAILED',
      );
    }
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new StorageError(
        `WebDAV peek failed: ${response.status} ${response.statusText}`,
        'DOWNLOAD_FAILED',
        response.status,
      );
    }
    return response.text();
  }
}
