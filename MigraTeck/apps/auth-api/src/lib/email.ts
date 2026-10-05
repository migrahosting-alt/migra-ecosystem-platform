/**
 * Email service — SMTP transactional email delivery.
 * Sends verification, password reset, and notification emails.
 */
import { createTransport, type Transporter } from "nodemailer";
import { config } from "../config/env.js";

let transporter: Transporter;

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpPort === 465,
      ...(config.smtpUser
        ? { auth: { user: config.smtpUser, pass: config.smtpPass } }
        : {}),
    });
  }
  return transporter;
}

export async function sendVerificationEmail(
  to: string,
  tokenOrCode: string,
  returnTo?: string,
  _brand?: unknown,
): Promise<void> {
  const isCode = /^\d{6}$/.test(tokenOrCode);
  const verifyUrl = new URL("/verify-email", config.webUrl);
  if (!isCode) {
    verifyUrl.searchParams.set("token", tokenOrCode);
    if (returnTo) verifyUrl.searchParams.set("return_to", returnTo);
  }

  await getTransporter().sendMail({
    from: config.emailFrom,
    to,
    subject: "Verify your MigraTeck Account",
    text: isCode
      ? `Your verification code is ${tokenOrCode}. It expires in 10 minutes.`
      : `Verify your email: ${verifyUrl.toString()}\n\nThis link expires in 1 hour.`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
        <h2 style="color:#1e40af;">Verify your MigraTeck Account</h2>
        ${
          isCode
            ? `
        <p>Enter this verification code to confirm your email address.</p>
        <div style="display:inline-block;padding:12px 20px;background:#eff6ff;color:#1d4ed8;border-radius:10px;font-size:28px;font-weight:700;letter-spacing:0.24em;">
          ${tokenOrCode}
        </div>
        <p style="color:#6b7280;font-size:13px;margin-top:24px;">This code expires in 10 minutes. If you did not create an account, ignore this email.</p>
        `
            : `
        <p>Click the button below to verify your email address.</p>
        <a href="${verifyUrl.toString()}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">
          Verify email
        </a>
        <p style="color:#6b7280;font-size:13px;margin-top:24px;">This link expires in 1 hour. If you did not create an account, ignore this email.</p>
        `
        }
      </div>
    `,
  });
}

export async function sendInternalInviteEmail(
  to: string,
  token: string,
  displayName?: string,
): Promise<void> {
  const setupUrl = new URL("/reset-password", config.webUrl);
  setupUrl.searchParams.set("token", token);
  setupUrl.searchParams.set("client_id", "migrapanel_web");
  setupUrl.searchParams.set("invite", "1");

  await getTransporter().sendMail({
    from: config.emailFrom,
    to,
    subject: "You were invited to MigraTeck",
    text: `You were invited to the MigraTeck organization. Set up your account: ${setupUrl.toString()}\n\nThis link expires in 30 minutes.`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto;">
        <h2 style="color:#1e40af;">Welcome to MigraTeck</h2>
        <p>${displayName ? `Hello ${displayName}, ` : ""}an authorized MigraTeck operator created an internal account for you.</p>
        <p>Use the button below to choose your own password and activate the identity. No platform authority is granted until an authorized owner delegates it separately.</p>
        <a href="${setupUrl.toString()}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">
          Set up account
        </a>
        <p style="color:#6b7280;font-size:13px;margin-top:24px;">This link expires in 30 minutes. If you were not expecting this invitation, do not use it.</p>
      </div>
    `,
  });
}

export async function sendPasswordResetEmail(
  to: string,
  token: string,
  clientId?: string,
  _brand?: unknown,
): Promise<void> {
  const resetUrl = new URL("/reset-password", config.webUrl);
  resetUrl.searchParams.set("token", token);
  if (clientId) {
    resetUrl.searchParams.set("client_id", clientId);
  }

  await getTransporter().sendMail({
    from: config.emailFrom,
    to,
    subject: "Reset your MigraTeck Account password",
    text: `Reset your password: ${resetUrl.toString()}\n\nThis link expires in 30 minutes.`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
        <h2 style="color:#1e40af;">Reset your password</h2>
        <p>Click the button below to set a new password for your MigraTeck Account.</p>
        <a href="${resetUrl.toString()}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">
          Reset password
        </a>
        <p style="color:#6b7280;font-size:13px;margin-top:24px;">This link expires in 30 minutes. If you did not request this, ignore this email.</p>
      </div>
    `,
  });
}
