/**
 * Client-side end-to-end encryption for remote snapshots.
 * This module has ZERO browser API dependencies (uses only Web Crypto) and can
 * be tested in pure Node.js.
 *
 * The remote object body is either:
 * - a plaintext snapshot JSON (legacy / encryption disabled), or
 * - an {@link EncryptedEnvelope} JSON: { enc: 1, alg, kdf, iter, salt, iv, data }.
 *
 * The AES-256-GCM key is derived elsewhere (see config/key-manager.ts) and passed
 * in already-imported. The `salt` travels inside the envelope so that any device
 * sharing the same master password can derive the identical key.
 */

const IV_LENGTH = 12;

/** JSON envelope wrapping an encrypted snapshot payload. */
export interface EncryptedEnvelope {
  /** Marker identifying an encrypted body */
  enc: 1;
  /** Cipher algorithm */
  alg: 'AES-GCM-256';
  /** Key derivation function (informational; key is derived by key-manager) */
  kdf: 'PBKDF2-SHA256';
  /** PBKDF2 iteration count used to derive the key */
  iter: number;
  /** base64 PBKDF2 salt (shared across devices via the envelope) */
  salt: string;
  /** base64 per-snapshot initialization vector */
  iv: string;
  /** base64 ciphertext of the snapshot JSON */
  data: string;
}

/** A symmetric encrypt/decrypt pair bound to a single key. */
export interface Cipher {
  encrypt(plaintext: string): Promise<string>;
  decrypt(envelope: string): Promise<string>;
}

/** base64 encode that is safe for large byte arrays (avoids arg-spread limits). */
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

/**
 * Encrypt a plaintext string into an envelope JSON string.
 * A fresh random IV is generated for every call.
 */
export async function encryptString(
  plaintext: string,
  key: CryptoKey,
  saltB64: string,
  iterations: number,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  );

  const envelope: EncryptedEnvelope = {
    enc: 1,
    alg: 'AES-GCM-256',
    kdf: 'PBKDF2-SHA256',
    iter: iterations,
    salt: saltB64,
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(ciphertext)),
  };
  return JSON.stringify(envelope);
}

/**
 * Decrypt an envelope JSON string back to plaintext using an imported key.
 * Throws if the body is not a valid envelope or the key is wrong.
 */
export async function decryptString(
  envelopeJson: string,
  key: CryptoKey,
): Promise<string> {
  const envelope = JSON.parse(envelopeJson) as EncryptedEnvelope;
  if (envelope.enc !== 1) {
    throw new Error('Not an encrypted envelope');
  }
  const iv = base64ToBytes(envelope.iv);
  const ciphertext = base64ToBytes(envelope.data);
  const plainBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext,
  );
  return new TextDecoder().decode(plainBuffer);
}

/** Detect whether a remote body is an encrypted envelope (vs plaintext JSON). */
export function isEncryptedBody(body: string): boolean {
  try {
    const parsed = JSON.parse(body) as { enc?: unknown };
    return parsed?.enc === 1;
  } catch {
    return false;
  }
}

/** Extract the base64 salt from an encrypted envelope, or null if not encrypted. */
export function extractSalt(envelopeJson: string): string | null {
  try {
    const parsed = JSON.parse(envelopeJson) as EncryptedEnvelope;
    return parsed.enc === 1 ? parsed.salt : null;
  } catch {
    return null;
  }
}

/** Build a Cipher bound to a specific key, salt, and iteration count. */
export function createCipher(
  key: CryptoKey,
  saltB64: string,
  iterations: number,
): Cipher {
  return {
    encrypt: (plaintext) => encryptString(plaintext, key, saltB64, iterations),
    decrypt: (envelope) => decryptString(envelope, key),
  };
}
