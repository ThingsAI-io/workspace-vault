import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { VaultEngine } from '../vault/index.js';
import { SessionManager } from '../session/index.js';
import { ConfigManager } from '../config/index.js';
import { sanitizeOutput } from '../security/index.js';
import {
  type OperationType,
  VaultLockedError,
  SessionExpiredError,
} from '../types.js';
import { promptPassphrase, promptPassphraseConfirm } from './prompt.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getConfig(): ConfigManager {
  return new ConfigManager();
}

function getEngine(config: ConfigManager): VaultEngine {
  return new VaultEngine(config.getVaultPath());
}

function getSession(config: ConfigManager): SessionManager {
  return new SessionManager(config.getSessionPath());
}

function requireInit(config: ConfigManager): void {
  if (!config.isInitialized()) {
    process.stderr.write(
      'Vault not initialized. Run `vault init` first.\n',
    );
    process.exit(1);
  }
}

function requireUnlock(session: SessionManager): string {
  try {
    return session.readSession();
  } catch (err) {
    if (err instanceof VaultLockedError) {
      process.stderr.write(
        'Vault is locked. Run `vault unlock` first.\n',
      );
      process.exit(1);
    }
    if (err instanceof SessionExpiredError) {
      process.stderr.write(
        'Session expired. Run `vault unlock` again.\n',
      );
      process.exit(1);
    }
    throw err;
  }
}

function formatDate(d: Date): string {
  return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z');
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function readStdin(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

// ── Commands ─────────────────────────────────────────────────────────────────

export async function initCommand(vaultPath?: string): Promise<void> {
  const resolvedPath = path.resolve(
    vaultPath ?? path.join(os.homedir(), '.vault'),
  );

  const passphrase = await promptPassphraseConfirm();

  const engine = await VaultEngine.init(resolvedPath, passphrase);
  engine.close();

  const config = getConfig();
  config.initialize(resolvedPath);

  process.stderr.write(`Vault initialized at ${resolvedPath}\n`);
  process.stderr.write(
    `\nAdd to your MCP config:\n` +
      `{\n` +
      `  "mcpServers": {\n` +
      `    "workspace-vault": {\n` +
      `      "command": "vault",\n` +
      `      "args": ["mcp"]\n` +
      `    }\n` +
      `  }\n` +
      `}\n`,
  );
}

export async function unlockCommand(): Promise<void> {
  const config = getConfig();
  requireInit(config);

  const session = getSession(config);
  if (session.isUnlocked()) {
    process.stderr.write('Vault is already unlocked.\n');
    return;
  }

  const passphrase = await promptPassphrase();
  const engine = getEngine(config);
  try {
    const masterKey = await engine.unlock(passphrase);
    session.writeSession(masterKey);
    process.stderr.write('Vault unlocked. Session expires in 30 minutes.\n');
  } finally {
    engine.close();
  }
}

export function lockCommand(): void {
  const config = getConfig();
  requireInit(config);

  const session = getSession(config);
  session.clearSession();
  process.stderr.write('Vault locked.\n');
}

export function statusCommand(): void {
  const config = getConfig();
  if (!config.isInitialized()) {
    process.stderr.write('Vault not initialized. Run `vault init` first.\n');
    return;
  }

  const session = getSession(config);
  const engine = getEngine(config);
  try {
    const isUnlocked = session.isUnlocked();
    const status = engine.getStatus(isUnlocked);

    process.stderr.write(`Status: ${status.locked ? 'locked' : 'unlocked'}\n`);
    process.stderr.write(`Files:  ${status.fileCount}\n`);
    process.stderr.write(`Keys:   ${status.keyCount}\n`);

    if (isUnlocked) {
      const info = session.getSessionInfo();
      if (info) {
        process.stderr.write(`Session expires: ${formatDate(info.expiresAt)}\n`);
      }
    }
  } finally {
    engine.close();
  }
}

export async function writeCommand(
  vaultPath: string,
  options: { from?: string; tag?: string[] },
): Promise<void> {
  const config = getConfig();
  requireInit(config);
  const session = getSession(config);
  const masterKey = requireUnlock(session);
  const engine = getEngine(config);

  try {
    let content: Buffer;
    if (options.from) {
      content = fs.readFileSync(options.from);
    } else {
      if (process.stdin.isTTY) {
        process.stderr.write('Reading from stdin (press Ctrl+D to finish):\n');
      }
      content = await readStdin();
    }

    const meta = await engine.writeFile(
      vaultPath,
      content,
      masterKey,
      options.tag,
    );
    process.stderr.write(
      `Written ${vaultPath} (${formatSize(meta.size)})\n`,
    );
  } finally {
    engine.close();
  }
}

export async function readCommand(vaultPath: string): Promise<void> {
  const config = getConfig();
  requireInit(config);
  const session = getSession(config);
  const masterKey = requireUnlock(session);
  const engine = getEngine(config);

  try {
    const content = await engine.readFile(vaultPath, masterKey);
    process.stdout.write(sanitizeOutput(content.toString('utf-8')));
  } finally {
    engine.close();
  }
}

export async function deleteCommand(vaultPath: string): Promise<void> {
  const config = getConfig();
  requireInit(config);
  const session = getSession(config);
  requireUnlock(session);
  const engine = getEngine(config);

  try {
    await engine.deleteFile(vaultPath);
    process.stderr.write(`Deleted ${vaultPath}\n`);
  } finally {
    engine.close();
  }
}

export function listCommand(vaultPath?: string): void {
  const config = getConfig();
  requireInit(config);
  const engine = getEngine(config);

  try {
    const files = engine.listFiles(vaultPath);
    if (files.length === 0) {
      process.stderr.write('No files in vault.\n');
      return;
    }

    // Header
    process.stdout.write(
      `${'PATH'.padEnd(40)} ${'SIZE'.padEnd(10)} ${'MODIFIED'.padEnd(24)} TAGS\n`,
    );
    for (const f of files) {
      const tags = f.tags.length > 0 ? f.tags.join(', ') : '';
      process.stdout.write(
        `${f.vaultPath.padEnd(40)} ${formatSize(f.size).padEnd(10)} ${formatDate(f.modifiedAt).padEnd(24)} ${tags}\n`,
      );
    }
  } finally {
    engine.close();
  }
}

export function searchCommand(query: string): void {
  const config = getConfig();
  requireInit(config);
  const engine = getEngine(config);

  try {
    const results = engine.searchFiles(query);
    if (results.length === 0) {
      process.stderr.write('No matches found.\n');
      return;
    }
    for (const r of results) {
      process.stdout.write(`${r.vaultPath}  (${r.matchType}: ${r.matchedValue})\n`);
    }
  } finally {
    engine.close();
  }
}

export async function grepCommand(pattern: string): Promise<void> {
  const config = getConfig();
  requireInit(config);
  const session = getSession(config);
  const masterKey = requireUnlock(session);
  const engine = getEngine(config);

  try {
    const results = await engine.grepFiles(pattern, masterKey);
    if (results.length === 0) {
      process.stderr.write('No matches found.\n');
      return;
    }
    for (const r of results) {
      process.stdout.write(
        `${r.vaultPath}:${r.lineNumber}: ${sanitizeOutput(r.line)}\n`,
      );
    }
  } finally {
    engine.close();
  }
}

export async function keyAddCommand(): Promise<void> {
  const config = getConfig();
  requireInit(config);
  const session = getSession(config);
  const masterKey = requireUnlock(session);
  const engine = getEngine(config);

  try {
    const passphrase = await promptPassphraseConfirm();

    const rl = await import('node:readline');
    const iface = rl.createInterface({
      input: process.stdin,
      output: process.stderr,
    });
    const label = await new Promise<string>((resolve) => {
      iface.question('Key label: ', (answer) => {
        iface.close();
        resolve(answer.trim());
      });
    });

    if (!label) {
      process.stderr.write('Label is required.\n');
      process.exit(1);
    }

    const key = await engine.addKey(passphrase, label, masterKey);
    process.stderr.write(`Key added: ${key.id} (${key.label})\n`);
  } finally {
    engine.close();
  }
}

export function keyListCommand(): void {
  const config = getConfig();
  requireInit(config);
  const engine = getEngine(config);

  try {
    const keys = engine.listKeys();
    if (keys.length === 0) {
      process.stderr.write('No keys.\n');
      return;
    }

    process.stdout.write(
      `${'ID'.padEnd(38)} ${'LABEL'.padEnd(24)} CREATED\n`,
    );
    for (const k of keys) {
      process.stdout.write(
        `${k.id.padEnd(38)} ${k.label.padEnd(24)} ${formatDate(k.createdAt)}\n`,
      );
    }
  } finally {
    engine.close();
  }
}

export function keyRevokeCommand(keyId: string): void {
  const config = getConfig();
  requireInit(config);
  const session = getSession(config);
  requireUnlock(session);
  const engine = getEngine(config);

  try {
    engine.revokeKey(keyId);
    process.stderr.write(`Key revoked: ${keyId}\n`);
  } finally {
    engine.close();
  }
}

export function auditCommand(options: {
  tail?: string;
  operation?: string;
}): void {
  const config = getConfig();
  requireInit(config);
  const engine = getEngine(config);

  try {
    const limit = options.tail ? parseInt(options.tail, 10) : undefined;
    const operation = options.operation as OperationType | undefined;
    const events = engine
      .getAuditLogger()
      .getEvents({ limit, operation });

    if (events.length === 0) {
      process.stderr.write('No audit events.\n');
      return;
    }

    process.stdout.write(
      `${'TIMESTAMP'.padEnd(24)} ${'OPERATION'.padEnd(14)} ${'PATH'.padEnd(30)} ${'OK'.padEnd(4)}\n`,
    );
    for (const e of events) {
      process.stdout.write(
        `${formatDate(e.timestamp).padEnd(24)} ${e.operation.padEnd(14)} ${(e.targetPath ?? '').padEnd(30)} ${e.success ? 'yes' : 'no'}\n`,
      );
    }
  } finally {
    engine.close();
  }
}

export async function mcpCommand(): Promise<void> {
  const config = getConfig();
  requireInit(config);
  const engine = getEngine(config);
  const session = getSession(config);

  const { createVaultMcpServer } = await import('../mcp/index.js');
  const { StdioServerTransport } = await import(
    '@modelcontextprotocol/sdk/server/stdio.js'
  );

  const server = createVaultMcpServer(engine, session);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
