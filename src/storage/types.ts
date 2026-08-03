/**
 * Storage backend interface definition.
 */

import type { SyncSnapshot } from '@/core/types';

/**
 * Abstract storage backend interface.
 * Implementations: S3, WebDAV, Local (for testing).
 */
export interface IStorageBackend {
  /** Upload a snapshot to remote storage */
  upload(snapshot: SyncSnapshot): Promise<void>;

  /** Download the latest snapshot from remote storage. Returns null if none exists. */
  download(): Promise<SyncSnapshot | null>;

  /** Delete the remote snapshot */
  delete(): Promise<void>;

  /**
   * Test the connection to the storage backend.
   * Returns true on success; throws a StorageError with a descriptive
   * message on failure (network, auth, not-found, etc.).
   */
  testConnection(): Promise<boolean>;

  /** Upload a backup copy with a timestamp suffix */
  uploadBackup(snapshot: SyncSnapshot, timestamp: number): Promise<void>;

  /** Download a specific backup by timestamp */
  downloadBackup(timestamp: number): Promise<SyncSnapshot | null>;
}
