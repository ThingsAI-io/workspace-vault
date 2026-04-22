import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConfigManager } from '../../src/config/index.js';

describe('ConfigManager', () => {
  let tempDir: string;
  let configDir: string;
  let manager: ConfigManager;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'vault-config-'));
    configDir = join(tempDir, 'config');
    manager = new ConfigManager(configDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('reports not initialized when no config exists', () => {
    expect(manager.isInitialized()).toBe(false);
  });

  it('throws when loading before initialization', () => {
    expect(() => manager.load()).toThrow('Vault not initialized');
  });

  it('initializes config and creates config file', () => {
    const vaultPath = join(tempDir, 'vault');
    const config = manager.initialize(vaultPath);

    expect(manager.isInitialized()).toBe(true);
    expect(config.vaultPath).toBe(vaultPath);
    expect(config.sessionPath).toBe(manager.getDefaultSessionPath());
    expect(config.version).toBe(1);
  });

  it('saves and loads config round-trip', () => {
    const vaultPath = join(tempDir, 'vault');
    manager.initialize(vaultPath);

    const loaded = manager.load();
    expect(loaded.vaultPath).toBe(vaultPath);
    expect(loaded.version).toBe(1);
  });

  it('getVaultPath returns the vault path', () => {
    const vaultPath = join(tempDir, 'vault');
    manager.initialize(vaultPath);
    expect(manager.getVaultPath()).toBe(vaultPath);
  });

  it('getSessionPath returns the session file path', () => {
    const vaultPath = join(tempDir, 'vault');
    manager.initialize(vaultPath);
    expect(manager.getSessionPath()).toBe(manager.getDefaultSessionPath());
  });

  it('creates config directory with correct structure', () => {
    const vaultPath = join(tempDir, 'vault');
    manager.initialize(vaultPath);

    expect(existsSync(configDir)).toBe(true);
    expect(existsSync(manager.getConfigPath())).toBe(true);
  });

  it('config file contains valid JSON', () => {
    const vaultPath = join(tempDir, 'vault');
    manager.initialize(vaultPath);

    const raw = readFileSync(manager.getConfigPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed).toHaveProperty('vaultPath');
    expect(parsed).toHaveProperty('sessionPath');
    expect(parsed).toHaveProperty('version');
  });

  it('resolves relative vault path to absolute', () => {
    manager.initialize('relative/vault/path');
    const loaded = manager.load();
    expect(loaded.vaultPath).toMatch(/^[A-Z]:|^\//i); // starts with drive letter or /
  });

  it('can overwrite config with save', () => {
    const vaultPath1 = join(tempDir, 'vault1');
    const vaultPath2 = join(tempDir, 'vault2');

    manager.initialize(vaultPath1);
    expect(manager.getVaultPath()).toBe(vaultPath1);

    const config = manager.load();
    config.vaultPath = vaultPath2;
    manager.save(config);
    expect(manager.getVaultPath()).toBe(vaultPath2);
  });
});
