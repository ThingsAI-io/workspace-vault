import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionManager } from '../../src/session/index.js';
import { VaultLockedError, SessionExpiredError } from '../../src/types.js';

describe('SessionManager', () => {
  let tempDir: string;
  let sessionPath: string;
  let manager: SessionManager;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'vault-session-'));
    sessionPath = join(tempDir, 'session');
    manager = new SessionManager(sessionPath);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('writeSession', () => {
    it('creates a session file', () => {
      manager.writeSession('deadbeef');
      expect(existsSync(sessionPath)).toBe(true);
    });

    it('writes valid JSON with required fields', () => {
      manager.writeSession('deadbeef');
      const raw = readFileSync(sessionPath, 'utf-8');
      const data = JSON.parse(raw);
      expect(data).toHaveProperty('masterKey', 'deadbeef');
      expect(data).toHaveProperty('expiresAt');
      expect(data).toHaveProperty('createdAt');
    });

    it('sets expiry based on TTL', () => {
      manager.writeSession('deadbeef', 60);
      const raw = readFileSync(sessionPath, 'utf-8');
      const data = JSON.parse(raw);
      const expiresAt = new Date(data.expiresAt);
      const now = new Date();
      // Should expire ~60 minutes from now (allow 5s tolerance)
      const diffMinutes = (expiresAt.getTime() - now.getTime()) / 60000;
      expect(diffMinutes).toBeGreaterThan(59);
      expect(diffMinutes).toBeLessThan(61);
    });

    it('overwrites existing session file', () => {
      manager.writeSession('key1');
      manager.writeSession('key2');
      const raw = readFileSync(sessionPath, 'utf-8');
      const data = JSON.parse(raw);
      expect(data.masterKey).toBe('key2');
    });
  });

  describe('readSession', () => {
    it('returns master key from valid session', () => {
      manager.writeSession('deadbeef');
      expect(manager.readSession()).toBe('deadbeef');
    });

    it('throws VaultLockedError when no session file exists', () => {
      expect(() => manager.readSession()).toThrow(VaultLockedError);
    });

    it('throws SessionExpiredError when session is expired', () => {
      manager.writeSession('deadbeef', 0);
      expect(() => manager.readSession()).toThrow(SessionExpiredError);
    });

    it('cleans up expired session file', () => {
      manager.writeSession('deadbeef', 0);
      try {
        manager.readSession();
      } catch {
        /* expected */
      }
      expect(existsSync(sessionPath)).toBe(false);
    });
  });

  describe('clearSession', () => {
    it('removes session file', () => {
      manager.writeSession('deadbeef');
      manager.clearSession();
      expect(existsSync(sessionPath)).toBe(false);
    });

    it('does not throw when no session file exists', () => {
      expect(() => manager.clearSession()).not.toThrow();
    });
  });

  describe('isUnlocked', () => {
    it('returns true when valid session exists', () => {
      manager.writeSession('deadbeef');
      expect(manager.isUnlocked()).toBe(true);
    });

    it('returns false when no session exists', () => {
      expect(manager.isUnlocked()).toBe(false);
    });

    it('returns false when session is expired', () => {
      manager.writeSession('deadbeef', 0);
      expect(manager.isUnlocked()).toBe(false);
    });
  });

  describe('getSessionInfo', () => {
    it('returns session info without master key', () => {
      manager.writeSession('deadbeef', 30);
      const info = manager.getSessionInfo();
      expect(info).not.toBeNull();
      expect(info!.expiresAt).toBeInstanceOf(Date);
      expect(info!.createdAt).toBeInstanceOf(Date);
      // Should NOT contain masterKey
      expect(info).not.toHaveProperty('masterKey');
    });

    it('returns null when no session exists', () => {
      expect(manager.getSessionInfo()).toBeNull();
    });

    it('returns null for expired session', () => {
      manager.writeSession('deadbeef', 0);
      expect(manager.getSessionInfo()).toBeNull();
    });
  });
});
