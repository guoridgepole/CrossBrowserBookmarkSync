/**
 * Credential encryption using Web Crypto API (AES-256-GCM).
 * Encrypts sensitive data (S3 keys, WebDAV passwords) before storing in chrome.storage.local.
 */

const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const ITERATIONS = 100_000;

/**
 * Derive an AES-256-GCM key from a master password using PBKDF2.
 */
export async function deriveKey(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypt a plaintext string with a master password.
 * Returns a base64-encoded string containing: salt (16B) | iv (12B) | ciphertext.
 */
export async function encrypt(
  plaintext: string,
  masterPassword: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(masterPassword, salt);

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(plaintext),
  );

  // Combine: salt | iv | ciphertext
  const combined = new Uint8Array(
    salt.length + iv.length + ciphertext.byteLength,
  );
  combined.set(salt, 0);
  combined.set(iv, salt.length);
  combined.set(new Uint8Array(ciphertext), salt.length + iv.length);

  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt a base64-encoded ciphertext with a master password.
 */
export async function decrypt(
  encoded: string,
  masterPassword: string,
): Promise<string> {
  const combined = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));

  const salt = combined.slice(0, SALT_LENGTH);
  const iv = combined.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const ciphertext = combined.slice(SALT_LENGTH + IV_LENGTH);

  const key = await deriveKey(masterPassword, salt);

  const plainBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext,
  );

  return new TextDecoder().decode(plainBuffer);
}

/**
 * Store an encrypted credential in chrome.storage.local.
 */
export async function storeEncryptedCredential(
  key: string,
  value: string,
  masterPassword: string,
): Promise<void> {
  const encrypted = await encrypt(value, masterPassword);
  await browser.storage.local.set({ [`cred_${key}`]: encrypted });
}

/**
 * Retrieve and decrypt a credential from chrome.storage.local.
 */
export async function getDecryptedCredential(
  key: string,
  masterPassword: string,
): Promise<string | null> {
  const result = await browser.storage.local.get(`cred_${key}`);
  const encrypted = result[`cred_${key}`] as string | undefined;
  if (!encrypted) return null;

  try {
    return await decrypt(encrypted, masterPassword);
  } catch {
    return null; // Wrong password or corrupted data
  }
}
