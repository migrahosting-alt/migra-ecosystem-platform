import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const MAIL_CORE_HOST = "mail-core";
const SSH_TIMEOUT_MS = 15_000;

const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\"'\"'`)}'`;

async function runMailCoreCommand(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(
    "ssh",
    ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", MAIL_CORE_HOST, ...args],
    {
      timeout: SSH_TIMEOUT_MS,
      maxBuffer: 1024 * 1024,
    },
  );

  return stdout.trim();
}

export async function hashMailboxPassword(password: string): Promise<string> {
  const hash = await runMailCoreCommand([
    "doveadm",
    "pw",
    "-s",
    "BLF-CRYPT",
    "-p",
    password,
  ]);

  if (!hash) {
    throw new Error("mail_password_hash_failed");
  }

  return hash;
}

export async function ensureMailboxMaildir(address: string): Promise<void> {
  const [localPart, domain] = address.trim().toLowerCase().split("@");
  if (!localPart || !domain) {
    throw new Error("invalid_mailbox_address");
  }

  const path = `/var/vmail/${domain}/${localPart}/Maildir`;
  const remoteScript =
    "set -e; " +
    `path=${shellQuote(path)}; ` +
    'parent=$(dirname "$path"); ' +
    'if [ ! -d "$path" ]; then maildirmake.dovecot "$path"; fi; ' +
    'chown -R vmail:vmail "$parent"; ' +
    'chmod 700 "$parent" "$path" "$path/cur" "$path/new" "$path/tmp"';

  await runMailCoreCommand(["bash", "-lc", remoteScript]);
}
