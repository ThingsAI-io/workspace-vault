import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { type VaultConfig } from '../types.js';
import { setRestrictivePermissions } from '../security/index.js';

const CONFIG_VERSION = 1;
const CONFIG_DIR_NAME = 'workspace-vault';
const CONFIG_FILE_NAME = 'config.json';
const SESSION_FILE_NAME = 'session';

function getConfigDir(): string {
  if (process.platform === 'win32') {
    return path.join(process.env['APPDATA'] || path.join(os.homedir(), 'AppData', 'Roaming'), CONFIG_DIR_NAME);
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', CONFIG_DIR_NAME);
  }
  // Linux / other: respect XDG_CONFIG_HOME
  const xdg = process.env['XDG_CONFIG_HOME'] || path.join(os.homedir(), '.config');
  return path.join(xdg, CONFIG_DIR_NAME);
}

export class ConfigManager {
  private readonly configDir: string;
  private readonly configPath: string;

  constructor(configDir?: string) {
    this.configDir = configDir ?? getConfigDir();
    this.configPath = path.join(this.configDir, CONFIG_FILE_NAME);
  }

  getConfigDir(): string {
    return this.configDir;
  }

  getConfigPath(): string {
    return this.configPath;
  }

  getDefaultSessionPath(): string {
    return path.join(this.configDir, SESSION_FILE_NAME);
  }

  isInitialized(): boolean {
    return fs.existsSync(this.configPath);
  }

  load(): VaultConfig {
    if (!this.isInitialized()) {
      throw new Error('Vault not initialized. Run `vault init` first.');
    }
    const raw = fs.readFileSync(this.configPath, 'utf-8');
    return JSON.parse(raw) as VaultConfig;
  }

  save(config: VaultConfig): void {
    this.ensureConfigDir();
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
    setRestrictivePermissions(this.configPath, 'file');
  }

  getVaultPath(): string {
    return this.load().vaultPath;
  }

  getSessionPath(): string {
    return this.load().sessionPath;
  }

  private ensureConfigDir(): void {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
      setRestrictivePermissions(this.configDir, 'directory');
    }
  }

  /**
   * Create initial config for a new vault.
   */
  initialize(vaultPath: string): VaultConfig {
    const config: VaultConfig = {
      vaultPath: path.resolve(vaultPath),
      sessionPath: this.getDefaultSessionPath(),
      version: CONFIG_VERSION,
    };
    this.save(config);
    return config;
  }
}

