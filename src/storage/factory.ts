/**
 * Storage backend factory: instantiates the correct backend based on config.
 */

import type { AppSettings } from '@/core/types';
import type { IStorageBackend } from './types';
import { WebDavBackend } from './webdav';
import { S3Backend } from './s3';

/**
 * Create a storage backend instance from app settings.
 */
export function createStorageBackend(settings: AppSettings): IStorageBackend {
  switch (settings.backendType) {
    case 'webdav': {
      if (!settings.webdav) {
        throw new Error('WebDAV configuration is missing');
      }
      return new WebDavBackend(settings.webdav);
    }
    case 's3': {
      if (!settings.s3) {
        throw new Error('S3 configuration is missing');
      }
      return new S3Backend(settings.s3);
    }
    default:
      throw new Error(`Unknown backend type: ${settings.backendType}`);
  }
}
