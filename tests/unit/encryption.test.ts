import { describe, it, expect, beforeEach } from 'vitest';
import {
  encryptString,
  decryptString,
  isEncryptedBody,
  extractSalt,
  createCipher,
  type EncryptedEnvelope,
} from '@/core/encryption';
import {
  initEncryption,
  loadCipher,
  isEncryptionSetup,
  getSaltB64,
  verifyPassword,
  changePassword,
  disableEncryption,
} from '@/config/key-manager';

const SALT_B64 = 'c29tZXNhbHRmb3J0ZXN0c3M='; // arbitrary base64 salt
const ITER = 100_000;

/** Generate a fresh AES-256-GCM key for pure-module tests. */
async function makeKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt'],
  );
}

describe('encryption - pure module', () => {
  it('should round-trip encrypt/decrypt a string', async () => {
    const key = await makeKey();
    const plaintext = JSON.stringify({ hello: 'world', n: 42 });

    const envelope = await encryptString(plaintext, key, SALT_B64, ITER);
    const decrypted = await decryptString(envelope, key);

    expect(decrypted).toBe(plaintext);
  });

  it('should round-trip unicode content', async () => {
    const key = await makeKey();
    const plaintext = '书签 🔖 bookmarks — café';

    const envelope = await encryptString(plaintext, key, SALT_B64, ITER);
    expect(await decryptString(envelope, key)).toBe(plaintext);
  });

  it('should produce a complete envelope with all fields', async () => {
    const key = await makeKey();
    const envelope = await encryptString('payload', key, SALT_B64, ITER);
    const parsed = JSON.parse(envelope) as EncryptedEnvelope;

    expect(parsed.enc).toBe(1);
    expect(parsed.alg).toBe('AES-GCM-256');
    expect(parsed.kdf).toBe('PBKDF2-SHA256');
    expect(parsed.iter).toBe(ITER);
    expect(parsed.salt).toBe(SALT_B64);
    expect(typeof parsed.iv).toBe('string');
    expect(parsed.iv.length).toBeGreaterThan(0);
    expect(typeof parsed.data).toBe('string');
    expect(parsed.data.length).toBeGreaterThan(0);
  });

  it('should use a fresh random IV per encryption', async () => {
    const key = await makeKey();
    const a = JSON.parse(await encryptString('same', key, SALT_B64, ITER)) as EncryptedEnvelope;
    const b = JSON.parse(await encryptString('same', key, SALT_B64, ITER)) as EncryptedEnvelope;

    expect(a.iv).not.toBe(b.iv);
    expect(a.data).not.toBe(b.data);
  });

  it('should fail to decrypt with a wrong key', async () => {
    const key = await makeKey();
    const wrongKey = await makeKey();
    const envelope = await encryptString('secret', key, SALT_B64, ITER);

    await expect(decryptString(envelope, wrongKey)).rejects.toThrow();
  });

  it('should reject a non-envelope body on decrypt', async () => {
    const key = await makeKey();
    await expect(decryptString('{"version":1}', key)).rejects.toThrow(
      /Not an encrypted envelope/,
    );
  });

  describe('isEncryptedBody', () => {
    it('should detect an encrypted envelope', async () => {
      const key = await makeKey();
      const envelope = await encryptString('x', key, SALT_B64, ITER);
      expect(isEncryptedBody(envelope)).toBe(true);
    });

    it('should return false for a plaintext snapshot', () => {
      expect(isEncryptedBody(JSON.stringify({ version: 1, tree: [] }))).toBe(false);
    });

    it('should return false for invalid JSON', () => {
      expect(isEncryptedBody('not json at all')).toBe(false);
    });
  });

  describe('extractSalt', () => {
    it('should extract salt from an envelope', async () => {
      const key = await makeKey();
      const envelope = await encryptString('x', key, SALT_B64, ITER);
      expect(extractSalt(envelope)).toBe(SALT_B64);
    });

    it('should return null for plaintext body', () => {
      expect(extractSalt(JSON.stringify({ version: 1 }))).toBeNull();
    });

    it('should return null for invalid JSON', () => {
      expect(extractSalt('garbage')).toBeNull();
    });
  });

  describe('createCipher', () => {
    it('should round-trip via the Cipher interface', async () => {
      const key = await makeKey();
      const cipher = createCipher(key, SALT_B64, ITER);

      const envelope = await cipher.encrypt('hello cipher');
      expect(isEncryptedBody(envelope)).toBe(true);
      expect(await cipher.decrypt(envelope)).toBe('hello cipher');
    });
  });
});

describe('key-manager - persistent key model', () => {
  beforeEach(async () => {
    // fakeBrowser is reset globally in setup.ts; ensure clean key store.
    await disableEncryption();
  });

  it('should report not setup initially', async () => {
    expect(await isEncryptionSetup()).toBe(false);
    expect(await getSaltB64()).toBeNull();
  });

  it('should initialize and persist key material', async () => {
    await initEncryption('master-pass');

    expect(await isEncryptionSetup()).toBe(true);
    expect(await getSaltB64()).toBeTruthy();
  });

  it('should load a working cipher after init', async () => {
    await initEncryption('master-pass');
    const cipher = await loadCipher();

    const envelope = await cipher.encrypt('roundtrip');
    expect(isEncryptedBody(envelope)).toBe(true);
    expect(await cipher.decrypt(envelope)).toBe('roundtrip');
  });

  it('should throw when loading cipher before init', async () => {
    await expect(loadCipher()).rejects.toThrow(/not initialized/);
  });

  it('should verify the correct password', async () => {
    await initEncryption('master-pass');
    expect(await verifyPassword('master-pass')).toBe(true);
    expect(await verifyPassword('wrong-pass')).toBe(false);
  });

  it('should reuse an existing salt when provided', async () => {
    await initEncryption('master-pass', SALT_B64);
    expect(await getSaltB64()).toBe(SALT_B64);
  });

  it('should derive identical keys on two devices sharing password + salt', async () => {
    // Device A initializes and produces the salt.
    await initEncryption('shared-pass');
    const salt = await getSaltB64();
    expect(salt).toBeTruthy();
    const cipherA = await loadCipher();
    const envelope = await cipherA.encrypt('cross-device');

    // Device B: simulate a fresh profile re-initializing with the same
    // password and the salt read from the remote envelope.
    await disableEncryption();
    await initEncryption('shared-pass', salt!);
    const cipherB = await loadCipher();

    expect(await cipherB.decrypt(envelope)).toBe('cross-device');
  });

  it('should change password and keep the same salt', async () => {
    await initEncryption('old-pass');
    const saltBefore = await getSaltB64();

    await changePassword('old-pass', 'new-pass');

    expect(await getSaltB64()).toBe(saltBefore);
    expect(await verifyPassword('new-pass')).toBe(true);
    expect(await verifyPassword('old-pass')).toBe(false);
  });

  it('should reject changePassword with a wrong old password', async () => {
    await initEncryption('old-pass');
    await expect(changePassword('nope', 'new-pass')).rejects.toThrow(
      /incorrect/,
    );
  });

  it('should remove key material on disable', async () => {
    await initEncryption('master-pass');
    expect(await isEncryptionSetup()).toBe(true);

    await disableEncryption();

    expect(await isEncryptionSetup()).toBe(false);
    expect(await getSaltB64()).toBeNull();
  });
});
