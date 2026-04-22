import { createInterface } from 'node:readline';

/**
 * Prompt for a passphrase without echoing input.
 * Writes prompt to stderr so stdout remains clean for piping.
 */
export async function promptPassphrase(
  prompt = 'Passphrase: ',
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error('Cannot prompt for passphrase: stdin is not a TTY'));
      return;
    }

    const rl = createInterface({
      input: process.stdin,
      output: process.stderr,
    });

    const origWrite = process.stderr.write.bind(process.stderr);
    let muted = false;
    process.stderr.write = ((chunk: string | Uint8Array) => {
      if (muted) return true;
      return origWrite(chunk);
    }) as typeof process.stderr.write;

    rl.question(prompt, (answer) => {
      muted = false;
      process.stderr.write = origWrite;
      process.stderr.write('\n');
      rl.close();
      resolve(answer);
    });

    muted = true;
  });
}

/**
 * Prompt for a passphrase twice and ensure they match.
 */
export async function promptPassphraseConfirm(): Promise<string> {
  const pass1 = await promptPassphrase('New passphrase: ');
  const pass2 = await promptPassphrase('Confirm passphrase: ');
  if (pass1 !== pass2) {
    throw new Error('Passphrases do not match.');
  }
  if (pass1.length < 8) {
    throw new Error('Passphrase must be at least 8 characters.');
  }
  return pass1;
}
