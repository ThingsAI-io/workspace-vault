import { randomBytes } from 'node:crypto';
import { generateIdentity, identityToRecipient } from 'age-encryption';
import { InvalidKeyError } from '../types.js';
import { encrypt, decrypt, encryptWithPassphrase, decryptWithPassphrase } from './age.js';

/**
 * Generate a new age keypair for use as a master key.
 */
export async function generateKeyPair(): Promise<{
  publicKey: string;
  privateKey: string;
}> {
  const privateKey = await generateIdentity();
  const publicKey = await identityToRecipient(privateKey);
  return { publicKey, privateKey };
}

/**
 * Derive an age-compatible identity from a passphrase using age's native
 * scrypt-based passphrase encryption. The salt is mixed into the passphrase
 * to ensure uniqueness across vaults.
 *
 * Returns an opaque identity string (the combined passphrase+salt) and its
 * corresponding "public key" (which is not a real public key — passphrase
 * identities are symmetric). The identity is used with encryptWithPassphrase /
 * decryptWithPassphrase rather than the X25519 encrypt/decrypt.
 */
export async function passphraseToIdentity(
  passphrase: string,
  salt: string,
): Promise<{ publicKey: string; identity: string }> {
  // Combine passphrase and salt to create a deterministic, unique identity.
  // age's scrypt recipient handles the actual KDF internally.
  const identity = `${passphrase}:${salt}`;

  // Generate a deterministic keypair by using passphrase-encrypted master key.
  // For passphrase-based identities we use the combined string directly.
  // The "publicKey" here is a hash-based identifier for the passphrase identity.
  const { createHash } = await import('node:crypto');
  const publicKey = `passphrase:${createHash('sha256').update(identity).digest('hex').slice(0, 16)}`;

  return { publicKey, identity };
}

/**
 * Generate a random salt for passphrase derivation.
 * Returns 32 random bytes, hex-encoded.
 */
export function generateSalt(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Wrap (encrypt) a master key's private key for a recipient public key.
 */
export async function wrapMasterKey(
  masterPrivateKey: string,
  recipientPublicKey: string,
): Promise<Buffer> {
  return encrypt(Buffer.from(masterPrivateKey, 'utf-8'), [recipientPublicKey]);
}

/**
 * Unwrap (decrypt) a master key's private key using an identity string.
 * If the identity starts with "passphrase:", it was created via
 * passphraseToIdentity and we use passphrase-based decryption.
 */
export async function unwrapMasterKey(wrappedKey: Buffer, identity: string): Promise<string> {
  try {
    // If this is a passphrase-derived identity (from passphraseToIdentity),
    // use passphrase-based decryption.
    if (identity.includes(':')) {
      const plaintext = await decryptWithPassphrase(wrappedKey, identity);
      return plaintext.toString('utf-8');
    }
    // Otherwise it's a native age identity (AGE-SECRET-KEY-1...)
    const plaintext = await decrypt(wrappedKey, identity);
    return plaintext.toString('utf-8');
  } catch (err) {
    if (err instanceof InvalidKeyError) throw err;
    throw new InvalidKeyError(err instanceof Error ? err.message : 'Failed to unwrap master key');
  }
}

/**
 * Wrap a master key's private key for a passphrase-derived identity.
 */
export async function wrapMasterKeyWithPassphrase(
  masterPrivateKey: string,
  passphraseIdentity: string,
): Promise<Buffer> {
  return encryptWithPassphrase(Buffer.from(masterPrivateKey, 'utf-8'), passphraseIdentity);
}
