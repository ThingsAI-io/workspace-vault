import fs from 'node:fs';
import {
  type SessionData,
  VaultLockedError,
  SessionExpiredError,
  SessionFileError,
} from '../types.js';
import { setRestrictivePermissions } from '../security/index.js';

const DEFAULT_TTL_MINUTES = 30;

export class SessionManager {
  private readonly sessionPath: string;

  constructor(sessionPath: string) {
    this.sessionPath = sessionPath;
  }

  /**
   * Write a new session file with the master key and TTL.
   * Sets restrictive file permissions (0600).
   */
  writeSession(masterKey: string, ttlMinutes: number = DEFAULT_TTL_MINUTES): void {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000);

    const data: SessionData = {
      masterKey,
      expiresAt: expiresAt.toISOString(),
      createdAt: now.toISOString(),
    };

    // Atomic write: write to temp file then rename
    const tempPath = `${this.sessionPath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(data), 'utf-8');
    setRestrictivePermissions(tempPath, 'file');

    try {
      if (process.platform === 'win32' && fs.existsSync(this.sessionPath)) {
        try {
          fs.unlinkSync(this.sessionPath);
        } catch {
          // Let renameSync surface the real error
        }
      }
      fs.renameSync(tempPath, this.sessionPath);
    } catch (err) {
      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch {
        // Ignore temp cleanup failures
      }
      throw err;
    }
  }

  /**
   * Read the session file and return the master key.
   * Throws VaultLockedError if no session file exists.
   * Throws SessionExpiredError if the session has expired (and cleans up).
   */
  readSession(): string {
    if (!fs.existsSync(this.sessionPath)) {
      throw new VaultLockedError('Vault is locked. Run `vault unlock` to unlock.');
    }

    let data: SessionData;
    try {
      const raw = fs.readFileSync(this.sessionPath, 'utf-8');
      data = JSON.parse(raw) as SessionData;
    } catch (err) {
      throw new SessionFileError(`Failed to read session file: ${(err as Error).message}`);
    }

    // Check TTL
    const expiresAt = new Date(data.expiresAt);
    if (expiresAt <= new Date()) {
      this.clearSession();
      throw new SessionExpiredError();
    }

    return data.masterKey;
  }

  /**
   * Clear the session file (lock the vault).
   * Best-effort: overwrite with zeros before deleting.
   */
  clearSession(): void {
    if (!fs.existsSync(this.sessionPath)) return;

    try {
      // Best-effort zero-fill before delete
      const stat = fs.statSync(this.sessionPath);
      const zeros = Buffer.alloc(stat.size, 0);
      fs.writeFileSync(this.sessionPath, zeros);
    } catch {
      // Ignore — best effort
    }

    try {
      fs.unlinkSync(this.sessionPath);
    } catch {
      // Ignore — file may already be gone
    }
  }

  /**
   * Check if a valid (non-expired) session exists.
   */
  isUnlocked(): boolean {
    try {
      this.readSession();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get session info without the master key (for status display).
   */
  getSessionInfo(): { expiresAt: Date; createdAt: Date } | null {
    if (!fs.existsSync(this.sessionPath)) return null;

    try {
      const raw = fs.readFileSync(this.sessionPath, 'utf-8');
      const data = JSON.parse(raw) as SessionData;
      const expiresAt = new Date(data.expiresAt);

      if (expiresAt <= new Date()) {
        this.clearSession();
        return null;
      }

      return {
        expiresAt,
        createdAt: new Date(data.createdAt),
      };
    } catch {
      return null;
    }
  }
}
