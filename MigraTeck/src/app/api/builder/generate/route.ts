/**
 * POST /api/builder/generate — AI-generate a site schema from a business prompt
 *
 * Accepts a text prompt describing the business, generates a full SiteSchema with
 * pages and sections, then persists the site, pages, and sections.
 *
 * The actual AI call is isolated to a helper so the provider can be swapped later.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireBuilderAuth, builderAudit } from "@/lib/builder/auth";
import { getClientIp, getUserAgent } from "@/lib/request";
import { validateSiteSchema } from "@/lib/builder/validator";
import { DEFAULT_THEME } from "@/lib/builder/types";

// ── Request schema ──────────────────────────────────────────────
const generateSchema = z.object({
  prompt: z.string().min(10).max(2000),
  siteName: z.string().min(1).max(200).optional(),
});

// ── Slug helper ─────────────────────────────────────────────────
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .substring(0, 100);
}

// ── Section data for generation ─────────────────────────────────
interface GenSection {
  sectionType: string;
  props: Record<string, unknown>;
  sortOrder: number;
  isVisible: boolean;
}

interface GenPage {
  title: string;
  slug: string;
  sections: GenSection[];
}

interface GenSchema {
  name: string;
  theme: Record<string, unknown>;
  pages: GenPage[];
}

// ── Deterministic fallback generator (no AI dependency) ─────────
function generateFallbackSchema(prompt: string, siteName: string): GenSchema {
  const name = siteName || prompt.split(/[.,!?\n]/).at(0)?.trim().substring(0, 60) || "My Website";

  return {
    name,
    theme: { ...DEFAULT_THEME },
    pages: [
      {
        title: "Home",
        slug: "home",
        sections: [
          {
            sectionType: "navbar",
            props: {
              logo: { type: "text", text: name },
              links: [
                { label: "Home", href: "#" },
                { label: "Services", href: "#services" },
                { label: "About", href: "#about" },
                { label: "Contact", href: "#contact" },
              ],
              cta: { label: "Get Started", href: "#contact" },
            },
            sortOrder: 0,
            isVisible: true,
          },
          {
            sectionType: "hero",
            props: {
              headline: name,
              subheadline: prompt.substring(0, 160),
              cta: { label: "Learn More", href: "#services" },
              alignment: "center",
            },
            sortOrder: 1,
            isVisible: true,
          },
          {
            sectionType: "services",
            props: {
              heading: "Our Services",
              subtitle: "What we offer",
              items: [
                { icon: "⭐", title: "Service One", description: "High quality service tailored to your needs." },
                { icon: "🚀", title: "Service Two", description: "Fast and reliable solutions for your business." },
                { icon: "💡", title: "Service Three", description: "Innovative approaches to modern challenges." },
              ],
            },
            sortOrder: 2,
            isVisible: true,
          },
          {
            sectionType: "testimonials",
            props: {
              heading: "What Our Clients Say",
              items: [
                { quote: "Excellent service and professional team!", author: "Happy Customer", role: "Client", rating: 5 },
                { quote: "Highly recommend. Transformed our business.", author: "Satisfied Partner", role: "Partner", rating: 5 },
              ],
            },
            sortOrder: 3,
            isVisible: true,
          },
          {
            sectionType: "contactForm",
            props: {
              heading: "Get In Touch",
              subtitle: "We'd love to hear from you",
              fields: [
                { name: "name", label: "Your Name", type: "text", required: true },
                { name: "email", label: "Email Address", type: "email", required: true },
                { name: "phone", label: "Phone", type: "tel", required: false },
                { name: "message", label: "Message", type: "textarea", required: true },
              ],
              submitLabel: "Send Message",
              successMessage: "Thank you! We'll be in touch soon.",
            },
            sortOrder: 4,
            isVisible: true,
          },
          {
            sectionType: "footer",
            props: {
              companyName: name,
              tagline: "Professional services you can trust.",
              links: [
                { label: "Privacy Policy", href: "/privacy" },
                { label: "Terms of Service", href: "/terms" },
              ],
              socialLinks: [],
            },
            sortOrder: 5,
            isVisible: true,
          },
        ],
      },
    ],
  };
}

// ── Route handler ───────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const auth = await requireBuilderAuth("builder:edit");
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  const parsed = generateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Invalid request.", details: parsed.error.issues } },
      { status: 400 },
    );
  }

  const { prompt, siteName } = parsed.data;
  const name = siteName || prompt.split(/[.,!?\n]/).at(0)?.trim().substring(0, 60) || "My Website";

  // Generate site schema (deterministic fallback; AI integration comes later)
  const schema = generateFallbackSchema(prompt, name);

  // Validate the generated schema as if it were a SiteSchema
  const validation = validateSiteSchema(schema as never);
  if (!validation.ok) {
    return NextResponse.json(
      { error: { code: "generation_failed", message: "Generated schema failed validation.", details: validation.errors } },
      { status: 500 },
    );
  }

  // Generate a unique slug
  const baseSlug = slugify(name);
  let slug = baseSlug;
  let attempt = 0;
  while (await prisma.builderSite.findUnique({ where: { slug } })) {
    attempt++;
    slug = `${baseSlug}-${attempt}`;
  }

  // Persist in a transaction
  const site = await prisma.$transaction(async (tx) => {
    const newSite = await tx.builderSite.create({
      data: {
        orgId: auth.auth.orgId,
        createdById: auth.auth.userId,
        name: schema.name,
        slug,
        themeJson: schema.theme as unknown as Prisma.InputJsonValue,
      },
    });

    for (const pageSchema of schema.pages) {
      const newPage = await tx.builderPage.create({
        data: {
          siteId: newSite.id,
          title: pageSchema.title,
          slug: pageSchema.slug,
          sortOrder: 0,
        },
      });

      for (const sec of pageSchema.sections) {
        await tx.builderSection.create({
          data: {
            pageId: newPage.id,
            sectionType: sec.sectionType,
            propsJson: sec.props as unknown as Prisma.InputJsonValue,
            sortOrder: sec.sortOrder,
            isVisible: sec.isVisible,
          },
        });
      }
    }

    // Create initial version snapshot
    await tx.builderSiteVersion.create({
      data: {
        siteId: newSite.id,
        version: 1,
        snapshotJson: schema as unknown as Prisma.InputJsonValue,
        createdById: auth.auth.userId,
      },
    });

    return newSite;
  });

  await builderAudit({
    userId: auth.auth.userId,
    orgId: auth.auth.orgId,
    action: "SITE_GENERATED",
    resourceType: "builder_site",
    resourceId: site.id,
    ip: getClientIp(request),
    userAgent: getUserAgent(request),
    metadata: { prompt: prompt.substring(0, 200), siteName: name },
  });

  // Return the full site with pages and sections
  const fullSite = await prisma.builderSite.findUnique({
    where: { id: site.id },
    include: {
      pages: {
        orderBy: { sortOrder: "asc" },
        include: { sections: { orderBy: { sortOrder: "asc" } } },
      },
    },
  });

  return NextResponse.json({ site: fullSite }, { status: 201 });
}
