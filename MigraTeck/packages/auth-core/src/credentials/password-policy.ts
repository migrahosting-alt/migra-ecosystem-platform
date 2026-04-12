import { validatePasswordComplexity } from "@/lib/security/password";

const COMMON_PASSWORDS = new Set([
  "password",
  "password123",
  "123456789",
  "1234567890",
  "123456789012",
  "qwerty123",
  "letmein123",
  "welcome123",
  "admin123456",
]);

export function validateEnterprisePassword(password: string): string | null {
  if (password.length < 12) {
    return "Password must be at least 12 characters long.";
  }

  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return "Password is too common. Choose a stronger password.";
  }

  return validatePasswordComplexity(password);
}