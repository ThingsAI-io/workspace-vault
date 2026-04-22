import fs from 'node:fs';

/**
 * Set restrictive permissions on a file or directory.
 * POSIX: 0o700 for dirs, 0o600 for files
 * Windows: best-effort (fs.chmod may not work the same way)
 */
export function setRestrictivePermissions(
  filePath: string,
  type: 'file' | 'directory',
): void {
  const mode = type === 'directory' ? 0o700 : 0o600;
  try {
    fs.chmodSync(filePath, mode);
  } catch {
    // On Windows, chmod may not work — this is best-effort
  }
}
