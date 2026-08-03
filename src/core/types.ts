/**
 * Unified bookmark data model.
 * This module has ZERO browser API dependencies and can be tested in pure Node.js.
 */

/** Bookmark node type */
export type NodeType = 'folder' | 'bookmark' | 'separator';

/**
 * A unified bookmark node that works across Chrome and Firefox.
 * The `stableId` is the key for deduplication and merging.
 */
export interface BookmarkNode {
  /** Cross-browser unique identifier (SHA-256 derived) */
  stableId: string;
  /** Node type */
  type: NodeType;
  /** Display title */
  title: string;
  /** URL (only for bookmark type) */
  url?: string;
  /** Child nodes (only for folder type) */
  children?: BookmarkNode[];
  /** Creation time (Unix ms) */
  dateAdded: number;
  /** Last modification time (Unix ms) */
  lastModified: number;
  /** Soft delete marker (tombstone) */
  deleted?: boolean;
}

/**
 * A sync snapshot representing the full bookmark state at a point in time.
 * This is what gets serialized and stored on the remote backend.
 */
export interface SyncSnapshot {
  /** Schema version for future migrations */
  version: 1;
  /** Monotonically increasing revision number (optimistic concurrency control) */
  revision: number;
  /** Device that last modified this snapshot */
  deviceId: string;
  /** Timestamp of last modification (Unix ms) */
  timestamp: number;
  /** SHA-256 checksum of the canonical JSON representation */
  checksum: string;
  /** The bookmark tree (root-level nodes) */
  tree: BookmarkNode[];
  /** Whether this snapshot was created by a force-override operation */
  forceOverride?: boolean;
}

/** Well-known root folder stable IDs */
export const ROOT_IDS = {
  toolbar: 'root-toolbar',
  menu: 'root-menu',
  other: 'root-other',
  mobile: 'root-mobile',
} as const;

/** Root folder name mappings across browsers (multilingual fallback) */
export const ROOT_NAME_MAP: Record<string, keyof typeof ROOT_IDS> = {
  // Chrome names (English)
  'Bookmarks bar': 'toolbar',
  'Bookmarks Bar': 'toolbar',
  'Other bookmarks': 'other',
  'Mobile bookmarks': 'mobile',
  'Mobile Bookmarks': 'mobile',
  // Firefox names (English)
  'Bookmarks Toolbar': 'toolbar',
  'Bookmarks Menu': 'menu',
  'Other Bookmarks': 'other',
  // Chinese (简体中文)
  '书签栏': 'toolbar',
  '其他书签': 'other',
  '移动设备书签': 'mobile',
  '书签工具栏': 'toolbar',
  '书签菜单': 'menu',
  '移动书签': 'mobile',
  // Japanese (日本語)
  'ブックマーク バー': 'toolbar',
  'その他のブックマーク': 'other',
  'モバイルのブックマーク': 'mobile',
  // German (Deutsch)
  'Lesezeichenleiste': 'toolbar',
  'Weitere Lesezeichen': 'other',
  'Mobile Lesezeichen': 'mobile',
};

/**
 * Map browser-native root folder IDs to well-known roots.
 * These IDs are fixed per browser and language-independent, making them the
 * most reliable way to identify root folders across locales.
 */
export const ROOT_BROWSER_ID_MAP: Record<string, keyof typeof ROOT_IDS> = {
  // Chrome root folder IDs (fixed: 1=toolbar, 2=other, 3=mobile)
  '1': 'toolbar',
  '2': 'other',
  '3': 'mobile',
  // Firefox root folder IDs
  toolbar_____: 'toolbar',
  menu________: 'menu',
  unfiled_____: 'other',
  mobile______: 'mobile',
};

/** Set of all well-known root folder stable IDs */
export const ROOT_STABLE_IDS: ReadonlySet<string> = new Set<string>(
  Object.values(ROOT_IDS),
);

/**
 * Check whether a stableId refers to a well-known root folder.
 * Root folders are browser-managed immutable anchors and must never be
 * created, updated, moved, or removed by the sync engine.
 */
export function isRootFolder(stableId: string): boolean {
  return ROOT_STABLE_IDS.has(stableId);
}

/**
 * Sync operation types for the diff engine and WAL.
 */
export type SyncOperationType = 'CREATE' | 'UPDATE' | 'MOVE' | 'REMOVE';

/** A single sync operation to be applied to the browser bookmark tree */
export interface SyncOperation {
  /** Unique operation ID for idempotent execution */
  opId: string;
  /** Operation type */
  type: SyncOperationType;
  /** Target node stableId */
  stableId: string;
  /** Parent stableId (for CREATE and MOVE) */
  parentStableId?: string;
  /** Position index within parent (for ordering) */
  index?: number;
  /** Node data (for CREATE and UPDATE) */
  node?: BookmarkNode;
  /** New title (for UPDATE) */
  title?: string;
  /** New URL (for UPDATE) */
  url?: string;
}

/** Sync engine state machine states */
export type SyncState =
  | 'IDLE'
  | 'READING_LOCAL'
  | 'DOWNLOADING'
  | 'MERGING'
  | 'UPLOADING'
  | 'WRITING_LOCAL'
  | 'DONE'
  | 'ERROR';

/** Sync status info stored in chrome.storage */
export interface SyncStatus {
  state: SyncState;
  lastSyncTime: number | null;
  lastError: string | null;
  lastSyncRevision: number | null;
}

/** Storage backend configuration */
export interface WebDavConfig {
  url: string;
  username: string;
  password: string;
}

export interface S3Config {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  key?: string;
  /**
   * URL addressing style for custom endpoints.
   * - true  → path-style:     {endpoint}/{bucket}/{key}        (MinIO, self-hosted)
   * - false → virtual-hosted: {bucket}.{endpoint-host}/{key}   (AWS, Tencent COS, Cloudflare R2)
   * Defaults to virtual-hosted when unset.
   */
  pathStyle?: boolean;
}

export type BackendType = 'webdav' | 's3';

export interface AppSettings {
  backendType: BackendType;
  webdav?: WebDavConfig;
  s3?: S3Config;
  syncIntervalMinutes: number;
  deviceId: string;
}

/** Custom error types */
export class SyncError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'SyncError';
  }
}

export class StorageError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}
