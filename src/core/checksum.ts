/**
 * SHA-256 checksum computation and verification.
 * This module has ZERO browser API dependencies.
 */

import { canonicalStringify } from './serializer';
import type { BookmarkNode, SyncSnapshot } from './types';

/**
 * Compute SHA-256 hash of a string, returning full hex string.
 */
export async function sha256(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Compute the checksum of a bookmark tree.
 * Uses canonical JSON serialization for deterministic output.
 */
export async function computeTreeChecksum(tree: BookmarkNode[]): Promise<string> {
  const canonical = canonicalStringify(tree);
  return sha256(canonical);
}

/**
 * Compute the checksum of a sync snapshot (excluding the checksum field itself).
 */
export async function computeSnapshotChecksum(
  snapshot: Omit<SyncSnapshot, 'checksum'>,
): Promise<string> {
  const { checksum: _excluded, ...rest } = snapshot as SyncSnapshot;
  void _excluded;
  const canonical = canonicalStringify(rest);
  return sha256(canonical);
}

/**
 * Verify that a snapshot's checksum matches its content.
 * Returns true if valid, false if corrupted.
 */
export async function verifySnapshotChecksum(
  snapshot: SyncSnapshot,
): Promise<boolean> {
  const computed = await computeSnapshotChecksum(snapshot);
  return computed === snapshot.checksum;
}
