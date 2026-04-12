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
  token: string,
  returnTo?: string,
): Promise<void> {
  const verifyUrl = new URL("/verify-email", config.webUrl);
  verifyUrl.searchParams.set("token", token);
  if (returnTo) verifyUrl.searchParams.set("return_to", returnTo);

  await getTransporter().sendMail({
    from: config.emailFrom,
    to,
    subject: "Verify your MigraTeck Account",
    text: `Verify your email: ${verifyUrl.toString()}\n\nThis link expires in 1 hour.`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;">
        <h2 style="color:#1e40af;">Verify your MigraTeck Account</h2>
        <p>Click the button below to verify your email address.</p>
        <a href="${verifyUrl.toString()}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;">
          Verify email
        </a>
        <p style="color:#6b7280;font-size:13px;margin-top:24px;">This link expires in 1 hour. If you did not create an account, ignore this email.</p>
      </div>
    `,
  });
}

export async function sendPasswordResetEmail(
  to: string,
  token: string,
): Promise<void> {
  const resetUrl = new URL("/reset-password", config.webUrl);
  resetUrl.searchParams.set("token", token);

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
