import { execFile } from "node:child_process";

// Passwords travel over stdin, never in argv, URLs, or propagated child errors.
function runMailCoreCommand(command: string, input: string): Promise<string> {
  const config = process.env.MAIL_PROVISION_SSH_CONFIG;
  if (!config || !config.startsWith("/")) {
    return Promise.reject(new Error("Mail provisioning SSH configuration is missing."));
  }
  return new Promise((resolve, reject) => {
    const child = execFile("ssh", [
      "-F", config, "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
      "-o", "ConnectTimeout=10", "mail-provision", command,
    ], { timeout: 15_000, maxBuffer: 1024 * 1024 }, (error, stdout) => {
      if (error) {
        reject(new Error("Mail server operation failed. Contact the administrator."));
      } else {
        resolve(stdout.trim());
      }
    });
    // EPIPE can occur when SSH rejects the connection before reading input.
    child.stdin?.on("error", () => {});
    child.stdin?.end(input);
  });
}

export async function hashMailboxPassword(password: string): Promise<string> {
  if (!password || /[\r\n\0]/.test(password) || Buffer.byteLength(password, "utf8") > 72) {
    throw new Error("Password must contain 1–72 UTF-8 bytes and no line breaks or null characters.");
  }
  const hash = await runMailCoreCommand("hash-password", `${password}\n${password}\n`);
  if (!/^\{BLF-CRYPT\}\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(hash)) {
    throw new Error("Mail server returned an invalid password hash.");
  }
  return hash;
}

export async function ensureMailboxMaildir(address: string): Promise<void> {
  const normalized = address.trim().toLowerCase();
  const parts = normalized.split("@");
  const [localPart, domain] = parts;
  if (parts.length !== 2 || !localPart || !domain ||
      !/^[a-z0-9._+-]+$/.test(localPart) || localPart === "." || localPart === ".." ||
      domain.length > 253 || !domain.split(".").every((label) =>
        /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    throw new Error("Invalid mailbox address.");
  }
  await runMailCoreCommand("ensure-maildir", `${normalized}\n`);
}
