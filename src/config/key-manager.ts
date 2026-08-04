/**
 * Master-password key management for snapshot encryption (persistent-key model).
 *
 * Model: the user sets a master password once. We derive an AES-256-GCM key via
 * PBKDF2, EXPORT the raw key, and persist it in chrome.storage.local so the
 * background service worker can encrypt/decrypt during unattended auto-sync
 * without ever needing the password again. The password is only used at setup
 * and when changing it.
 *
 * Multi-device: the PBKDF2 salt is shared via the remote envelope, so every
 * device using the SAME master password derives the IDENTICAL key.
 *
 * Security note: because the raw key is persisted, confidentiality rests on the
 * browser profile not being accessed by others (an informed user choice).
 */

import { createCipher, decryptString, type Cipher } from '@/core/encryption';

const KEY_KEY = 'bmsync_enc_key'; // base64 raw AES-256 key
const SALT_KEY = 'bmsync_enc_salt'; // base64 PBKDF2 salt
const VERIFY_KEY = 'bmsync_enc_verify'; // encrypted marker for password checks

const ITERATIONS = 100_000;
const SALT_LENGTH = 16;
const VERIFY_MARKER = 'bookmark-sync-verify-v1';

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Derive an EXTRACTABLE AES-256-GCM key so the raw bytes can be persisted. */
async function deriveExtractableKey(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    true, // extractable → we persist the raw key
    ['encrypt', 'decrypt'],
  );
}

/** Import a persisted raw key as a non-extractable CryptoKey. */
async function importRawKey(rawB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    base64ToBytes(rawB64),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Initialize encryption: derive a key from the password, persist the raw key,
 * salt, and a verification blob.
 *
 * @param password master password
 * @param existingSaltB64 salt read from an existing remote envelope (so this
 *   device derives the same key as other devices); random if omitted.
 */
export async function initEncryption(
  password: string,
  existingSaltB64?: string,
): Promise<void> {
  const salt = existingSaltB64
    ? base64ToBytes(existingSaltB64)
    : crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const saltB64 = existingSaltB64 ?? bytesToBase64(salt);

  const key = await deriveExtractableKey(password, salt);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));

  const cipher = createCipher(key, saltB64, ITERATIONS);
  const verify = await cipher.encrypt(VERIFY_MARKER);

  await browser.storage.local.set({
    [KEY_KEY]: bytesToBase64(raw),
    [SALT_KEY]: saltB64,
    [VERIFY_KEY]: verify,
  });
}

/**
 * Load the persisted key and return a ready-to-use Cipher.
 * Throws if encryption has not been initialized on this device.
 */
export async function loadCipher(): Promise<Cipher> {
  const result = await browser.storage.local.get([KEY_KEY, SALT_KEY]);
  const rawB64 = result[KEY_KEY] as string | undefined;
  const saltB64 = result[SALT_KEY] as string | undefined;
  if (!rawB64 || !saltB64) {
    throw new Error('Encryption is not initialized on this device');
  }
  const key = await importRawKey(rawB64);
  return createCipher(key, saltB64, ITERATIONS);
}

/** Whether a key has been persisted (encryption set up on this device). */
export async function isEncryptionSetup(): Promise<boolean> {
  const result = await browser.storage.local.get(KEY_KEY);
  return typeof result[KEY_KEY] === 'string';
}

/** Get the stored base64 salt, or null if not initialized. */
export async function getSaltB64(): Promise<string | null> {
  const result = await browser.storage.local.get(SALT_KEY);
  return (result[SALT_KEY] as string | undefined) ?? null;
}

/**
 * Verify a password against the stored verification blob.
 * Returns false if not initialized or the password is wrong.
 */
export async function verifyPassword(password: string): Promise<boolean> {
  const result = await browser.storage.local.get([SALT_KEY, VERIFY_KEY]);
  const saltB64 = result[SALT_KEY] as string | undefined;
  const verify = result[VERIFY_KEY] as string | undefined;
  if (!saltB64 || !verify) return false;
  try {
    const key = await deriveExtractableKey(password, base64ToBytes(saltB64));
    const marker = await decryptString(verify, key);
    return marker === VERIFY_MARKER;
  } catch {
    return false;
  }
}

/**
 * Change the master password: re-derive the key with the same salt and persist
 * the new raw key. Other devices must be updated to the new password.
 * Throws if the old password is incorrect.
 */
export async function changePassword(
  oldPassword: string,
  newPassword: string,
): Promise<void> {
  if (!(await verifyPassword(oldPassword))) {
    throw new Error('Current master password is incorrect');
  }
  const saltB64 = await getSaltB64();
  if (!saltB64) {
    throw new Error('Encryption is not initialized on this device');
  }
  // Re-init with the same salt but the new password.
  await initEncryption(newPassword, saltB64);
}

/** Remove all persisted key material (disables encryption on this device). */
export async function disableEncryption(): Promise<void> {
  await browser.storage.local.remove([KEY_KEY, SALT_KEY, VERIFY_KEY]);
}
