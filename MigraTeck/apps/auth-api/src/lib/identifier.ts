export type ParsedIdentifier =
  | {
      kind: "EMAIL";
      normalized: string;
      display: string;
      channel: "EMAIL";
    }
  | {
      kind: "PHONE";
      normalized: string;
      display: string;
      channel: "SMS";
    };

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function normalizePhone(value: string): string | null {
  const trimmed = value.trim();
  const digits = trimmed.replace(/[^\d+]/g, "");

  if (digits.startsWith("+")) {
    const e164 = `+${digits.slice(1).replace(/\D/g, "")}`;
    return /^\+[1-9]\d{7,14}$/.test(e164) ? e164 : null;
  }

  const justDigits = digits.replace(/\D/g, "");
  if (justDigits.length === 10) {
    return `+1${justDigits}`;
  }
  if (justDigits.length === 11 && justDigits.startsWith("1")) {
    return `+${justDigits}`;
  }

  return null;
}

export function parseIdentifier(value: string): ParsedIdentifier {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error("Identifier is required.");
  }

  if (trimmed.includes("@")) {
    const normalized = normalizeEmail(trimmed);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      throw new Error("Enter a valid email address.");
    }

    return {
      kind: "EMAIL",
      normalized,
      display: trimmed,
      channel: "EMAIL",
    };
  }

  const normalized = normalizePhone(trimmed);
  if (!normalized) {
    throw new Error("Enter a valid email address or phone number.");
  }

  return {
    kind: "PHONE",
    normalized,
    display: trimmed,
    channel: "SMS",
  };
}

export function maskIdentifier(input: {
  kind: "EMAIL" | "PHONE";
  normalized: string;
}): string {
  if (input.kind === "EMAIL") {
    const [localPart = "", domainPart = ""] = input.normalized.split("@");
    const [domainLabel = "", ...tldParts] = domainPart.split(".");
    const localMasked = `${localPart.slice(0, 1)}***`;
    const domainMasked = domainLabel ? `${domainLabel.slice(0, 1)}***` : "***";
    const tld = tldParts.length ? `.${tldParts.join(".")}` : "";
    return `${localMasked}@${domainMasked}${tld}`;
  }

  const digits = input.normalized.replace(/\D/g, "");
  const lastFour = digits.slice(-4).padStart(4, "*");
  return `***-***-${lastFour}`;
}
