import argon2 from "argon2";

const ARGON_CONFIG: argon2.Options & { raw?: false } = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON_CONFIG);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password);
}

/**
 * Enterprise password complexity: requires at least 3 of 4 character classes.
 * Returns null if valid, or a human-readable error string.
 */
export function validatePasswordComplexity(password: string): string | null {
  const checks = [
    /[A-Z]/.test(password),
    /[a-z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ];

  const passed = checks.filter(Boolean).length;
  if (passed < 3) {
    return "Password must include at least 3 of: uppercase, lowercase, number, symbol.";
  }

  return null;
}
