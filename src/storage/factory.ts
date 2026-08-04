/**
 * Storage backend factory: instantiates the correct backend based on config.
 * When encryption is enabled, loads the persisted cipher and injects it so the
 * backend transparently encrypts uploads and decrypts downloads.
 */

import type { AppSettings } from '@/core/types';
import type { Cipher } from '@/core/encryption';
import { loadCipher } from '@/config/key-manager';
import type { IStorageBackend } from './types';
import { WebDavBackend } from './webdav';
import { S3Backend } from './s3';

/**
 * Create a storage backend instance from app settings.
 * Async because loading the encryption cipher (when enabled) is async.
 */
export async function createStorageBackend(
  settings: AppSettings,
): Promise<IStorageBackend> {
  const cipher: Cipher | undefined = settings.encryption?.enabled
    ? await loadCipher()
    : undefined;

  switch (settings.backendType) {
    case 'webdav': {
      if (!settings.webdav) {
        throw new Error('WebDAV configuration is missing');
      }
      return new WebDavBackend(settings.webdav, cipher);
    }
    case 's3': {
      if (!settings.s3) {
        throw new Error('S3 configuration is missing');
      }
      return new S3Backend(settings.s3, cipher);
    }
    default:
      throw new Error(`Unknown backend type: ${settings.backendType}`);
  }
}
