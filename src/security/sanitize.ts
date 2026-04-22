/**
 * Regex matching ANSI escape sequences:
 * - CSI sequences: ESC [ ... final byte
 * - OSC sequences: ESC ] ... (terminated by BEL or ST)
 * - Other escape sequences: ESC followed by a character
 */
const ANSI_REGEX =
  // eslint-disable-next-line no-control-regex, no-useless-escape
  /[\u001b\u009b][\[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]|[\u001b\u009b]\].*?(?:\u0007|\u001b\\)|[\u001b\u009b][^[\]]{0,2}/g;

/**
 * Regex matching control characters except \n (0x0A), \r (0x0D), and \t (0x09).
 */
const CONTROL_CHARS_REGEX =
  // eslint-disable-next-line no-control-regex
  /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/**
 * Strip ANSI escape sequences and control characters from a string.
 * Use this before printing decrypted content to terminal.
 * Preserves newlines (\n), carriage returns (\r), and tabs (\t).
 */
export function sanitizeOutput(input: string): string {
  return input.replace(ANSI_REGEX, '').replace(CONTROL_CHARS_REGEX, '');
}

/** Maximum allowed length for search patterns */
const MAX_PATTERN_LENGTH = 1024;

/**
 * Validate a search pattern to prevent injection.
 * Allows normal regex patterns but rejects attempts to escape context.
 */
export function sanitizeSearchPattern(pattern: string): string {
  if (pattern.includes('\0')) {
    throw new Error('Search pattern must not contain null bytes');
  }

  if (pattern.length > MAX_PATTERN_LENGTH) {
    throw new Error(
      `Search pattern exceeds maximum length of ${MAX_PATTERN_LENGTH}`,
    );
  }

  return pattern;
}
