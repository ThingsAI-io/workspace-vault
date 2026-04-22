import { Encrypter, Decrypter } from 'age-encryption';
import { InvalidKeyError } from '../types.js';

/**
 * Encrypt a buffer for one or more age recipients (public keys).
 */
export async function encrypt(
  plaintext: Buffer,
  recipients: string[],
): Promise<Buffer> {
  const e = new Encrypter();
  for (const r of recipients) {
    e.addRecipient(r);
  }
  const ciphertext = await e.encrypt(plaintext);
  return Buffer.from(ciphertext);
}

/**
 * Decrypt a buffer using an age identity (private key).
 */
export async function decrypt(
  ciphertext: Buffer,
  identity: string,
): Promise<Buffer> {
  try {
    const d = new Decrypter();
    d.addIdentity(identity);
    const plaintext = await d.decrypt(ciphertext);
    return Buffer.from(plaintext);
  } catch (err) {
    throw new InvalidKeyError(
      err instanceof Error ? err.message : 'Decryption failed',
    );
  }
}

/**
 * Encrypt a buffer using a passphrase (age scrypt-based).
 */
export async function encryptWithPassphrase(
  plaintext: Buffer,
  passphrase: string,
): Promise<Buffer> {
  const e = new Encrypter();
  e.setPassphrase(passphrase);
  e.setScryptWorkFactor(18);
  const ciphertext = await e.encrypt(plaintext);
  return Buffer.from(ciphertext);
}

/**
 * Decrypt a buffer using a passphrase (age scrypt-based).
 */
export async function decryptWithPassphrase(
  ciphertext: Buffer,
  passphrase: string,
): Promise<Buffer> {
  try {
    const d = new Decrypter();
    d.addPassphrase(passphrase);
    const plaintext = await d.decrypt(ciphertext);
    return Buffer.from(plaintext);
  } catch (err) {
    throw new InvalidKeyError(
      err instanceof Error ? err.message : 'Decryption failed',
    );
  }
}
