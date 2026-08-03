/**
 * Snapshot serialization/deserialization with deterministic JSON output.
 * This module has ZERO browser API dependencies.
 */

import type { BookmarkNode, SyncSnapshot } from './types';

/**
 * Serialize a value to deterministic JSON (sorted keys).
 * This ensures the same data always produces the same JSON string,
 * which is critical for checksum consistency across devices.
 */
export function canonicalStringify(value: unknown): string {
  return JSON.stringify(value, sortKeysReplacer);
}

/**
 * JSON.stringify replacer that sorts object keys alphabetically.
 */
function sortKeysReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[k] = (value as Record<string, unknown>)[k];
    }
    return sorted;
  }
  return value;
}

/**
 * Serialize a SyncSnapshot to a JSON string for storage/upload.
 */
export function serializeSnapshot(snapshot: SyncSnapshot): string {
  return canonicalStringify(snapshot);
}

/**
 * Deserialize a JSON string to a SyncSnapshot.
 * Validates the basic structure before returning.
 */
export function deserializeSnapshot(json: string): SyncSnapshot {
  const parsed = JSON.parse(json) as SyncSnapshot;

  if (parsed.version !== 1) {
    throw new Error(`Unsupported snapshot version: ${parsed.version}`);
  }
  if (!Array.isArray(parsed.tree)) {
    throw new Error('Invalid snapshot: tree must be an array');
  }
  if (typeof parsed.revision !== 'number') {
    throw new Error('Invalid snapshot: revision must be a number');
  }
  if (typeof parsed.deviceId !== 'string') {
    throw new Error('Invalid snapshot: deviceId must be a string');
  }

  return parsed;
}

/**
 * Serialize a bookmark tree (array of nodes) to JSON.
 */
export function serializeTree(tree: BookmarkNode[]): string {
  return canonicalStringify(tree);
}

/**
 * Deserialize a bookmark tree from JSON.
 */
export function deserializeTree(json: string): BookmarkNode[] {
  const parsed = JSON.parse(json);
  if (!Array.isArray(parsed)) {
    throw new Error('Invalid tree: must be an array');
  }
  return parsed as BookmarkNode[];
}
