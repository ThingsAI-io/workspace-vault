import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  rmSync,
  statSync,
  chmodSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { validateVaultPath, hasAlternateDataStream } from '../../src/security/paths.js';
import { sanitizeOutput, sanitizeSearchPattern } from '../../src/security/sanitize.js';
import { setRestrictivePermissions } from '../../src/security/permissions.js';
import { PathTraversalError } from '../../src/types.js';

// ── Path validation ──────────────────────────────────────────────────────────

describe('security/paths', () => {
  let vaultRoot: string;

  beforeEach(() => {
    vaultRoot = mkdtempSync(join(tmpdir(), 'vault-test-'));
  });

  afterEach(() => {
    rmSync(vaultRoot, { recursive: true, force: true });
  });

  it('accepts a simple relative path', () => {
    const result = validateVaultPath('secret.txt', vaultRoot);
    expect(result).toBe(join(vaultRoot, 'secret.txt'));
  });

  it('accepts nested paths', () => {
    const result = validateVaultPath('a/b/c.txt', vaultRoot);
    expect(result).toBe(join(vaultRoot, 'a', 'b', 'c.txt'));
  });

  it('rejects path with ../ traversal', () => {
    expect(() => validateVaultPath('../outside.txt', vaultRoot)).toThrow(PathTraversalError);
  });

  it('rejects deeply nested ../ traversal', () => {
    expect(() => validateVaultPath('a/b/../../../../etc/passwd', vaultRoot)).toThrow(
      PathTraversalError,
    );
  });

  it('rejects absolute path outside vault', () => {
    const outsidePath = process.platform === 'win32' ? 'C:\\Windows\\System32' : '/etc/passwd';
    expect(() => validateVaultPath(outsidePath, vaultRoot)).toThrow(PathTraversalError);
  });

  it('rejects null bytes in path', () => {
    expect(() => validateVaultPath('file\0.txt', vaultRoot)).toThrow(PathTraversalError);
  });

  it('rejects symlinks pointing outside vault', () => {
    const linkPath = join(vaultRoot, 'evil-link');
    try {
      symlinkSync(tmpdir(), linkPath);
    } catch {
      // Symlink creation may require elevated privileges on Windows
      return;
    }
    expect(() => validateVaultPath('evil-link', vaultRoot)).toThrow(PathTraversalError);
  });

  it('handles path with trailing slashes', () => {
    const result = validateVaultPath('subdir/', vaultRoot);
    // path.resolve strips trailing separators
    expect(result).toBe(join(vaultRoot, 'subdir'));
  });

  it('handles deeply nested path', () => {
    const deep = 'a/b/c/d/e/f/g/h/i/j/file.txt';
    const result = validateVaultPath(deep, vaultRoot);
    expect(result).toBe(join(vaultRoot, ...deep.split('/')));
  });

  it('handles empty path component', () => {
    // Double slashes in path: "a//b.txt" — path.resolve normalizes this
    const result = validateVaultPath('a//b.txt', vaultRoot);
    expect(result).toBe(join(vaultRoot, 'a', 'b.txt'));
  });

  it('allows path to non-existent file (new file)', () => {
    const result = validateVaultPath('new-file.txt', vaultRoot);
    expect(result).toBe(join(vaultRoot, 'new-file.txt'));
  });

  it('allows path to existing regular file', () => {
    writeFileSync(join(vaultRoot, 'exists.txt'), 'hello');
    const result = validateVaultPath('exists.txt', vaultRoot);
    expect(result).toBe(join(vaultRoot, 'exists.txt'));
  });

  // Windows-specific tests
  const isWindows = process.platform === 'win32';

  it.skipIf(!isWindows)('rejects Windows ADS (alternate data streams)', () => {
    expect(() => validateVaultPath('file.txt:Zone.Identifier', vaultRoot)).toThrow(
      PathTraversalError,
    );
  });

  it.skipIf(!isWindows)('rejects Windows reserved device names', () => {
    for (const name of ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'LPT1']) {
      expect(() => validateVaultPath(name, vaultRoot)).toThrow(PathTraversalError);
    }
  });

  it.skipIf(!isWindows)('rejects Windows reserved names with extension', () => {
    expect(() => validateVaultPath('CON.txt', vaultRoot)).toThrow(PathTraversalError);
  });
});

describe('hasAlternateDataStream', () => {
  it('detects ADS notation', () => {
    expect(hasAlternateDataStream('file.txt:Zone.Identifier')).toBe(true);
  });

  it('returns false for normal file', () => {
    expect(hasAlternateDataStream('file.txt')).toBe(false);
  });

  it('returns false for path with directory separators only', () => {
    expect(hasAlternateDataStream('a/b/c.txt')).toBe(false);
  });
});

// ── Output sanitization ──────────────────────────────────────────────────────

describe('security/sanitize', () => {
  it('strips ANSI color codes', () => {
    expect(sanitizeOutput('\x1b[31mred\x1b[0m')).toBe('red');
  });

  it('strips ANSI cursor movement', () => {
    expect(sanitizeOutput('\x1b[2Ahello')).toBe('hello');
  });

  it('strips OSC sequences', () => {
    expect(sanitizeOutput('\x1b]0;title\x07text')).toBe('text');
  });

  it('preserves newlines and tabs', () => {
    expect(sanitizeOutput('line1\nline2\ttab')).toBe('line1\nline2\ttab');
  });

  it('strips null bytes', () => {
    expect(sanitizeOutput('hello\x00world')).toBe('helloworld');
  });

  it('strips other control characters', () => {
    expect(sanitizeOutput('hello\x01\x02\x03world')).toBe('helloworld');
  });

  it('strips DEL character (0x7F)', () => {
    expect(sanitizeOutput('hello\x7Fworld')).toBe('helloworld');
  });

  it('handles empty string', () => {
    expect(sanitizeOutput('')).toBe('');
  });

  it('passes through clean text unchanged', () => {
    const clean = 'Hello, World! 123 @#$%';
    expect(sanitizeOutput(clean)).toBe(clean);
  });

  it('preserves carriage returns', () => {
    expect(sanitizeOutput('line1\r\nline2')).toBe('line1\r\nline2');
  });
});

describe('sanitizeSearchPattern', () => {
  it('accepts a normal regex pattern', () => {
    expect(sanitizeSearchPattern('[a-z]+')).toBe('[a-z]+');
  });

  it('rejects null bytes', () => {
    expect(() => sanitizeSearchPattern('test\0')).toThrow(/null bytes/);
  });

  it('rejects extremely long patterns', () => {
    expect(() => sanitizeSearchPattern('a'.repeat(2000))).toThrow(/maximum length/);
  });

  it('accepts pattern at max length', () => {
    const pattern = 'a'.repeat(1024);
    expect(sanitizeSearchPattern(pattern)).toBe(pattern);
  });
});

// ── File permissions ─────────────────────────────────────────────────────────

describe('security/permissions', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'vault-perm-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const isPosix = process.platform !== 'win32';

  it.skipIf(!isPosix)('sets file permissions to 0o600 on POSIX', () => {
    const filePath = join(tempDir, 'secret.txt');
    writeFileSync(filePath, 'secret');
    setRestrictivePermissions(filePath, 'file');
    const mode = statSync(filePath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it.skipIf(!isPosix)('sets directory permissions to 0o700 on POSIX', () => {
    const dirPath = join(tempDir, 'secret-dir');
    mkdirSync(dirPath);
    setRestrictivePermissions(dirPath, 'directory');
    const mode = statSync(dirPath).mode & 0o777;
    expect(mode).toBe(0o700);
  });

  it('does not throw on any platform', () => {
    const filePath = join(tempDir, 'test.txt');
    writeFileSync(filePath, 'test');
    expect(() => setRestrictivePermissions(filePath, 'file')).not.toThrow();
  });

  it('does not throw for directory on any platform', () => {
    const dirPath = join(tempDir, 'test-dir');
    mkdirSync(dirPath);
    expect(() => setRestrictivePermissions(dirPath, 'directory')).not.toThrow();
  });
});
