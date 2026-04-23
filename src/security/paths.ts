import path from 'node:path';
import fs from 'node:fs';
import { PathTraversalError } from '../types.js';

/** Windows reserved device names */
const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i;

/**
 * Validate and resolve a vault path, ensuring it stays within the vault root.
 *
 * @param userPath - The user-provided path (relative to vault root)
 * @param vaultRoot - Absolute path to the vault root directory
 * @returns The resolved absolute path guaranteed to be within vaultRoot
 * @throws PathTraversalError if path escapes vault root
 */
export function validateVaultPath(userPath: string, vaultRoot: string): string {
  // 1. Reject null bytes
  if (userPath.includes('\0')) {
    throw new PathTraversalError('Path contains null bytes');
  }

  // 2. Reject absolute paths — vault paths must be relative
  if (path.isAbsolute(userPath)) {
    throw new PathTraversalError(`Path "${userPath}" must be relative to vault root`);
  }

  // 3. Normalize the vault root to a resolved absolute path
  const resolvedRoot = path.resolve(vaultRoot);

  // 3. Join vaultRoot + userPath, resolve to absolute
  const resolved = path.resolve(resolvedRoot, userPath);

  // 4. Ensure the resolved path is within the vault root
  const rootWithSep = resolvedRoot + path.sep;
  const isWithin =
    process.platform === 'win32'
      ? resolved.toLowerCase() === resolvedRoot.toLowerCase() ||
        resolved.toLowerCase().startsWith(rootWithSep.toLowerCase())
      : resolved === resolvedRoot || resolved.startsWith(rootWithSep);

  if (!isWithin) {
    throw new PathTraversalError(`Path "${userPath}" resolves outside vault root`);
  }

  // 5. Windows-specific checks
  if (process.platform === 'win32') {
    // Check every component of the relative path for ADS and reserved names
    const relative = path.relative(resolvedRoot, resolved);
    const components = relative.split(path.sep);

    for (const component of components) {
      if (component === '') continue;

      if (hasAlternateDataStream(component)) {
        throw new PathTraversalError(
          `Path contains Windows Alternate Data Stream notation: "${component}"`,
        );
      }

      // Strip extension for reserved-name check (e.g. CON.txt is also reserved)
      if (WINDOWS_RESERVED.test(component)) {
        throw new PathTraversalError(`Path contains Windows reserved device name: "${component}"`);
      }
    }
  }

  // 6. Symlink detection — reject if path exists and is a symlink
  try {
    const stat = fs.lstatSync(resolved);
    if (stat.isSymbolicLink()) {
      throw new PathTraversalError(`Path "${userPath}" is a symbolic link, which is not allowed`);
    }
  } catch (err) {
    // If the file doesn't exist, that's fine (new file path)
    if (err instanceof PathTraversalError) throw err;
    // ENOENT or other fs errors are acceptable
  }

  return resolved;
}

/**
 * Check if a filename contains Windows Alternate Data Stream notation.
 * Looks for colon in the basename (ignoring drive letter prefix).
 */
export function hasAlternateDataStream(filepath: string): boolean {
  const basename = path.basename(filepath);
  // On Windows, a drive-letter path like C: would have a colon at index 1,
  // but basenames should never contain drive letters.
  return basename.includes(':');
}
