/**
 * Device override logic: skip merge, use one device's data as the source of truth.
 * This module has ZERO browser API dependencies.
 */

import type { BookmarkNode, SyncSnapshot } from './types';
import { computeSnapshotChecksum } from './checksum';

/**
 * Create a force-override snapshot from a device's bookmark tree.
 * This snapshot will signal other devices to discard their local state.
 */
export async function createOverrideSnapshot(
  tree: BookmarkNode[],
  deviceId: string,
  currentRevision: number,
): Promise<SyncSnapshot> {
  const snapshotWithoutChecksum = {
    version: 1 as const,
    revision: currentRevision + 1,
    deviceId,
    timestamp: Date.now(),
    tree,
    forceOverride: true,
  };

  const checksum = await computeSnapshotChecksum(snapshotWithoutChecksum);

  return {
    ...snapshotWithoutChecksum,
    checksum,
  };
}

/**
 * Check if a remote snapshot is a force-override from another device.
 */
export function isForceOverride(
  snapshot: SyncSnapshot,
  localDeviceId: string,
): boolean {
  return snapshot.forceOverride === true && snapshot.deviceId !== localDeviceId;
}
