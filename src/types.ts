import { z } from 'zod/v4';

// ── Error hierarchy ─────────────────────────────────────────────────────────

export class VaultError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'VaultError';
  }
}

export class VaultNotInitializedError extends VaultError {
  constructor(message = 'Vault has not been initialized') {
    super(message, 'VAULT_NOT_INITIALIZED');
    this.name = 'VaultNotInitializedError';
  }
}

export class VaultLockedError extends VaultError {
  constructor(message = 'Vault is locked') {
    super(message, 'VAULT_LOCKED');
    this.name = 'VaultLockedError';
  }
}

export class VaultAlreadyUnlockedError extends VaultError {
  constructor(message = 'Vault is already unlocked') {
    super(message, 'VAULT_ALREADY_UNLOCKED');
    this.name = 'VaultAlreadyUnlockedError';
  }
}

export class PathTraversalError extends VaultError {
  constructor(message = 'Path traversal or invalid path detected') {
    super(message, 'PATH_TRAVERSAL');
    this.name = 'PathTraversalError';
  }
}

export class FileNotFoundError extends VaultError {
  constructor(message = 'File not found in vault') {
    super(message, 'FILE_NOT_FOUND');
    this.name = 'FileNotFoundError';
  }
}

export class FileAlreadyExistsError extends VaultError {
  constructor(message = 'File already exists in vault') {
    super(message, 'FILE_ALREADY_EXISTS');
    this.name = 'FileAlreadyExistsError';
  }
}

export class KeyNotFoundError extends VaultError {
  constructor(message = 'Key not found') {
    super(message, 'KEY_NOT_FOUND');
    this.name = 'KeyNotFoundError';
  }
}

export class InvalidKeyError extends VaultError {
  constructor(message = 'Invalid passphrase or key') {
    super(message, 'INVALID_KEY');
    this.name = 'InvalidKeyError';
  }
}

export class LastKeyError extends VaultError {
  constructor(message = 'Cannot revoke the last remaining key') {
    super(message, 'LAST_KEY');
    this.name = 'LastKeyError';
  }
}

export class DaemonNotRunningError extends VaultError {
  constructor(message = 'Daemon not running or unreachable') {
    super(message, 'DAEMON_NOT_RUNNING');
    this.name = 'DaemonNotRunningError';
  }
}

export class DaemonError extends VaultError {
  constructor(message = 'Daemon communication error') {
    super(message, 'DAEMON_ERROR');
    this.name = 'DaemonError';
  }
}

// ── Operation types ─────────────────────────────────────────────────────────

export enum OperationType {
  READ = 'read',
  WRITE = 'write',
  DELETE = 'delete',
  LIST = 'list',
  SEARCH = 'search',
  GREP = 'grep',
  UNLOCK = 'unlock',
  LOCK = 'lock',
  KEY_ADD = 'key_add',
  KEY_REVOKE = 'key_revoke',
  INIT = 'init',
}

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface FileMetadata {
  id: string;
  vaultPath: string;
  blobId: string;
  size: number;
  createdAt: Date;
  modifiedAt: Date;
  tags: string[];
}

export interface KeyRecord {
  id: string;
  label: string;
  createdAt: Date;
}

export interface AuditEntry {
  id: number;
  timestamp: Date;
  operation: OperationType;
  targetPath?: string;
  keyId?: string;
  success: boolean;
}

export interface VaultConfig {
  vaultPath: string;
  socketPath: string;
  version: number;
}

export interface VaultStatus {
  initialized: boolean;
  locked: boolean;
  fileCount: number;
  keyCount: number;
}

export interface GrepResult {
  vaultPath: string;
  lineNumber: number;
  line: string;
}

export interface SearchResult {
  vaultPath: string;
  matchType: 'filename' | 'tag';
  matchedValue: string;
}

// ── Zod schemas (input validation) ──────────────────────────────────────────

export const VaultPathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine((val) => !val.includes('\0'), 'Path must not contain null bytes');

export const PassphraseSchema = z.string().min(8).max(1024);

export const LabelSchema = z.string().min(1).max(256).trim();

export const TagSchema = z.string().min(1).max(128).trim();

export const SearchQuerySchema = z.string().min(1).max(512);

export const GrepPatternSchema = z.string().min(1).max(512);

export const InitInputSchema = z.object({
  vaultPath: z.string().min(1),
  passphrase: PassphraseSchema,
});

export const WriteInputSchema = z.object({
  vaultPath: VaultPathSchema,
  content: z.instanceof(Buffer).optional(),
  fromFile: z.string().optional(),
  tags: z.array(TagSchema).optional(),
});

export const ReadInputSchema = z.object({
  vaultPath: VaultPathSchema,
});

export const DeleteInputSchema = z.object({
  vaultPath: VaultPathSchema,
});

export const ListInputSchema = z.object({
  vaultPath: VaultPathSchema.optional(),
});

export const SearchInputSchema = z.object({
  query: SearchQuerySchema,
});

export const GrepInputSchema = z.object({
  pattern: GrepPatternSchema,
});

export const KeyAddInputSchema = z.object({
  passphrase: PassphraseSchema,
  label: LabelSchema,
});

export const KeyRevokeInputSchema = z.object({
  keyId: z.string().uuid(),
});

export const AuditQuerySchema = z.object({
  tail: z.number().int().positive().max(10000).optional(),
  operation: z.nativeEnum(OperationType).optional(),
});

// ── Daemon protocol ─────────────────────────────────────────────────────────

export enum DaemonCommand {
  UNLOCK = 'unlock',
  LOCK = 'lock',
  STATUS = 'status',
  READ_FILE = 'read_file',
  WRITE_FILE = 'write_file',
  DELETE_FILE = 'delete_file',
  GREP = 'grep',
}

export interface DaemonRequest {
  command: DaemonCommand;
  payload?: Record<string, unknown>;
}

export interface DaemonResponse {
  success: boolean;
  data?: unknown;
  error?: string;
  errorCode?: string;
}
