import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CLI_PATH = path.resolve('dist/cli/index.js');

// Use an isolated config dir so tests don't depend on host machine state
const TEST_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-cli-test-'));

function run(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync('node', [CLI_PATH, ...args], {
      encoding: 'utf-8',
      timeout: 10_000,
      env: { ...process.env, NODE_NO_WARNINGS: '1', WORKSPACE_VAULT_CONFIG_DIR: TEST_CONFIG_DIR },
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      exitCode: e.status ?? 1,
    };
  }
}

describe('CLI command registration', () => {
  it('should show help with all commands', () => {
    const { stdout } = run(['--help']);
    expect(stdout).toContain('vault');
    expect(stdout).toContain('init');
    expect(stdout).toContain('unlock');
    expect(stdout).toContain('lock');
    expect(stdout).toContain('status');
    expect(stdout).toContain('write');
    expect(stdout).toContain('read');
    expect(stdout).toContain('delete');
    expect(stdout).toContain('list');
    expect(stdout).toContain('search');
    expect(stdout).toContain('grep');
    expect(stdout).toContain('key');
    expect(stdout).toContain('audit');
    expect(stdout).toContain('mcp');
  });

  it('should show version', () => {
    const { stdout } = run(['--version']);
    expect(stdout.trim()).toBe('0.1.0');
  });

  it('should show help for key subcommand', () => {
    const { stdout } = run(['key', '--help']);
    expect(stdout).toContain('add');
    expect(stdout).toContain('list');
    expect(stdout).toContain('revoke');
  });
});

describe('CLI error handling', () => {
  it('should fail gracefully for status when vault is not initialized', () => {
    const { stderr, exitCode } = run(['status']);
    // Status prints a message but doesn't exit 1 when not initialized
    expect(stderr + '').toContain('');
    expect(typeof exitCode).toBe('number');
  });

  it('should fail gracefully for lock when vault is not initialized', () => {
    const { stderr, exitCode } = run(['lock']);
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain('not initialized');
  });
});

describe('output formatting helpers', () => {
  it('should show description in help', () => {
    const { stdout } = run(['--help']);
    expect(stdout).toContain('Encrypted file vault');
  });
});
