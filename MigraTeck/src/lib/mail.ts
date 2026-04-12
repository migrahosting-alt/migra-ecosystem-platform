import { accessSync, constants } from "fs";
import { spawn } from "child_process";
import { env } from "@/lib/env";

type MailPayload = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

const sendmailBinary = "/usr/sbin/sendmail";

function canUseSendmail(): boolean {
  try {
    accessSync(sendmailBinary, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function isSmtpConfigured(): boolean {
  return Boolean(env.SMTP_FROM && canUseSendmail());
}

function sanitizeHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function encodeHeader(value: string) {
  const sanitized = sanitizeHeader(value);
  if (/^[\x20-\x7E]*$/.test(sanitized)) {
    return sanitized;
  }

  return `=?UTF-8?B?${Buffer.from(sanitized, "utf8").toString("base64")}?=`;
}

function buildMessage(payload: MailPayload) {
  const boundary = `migra-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
  const from = sanitizeHeader(env.SMTP_FROM || "services@migrateck.com");
  const to = sanitizeHeader(payload.to);

  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(payload.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    payload.text,
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    payload.html,
    "",
    `--${boundary}--`,
    "",
  ].join("\n");
}

async function sendViaSendmail(payload: MailPayload) {
  const message = buildMessage(payload);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(sendmailBinary, ["-i", "-t"], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(stderr || `sendmail exited with code ${code}`));
    });

    child.stdin.end(message);
  });
}

export async function sendMail(payload: MailPayload): Promise<boolean> {
  if (!isSmtpConfigured()) {
    console.warn("Mail transport not configured. Email message skipped for", payload.to);
    return false;
  }

  try {
    await sendViaSendmail(payload);
  } catch (error) {
    console.error("Mail delivery failed for", payload.to, error);
    return false;
  }

  return true;
}
