import { absoluteUrl } from "@/lib/metadata";

export function GET() {
  const content = [
    "Contact: mailto:security@migrateck.com",
    "Preferred-Languages: en",
    `Canonical: ${absoluteUrl("/.well-known/security.txt")}`,
    `Policy: ${absoluteUrl("/security")}`,
    `Hiring: ${absoluteUrl("/company")}`,
  ].join("\n");

  return new Response(content, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
