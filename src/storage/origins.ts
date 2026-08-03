/**
 * Compute the host origins the extension needs permission for, based on the
 * configured storage backend. Used to request optional host permissions before
 * making cross-origin requests from the background service worker.
 */

import type { AppSettings } from '@/core/types';

/**
 * Return the list of origin match patterns (e.g. "https://dav.example.com/*")
 * required to reach the configured backend. Returns [] if the config is
 * incomplete or the URL is invalid.
 */
export function getRequiredOrigins(settings: AppSettings): string[] {
  try {
    if (settings.backendType === 'webdav' && settings.webdav?.url) {
      return [`${new URL(settings.webdav.url).origin}/*`];
    }

    if (settings.backendType === 's3' && settings.s3) {
      // S3-compatible service with a custom endpoint
      if (settings.s3.endpoint) {
        const endpoint = settings.s3.endpoint.replace(/\/+$/, '');
        if (settings.s3.pathStyle) {
          // Path style: requests target the endpoint origin directly
          return [`${new URL(endpoint).origin}/*`];
        }
        // Virtual-hosted style: bucket is a subdomain of the endpoint host
        const url = new URL(endpoint);
        return [`${url.protocol}//${settings.s3.bucket}.${url.host}/*`];
      }
      // AWS S3 virtual-hosted style
      const region = settings.s3.region || 'us-east-1';
      return [`https://${settings.s3.bucket}.s3.${region}.amazonaws.com/*`];
    }
  } catch {
    // Invalid URL — validation elsewhere will surface the problem
    return [];
  }

  return [];
}
