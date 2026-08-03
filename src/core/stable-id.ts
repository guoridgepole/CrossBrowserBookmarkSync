/**
 * Stable ID generation for cross-browser bookmark deduplication.
 * This module has ZERO browser API dependencies.
 *
 * Algorithm:
 * - URL bookmarks: SHA-256(normalizeURL(url) + '|' + title.trim().toLowerCase()) → first 16 hex chars
 * - Folders: SHA-256(parentStableId + '|' + title.trim().toLowerCase()) → first 16 hex chars
 * - Separators: SHA-256(parentStableId + '|separator|' + index) → first 16 hex chars
 */

import { ROOT_IDS, ROOT_NAME_MAP } from './types';

/**
 * Normalize a URL for consistent comparison across browsers.
 * - Lowercase scheme and host
 * - Remove trailing slash (unless it's just the domain root)
 * - Remove fragment (#...)
 * - Remove default ports (80 for http, 443 for https)
 */
export function normalizeURL(url: string): string {
  try {
    const parsed = new URL(url);
    // Lowercase protocol and hostname
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();
    // Remove default ports
    if (
      (parsed.protocol === 'http:' && parsed.port === '80') ||
      (parsed.protocol === 'https:' && parsed.port === '443')
    ) {
      parsed.port = '';
    }
    // Remove fragment
    parsed.hash = '';
    // Get the normalized string
    let normalized = parsed.toString();
    // Remove trailing slash if path is just "/"
    if (normalized.endsWith('/') && parsed.pathname === '/') {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  } catch {
    // If URL parsing fails, return trimmed lowercase
    return url.trim().toLowerCase();
  }
}

/**
 * Compute SHA-256 hash and return first 16 hex characters.
 * Uses Web Crypto API (available in both browser and Node.js 18+).
 */
export async function sha256Short(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  return hashHex.slice(0, 16);
}

/**
 * Generate a stable ID for a bookmark (URL) node.
 */
export async function generateBookmarkStableId(
  url: string,
  title: string,
): Promise<string> {
  const input = `${normalizeURL(url)}|${title.trim().toLowerCase()}`;
  return sha256Short(input);
}

/**
 * Generate a stable ID for a folder node.
 */
export async function generateFolderStableId(
  parentStableId: string,
  title: string,
): Promise<string> {
  const input = `${parentStableId}|${title.trim().toLowerCase()}`;
  return sha256Short(input);
}

/**
 * Generate a stable ID for a separator node.
 */
export async function generateSeparatorStableId(
  parentStableId: string,
  index: number,
): Promise<string> {
  const input = `${parentStableId}|separator|${index}`;
  return sha256Short(input);
}

/**
 * Resolve a root folder's stable ID from its title.
 * Returns the well-known root ID if recognized, otherwise generates one.
 */
export function resolveRootStableId(title: string): string | null {
  const key = ROOT_NAME_MAP[title];
  if (key) {
    return ROOT_IDS[key];
  }
  return null;
}
