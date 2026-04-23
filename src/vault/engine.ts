import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  encrypt,
  decrypt,
  generateKeyPair,
  passphraseToIdentity,
  generateSalt,
  wrapMasterKeyWithPassphrase,
  unwrapMasterKey,
} from '../crypto/index.js';
import { validateVaultPath, setRestrictivePermissions } from '../security/index.js';
import { AuditLogger } from '../audit/index.js';
import { MetadataStore } from './metadata.js';
import {
  OperationType,
  FileNotFoundError,
  FileAlreadyExistsError,
  KeyNotFoundError,
  InvalidKeyError,
  LastKeyError,
  type FileMetadata,
  type KeyRecord,
  type GrepResult,
  type SearchResult,
  type VaultStatus,
} from '../types.js';

export class VaultEngine {
  private store: MetadataStore;
  private audit: AuditLogger;
  private vaultPath: string;
  private filesDir: string;

  private constructor(vaultPath: string, store: MetadataStore, audit: AuditLogger) {
    this.vaultPath = vaultPath;
    this.filesDir = path.join(vaultPath, 'files');
    this.store = store;
    this.audit = audit;
  }

  static async open(vaultPath: string): Promise<VaultEngine> {
    const store = await MetadataStore.create(path.join(vaultPath, 'vault.db'));
    const audit = await AuditLogger.create(path.join(vaultPath, 'audit.db'));
    return new VaultEngine(vaultPath, store, audit);
  }

  // ── Init ────────────────────────────────────────────────────────────

  static async init(vaultPath: string, passphrase: string): Promise<VaultEngine> {
    // 1. Create vault directory structure
    fs.mkdirSync(vaultPath, { recursive: true });
    fs.mkdirSync(path.join(vaultPath, 'files'), { recursive: true });
    setRestrictivePermissions(vaultPath, 'directory');
    setRestrictivePermissions(path.join(vaultPath, 'files'), 'directory');

    // 2. Generate master key pair
    const { publicKey, privateKey } = await generateKeyPair();

    // 3. Wrap master key for the initial passphrase
    const salt = generateSalt();
    const { publicKey: passphrasePublicKey, identity } = await passphraseToIdentity(
      passphrase,
      salt,
    );
    const wrappedKey = await wrapMasterKeyWithPassphrase(privateKey, identity);

    // 4. Create engine and store initial key
    const engine = await VaultEngine.open(vaultPath);
    engine.store.insertKey({
      id: randomUUID(),
      label: 'primary passphrase',
      publicKey: passphrasePublicKey,
      wrappedMasterKey: wrappedKey,
      salt,
      createdAt: new Date(),
    });

    // 5. Store master public key
    fs.writeFileSync(path.join(vaultPath, 'master.pub'), publicKey, 'utf-8');
    setRestrictivePermissions(path.join(vaultPath, 'master.pub'), 'file');

    engine.audit.logEvent({ operation: OperationType.INIT, success: true });
    return engine;
  }

  // ── File operations ─────────────────────────────────────────────────

  async writeFile(
    vaultFilePath: string,
    content: Buffer,
    masterKey: string,
    tags?: string[],
  ): Promise<FileMetadata> {
    this.validatePath(vaultFilePath);

    if (this.store.getFile(vaultFilePath)) {
      throw new FileAlreadyExistsError(`File already exists: ${vaultFilePath}`);
    }

    // Encrypt using the master public key derived from the provided master key
    const { identityToRecipient } = await import('age-encryption');
    const publicKey = await identityToRecipient(masterKey);
    const encrypted = await encrypt(content, [publicKey]);

    const blobId = randomUUID();
    const blobPath = path.join(this.filesDir, `${blobId}.age`);
    fs.writeFileSync(blobPath, encrypted);
    setRestrictivePermissions(blobPath, 'file');

    const meta: FileMetadata = {
      id: randomUUID(),
      vaultPath: vaultFilePath,
      blobId,
      size: content.length,
      createdAt: new Date(),
      modifiedAt: new Date(),
      tags: tags ?? [],
    };
    this.store.insertFile(meta);

    this.audit.logEvent({
      operation: OperationType.WRITE,
      targetPath: vaultFilePath,
      success: true,
    });
    return meta;
  }

  async readFile(vaultFilePath: string, masterKey: string): Promise<Buffer> {
    this.validatePath(vaultFilePath);

    const meta = this.store.getFile(vaultFilePath);
    if (!meta) throw new FileNotFoundError(`File not found: ${vaultFilePath}`);

    const blobPath = path.join(this.filesDir, `${meta.blobId}.age`);
    const encrypted = fs.readFileSync(blobPath);
    const decrypted = await decrypt(encrypted, masterKey);

    this.audit.logEvent({
      operation: OperationType.READ,
      targetPath: vaultFilePath,
      success: true,
    });
    return decrypted;
  }

  async deleteFile(vaultFilePath: string): Promise<void> {
    this.validatePath(vaultFilePath);

    const meta = this.store.getFile(vaultFilePath);
    if (!meta) throw new FileNotFoundError(`File not found: ${vaultFilePath}`);

    const blobPath = path.join(this.filesDir, `${meta.blobId}.age`);
    if (fs.existsSync(blobPath)) fs.unlinkSync(blobPath);

    this.store.deleteFile(vaultFilePath);

    this.audit.logEvent({
      operation: OperationType.DELETE,
      targetPath: vaultFilePath,
      success: true,
    });
  }

  listFiles(dirPath?: string): FileMetadata[] {
    this.audit.logEvent({
      operation: OperationType.LIST,
      targetPath: dirPath,
      success: true,
    });
    return this.store.getAllFiles(dirPath);
  }

  searchFiles(query: string): SearchResult[] {
    const files = this.store.searchFiles(query);
    this.audit.logEvent({ operation: OperationType.SEARCH, success: true });
    const lowerQuery = query.toLowerCase();
    return files.map((f) => {
      const tagMatch = f.tags.find((t) => t.toLowerCase().includes(lowerQuery));
      if (tagMatch) {
        return { vaultPath: f.vaultPath, matchType: 'tag' as const, matchedValue: tagMatch };
      }
      return {
        vaultPath: f.vaultPath,
        matchType: 'filename' as const,
        matchedValue: path.basename(f.vaultPath),
      };
    });
  }

  async grepFiles(pattern: string, masterKey: string): Promise<GrepResult[]> {
    // Validate pattern
    if (pattern.includes('\0')) {
      throw new Error('Search pattern contains null bytes');
    }
    if (pattern.length > 1000) {
      throw new Error('Search pattern too long (max 1000 characters)');
    }

    let regex: RegExp;
    try {
      regex = new RegExp(pattern, 'gi');
    } catch {
      throw new Error(`Invalid search pattern: ${pattern}`);
    }

    const allFiles = this.store.getAllFiles();
    const results: GrepResult[] = [];

    for (const file of allFiles) {
      try {
        const content = await this.readFile(file.vaultPath, masterKey);
        const text = content.toString('utf-8');
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            results.push({
              vaultPath: file.vaultPath,
              lineNumber: i + 1,
              line: lines[i],
            });
          }
          regex.lastIndex = 0;
        }
      } catch {
        // Skip files that can't be decrypted
      }
    }

    this.audit.logEvent({ operation: OperationType.GREP, success: true });
    return results;
  }

  // ── Key management ──────────────────────────────────────────────────

  async addKey(passphrase: string, label: string, currentMasterKey: string): Promise<KeyRecord> {
    const salt = generateSalt();
    const { publicKey, identity } = await passphraseToIdentity(passphrase, salt);
    const wrappedKey = await wrapMasterKeyWithPassphrase(currentMasterKey, identity);

    const record = {
      id: randomUUID(),
      label,
      publicKey,
      wrappedMasterKey: wrappedKey,
      salt,
      createdAt: new Date(),
    };
    this.store.insertKey(record);

    this.audit.logEvent({
      operation: OperationType.KEY_ADD,
      keyId: record.id,
      success: true,
    });
    return { id: record.id, label: record.label, createdAt: record.createdAt };
  }

  revokeKey(keyId: string): void {
    const key = this.store.getKey(keyId);
    if (!key) throw new KeyNotFoundError(`Key not found: ${keyId}`);
    if (this.store.getKeyCount() <= 1) {
      throw new LastKeyError();
    }
    this.store.deleteKey(keyId);
    this.audit.logEvent({
      operation: OperationType.KEY_REVOKE,
      keyId,
      success: true,
    });
  }

  listKeys(): KeyRecord[] {
    return this.store.getAllKeys().map((k) => ({
      id: k.id,
      label: k.label,
      createdAt: k.createdAt,
    }));
  }

  // ── Unlock support ──────────────────────────────────────────────────

  async unlock(passphrase: string): Promise<string> {
    const keys = this.store.getAllKeys();
    for (const key of keys) {
      try {
        const { identity } = await passphraseToIdentity(passphrase, key.salt);
        const masterKey = await unwrapMasterKey(key.wrappedMasterKey, identity);
        this.audit.logEvent({
          operation: OperationType.UNLOCK,
          keyId: key.id,
          success: true,
        });
        return masterKey;
      } catch {
        // Try next key
      }
    }
    this.audit.logEvent({ operation: OperationType.UNLOCK, success: false });
    throw new InvalidKeyError('No key matched the provided passphrase');
  }

  // ── Status ──────────────────────────────────────────────────────────

  getStatus(isUnlocked: boolean): VaultStatus {
    return {
      initialized: true,
      locked: !isUnlocked,
      fileCount: this.store.getFileCount(),
      keyCount: this.store.getKeyCount(),
    };
  }

  getMasterPublicKey(): string {
    return fs.readFileSync(path.join(this.vaultPath, 'master.pub'), 'utf-8').trim();
  }

  getAuditLogger(): AuditLogger {
    return this.audit;
  }

  close(): void {
    this.store.close();
    this.audit.close();
  }

  private validatePath(userPath: string): string {
    return validateVaultPath(userPath, this.vaultPath);
  }
}
