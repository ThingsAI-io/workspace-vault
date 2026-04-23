#!/usr/bin/env node

import { Command } from 'commander';
import {
  VaultError,
  VaultLockedError,
  VaultNotInitializedError,
  InvalidKeyError,
} from '../types.js';
import {
  initCommand,
  unlockCommand,
  lockCommand,
  statusCommand,
  writeCommand,
  readCommand,
  deleteCommand,
  listCommand,
  searchCommand,
  grepCommand,
  keyAddCommand,
  keyListCommand,
  keyRevokeCommand,
  auditCommand,
  mcpCommand,
} from './commands.js';

const program = new Command();

program
  .name('vault')
  .description('Encrypted file vault with MCP server for AI agent access')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize a new encrypted vault')
  .argument('[path]', 'vault directory path (default: ~/.vault)')
  .action(async (vaultPath?: string) => {
    await initCommand(vaultPath);
  });

program
  .command('unlock')
  .description('Unlock the vault with a passphrase')
  .action(async () => {
    await unlockCommand();
  });

program
  .command('lock')
  .description('Lock the vault and clear the session')
  .action(() => {
    lockCommand();
  });

program
  .command('status')
  .description('Show vault status')
  .action(async () => {
    await statusCommand();
  });

program
  .command('write')
  .description('Write a file to the vault')
  .argument('<vault-path>', 'path inside the vault')
  .option('--from <file>', 'read content from a local file')
  .option('--tag <tag...>', 'tags for the file')
  .action(async (vaultPath: string, options: { from?: string; tag?: string[] }) => {
    await writeCommand(vaultPath, options);
  });

program
  .command('read')
  .description('Read and decrypt a file from the vault')
  .argument('<vault-path>', 'path inside the vault')
  .action(async (vaultPath: string) => {
    await readCommand(vaultPath);
  });

program
  .command('delete')
  .description('Delete a file from the vault')
  .argument('<vault-path>', 'path inside the vault')
  .action(async (vaultPath: string) => {
    await deleteCommand(vaultPath);
  });

program
  .command('list')
  .description('List files in the vault')
  .argument('[vault-path]', 'directory path to list')
  .action(async (vaultPath?: string) => {
    await listCommand(vaultPath);
  });

program
  .command('search')
  .description('Search files by name or tag')
  .argument('<query>', 'search query')
  .action(async (query: string) => {
    await searchCommand(query);
  });

program
  .command('grep')
  .description('Search file contents (requires unlock)')
  .argument('<pattern>', 'regex pattern to search for')
  .action(async (pattern: string) => {
    await grepCommand(pattern);
  });

// Key management subcommand
const key = program.command('key').description('Manage vault keys');

key
  .command('add')
  .description('Add a new passphrase key')
  .action(async () => {
    await keyAddCommand();
  });

key
  .command('list')
  .description('List all keys')
  .action(async () => {
    await keyListCommand();
  });

key
  .command('revoke')
  .description('Revoke a key')
  .argument('<key-id>', 'ID of the key to revoke')
  .action(async (keyId: string) => {
    await keyRevokeCommand(keyId);
  });

program
  .command('audit')
  .description('View audit log')
  .option('--tail <n>', 'number of recent events to show')
  .option('--operation <type>', 'filter by operation type')
  .action(async (options: { tail?: string; operation?: string }) => {
    await auditCommand(options);
  });

program
  .command('mcp')
  .description('Start the MCP server')
  .action(async () => {
    await mcpCommand();
  });

// Global error handling
async function main() {
  try {
    await program.parseAsync();
  } catch (err) {
    if (err instanceof VaultLockedError) {
      process.stderr.write('Vault is locked. Run `vault unlock` first.\n');
      process.exit(1);
    }
    if (err instanceof VaultNotInitializedError) {
      process.stderr.write('Vault not initialized. Run `vault init` first.\n');
      process.exit(1);
    }
    if (err instanceof InvalidKeyError) {
      process.stderr.write('Invalid passphrase.\n');
      process.exit(1);
    }
    if (err instanceof VaultError) {
      process.stderr.write(`Error: ${err.message}\n`);
      process.exit(1);
    }
    process.stderr.write(`Unexpected error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(2);
  }
}

main();
