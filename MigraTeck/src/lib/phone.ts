export function normalizeUsPhoneNumber(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error("Phone number is required.");
  }

  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+") && digits.length >= 10 && digits.length <= 15) {
    return `+${digits}`;
  }

  if (digits.length === 10) {
    return `+1${digits}`;
  }

  if (digits.length === 11 && digits.startsWith("1")) {
    return `+${digits}`;
  }

  throw new Error("Phone number must be a valid E.164 number or a 10-digit US number.");
}

export function maskPhoneNumber(input: string): string {
  const normalized = normalizeUsPhoneNumber(input);
  if (normalized.length <= 6) {
    return normalized;
  }

  return `${normalized.slice(0, 2)}${"*".repeat(Math.max(0, normalized.length - 4))}${normalized.slice(-2)}`;
}