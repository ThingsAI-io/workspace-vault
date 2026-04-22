import { describe, it, expect } from 'vitest';
import {
  encrypt,
  decrypt,
  encryptWithPassphrase,
  decryptWithPassphrase,
  generateKeyPair,
  passphraseToIdentity,
  generateSalt,
  wrapMasterKey,
  unwrapMasterKey,
  wrapMasterKeyWithPassphrase,
} from '../../src/crypto/index.js';
import { InvalidKeyError } from '../../src/types.js';

describe('crypto/age', () => {
  it('encrypts and decrypts a buffer round-trip', async () => {
    const { publicKey, privateKey } = await generateKeyPair();
    const plaintext = Buffer.from('hello, age encryption!');
    const ciphertext = await encrypt(plaintext, [publicKey]);
    const decrypted = await decrypt(ciphertext, privateKey);
    expect(decrypted).toEqual(plaintext);
  });

  it('decryption with wrong key throws InvalidKeyError', async () => {
    const { publicKey } = await generateKeyPair();
    const { privateKey: wrongKey } = await generateKeyPair();
    const plaintext = Buffer.from('secret data');
    const ciphertext = await encrypt(plaintext, [publicKey]);
    await expect(decrypt(ciphertext, wrongKey)).rejects.toThrow(InvalidKeyError);
  });

  it('handles empty buffer', async () => {
    const { publicKey, privateKey } = await generateKeyPair();
    const plaintext = Buffer.alloc(0);
    const ciphertext = await encrypt(plaintext, [publicKey]);
    const decrypted = await decrypt(ciphertext, privateKey);
    expect(decrypted).toEqual(plaintext);
  });

  it('handles large buffer (1MB)', async () => {
    const { publicKey, privateKey } = await generateKeyPair();
    const plaintext = Buffer.alloc(1024 * 1024, 0xab);
    const ciphertext = await encrypt(plaintext, [publicKey]);
    const decrypted = await decrypt(ciphertext, privateKey);
    expect(decrypted).toEqual(plaintext);
  });

  it('supports multiple recipients', async () => {
    const kp1 = await generateKeyPair();
    const kp2 = await generateKeyPair();
    const plaintext = Buffer.from('shared secret');
    const ciphertext = await encrypt(plaintext, [kp1.publicKey, kp2.publicKey]);

    const decrypted1 = await decrypt(ciphertext, kp1.privateKey);
    expect(decrypted1).toEqual(plaintext);

    const decrypted2 = await decrypt(ciphertext, kp2.privateKey);
    expect(decrypted2).toEqual(plaintext);
  });
});

describe('crypto/age passphrase', () => {
  it('encrypts and decrypts with passphrase round-trip', async () => {
    const plaintext = Buffer.from('passphrase-protected data');
    const passphrase = 'my-strong-passphrase-123';
    const ciphertext = await encryptWithPassphrase(plaintext, passphrase);
    const decrypted = await decryptWithPassphrase(ciphertext, passphrase);
    expect(decrypted).toEqual(plaintext);
  });

  it('decryption with wrong passphrase throws InvalidKeyError', async () => {
    const plaintext = Buffer.from('secret');
    const ciphertext = await encryptWithPassphrase(plaintext, 'correct-pass');
    await expect(
      decryptWithPassphrase(ciphertext, 'wrong-pass'),
    ).rejects.toThrow(InvalidKeyError);
  });
});

describe('crypto/keys', () => {
  it('generates a valid age keypair', async () => {
    const { publicKey, privateKey } = await generateKeyPair();
    expect(publicKey).toMatch(/^age1/);
    expect(privateKey).toMatch(/^AGE-SECRET-KEY-1/);
  });

  it('passphraseToIdentity is deterministic for same passphrase+salt', async () => {
    const salt = generateSalt();
    const a = await passphraseToIdentity('test-passphrase', salt);
    const b = await passphraseToIdentity('test-passphrase', salt);
    expect(a.identity).toBe(b.identity);
    expect(a.publicKey).toBe(b.publicKey);
  });

  it('passphraseToIdentity differs for different passphrases', async () => {
    const salt = generateSalt();
    const a = await passphraseToIdentity('passphrase-one', salt);
    const b = await passphraseToIdentity('passphrase-two', salt);
    expect(a.identity).not.toBe(b.identity);
    expect(a.publicKey).not.toBe(b.publicKey);
  });

  it('passphraseToIdentity differs for different salts', async () => {
    const a = await passphraseToIdentity('same-pass', generateSalt());
    const b = await passphraseToIdentity('same-pass', generateSalt());
    expect(a.identity).not.toBe(b.identity);
    expect(a.publicKey).not.toBe(b.publicKey);
  });

  it('generateSalt returns unique values', () => {
    const salts = new Set(Array.from({ length: 10 }, () => generateSalt()));
    expect(salts.size).toBe(10);
  });

  it('generateSalt returns 64 hex characters (32 bytes)', () => {
    const salt = generateSalt();
    expect(salt).toMatch(/^[0-9a-f]{64}$/);
  });

  it('wrapMasterKey + unwrapMasterKey round-trip works', async () => {
    const masterKp = await generateKeyPair();
    const recipientKp = await generateKeyPair();

    const wrapped = await wrapMasterKey(masterKp.privateKey, recipientKp.publicKey);
    const unwrapped = await unwrapMasterKey(wrapped, recipientKp.privateKey);
    expect(unwrapped).toBe(masterKp.privateKey);
  });

  it('unwrapMasterKey with wrong identity throws InvalidKeyError', async () => {
    const masterKp = await generateKeyPair();
    const recipientKp = await generateKeyPair();
    const wrongKp = await generateKeyPair();

    const wrapped = await wrapMasterKey(masterKp.privateKey, recipientKp.publicKey);
    await expect(unwrapMasterKey(wrapped, wrongKp.privateKey)).rejects.toThrow(
      InvalidKeyError,
    );
  });

  it('wrapMasterKeyWithPassphrase + unwrapMasterKey round-trip works', async () => {
    const masterKp = await generateKeyPair();
    const salt = generateSalt();
    const { identity } = await passphraseToIdentity('my-vault-passphrase', salt);

    const wrapped = await wrapMasterKeyWithPassphrase(masterKp.privateKey, identity);
    const unwrapped = await unwrapMasterKey(wrapped, identity);
    expect(unwrapped).toBe(masterKp.privateKey);
  });

  it('unwrapMasterKey with wrong passphrase identity throws InvalidKeyError', async () => {
    const masterKp = await generateKeyPair();
    const salt = generateSalt();
    const { identity } = await passphraseToIdentity('correct-passphrase', salt);
    const { identity: wrongIdentity } = await passphraseToIdentity('wrong-passphrase', salt);

    const wrapped = await wrapMasterKeyWithPassphrase(masterKp.privateKey, identity);
    await expect(unwrapMasterKey(wrapped, wrongIdentity)).rejects.toThrow(
      InvalidKeyError,
    );
  });
});
