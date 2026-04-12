/**
 * MigraBuilder — Zod-based validation for section props, pages, and sites.
 * Registry-based: each section type has a dedicated prop schema.
 */
import { z } from "zod";
import type { SectionType } from "./types";

// ── Per-Section Prop Schemas ────────────────────────────────────────

const linkSchema = z.object({ label: z.string().min(1), href: z.string().min(1) });

const navbarPropsSchema = z.object({
  logoText: z.string().min(1).max(120),
  logoUrl: z.string().url().optional(),
  links: z.array(linkSchema).max(10),
  ctaLabel: z.string().max(60).optional(),
  ctaHref: z.string().max(500).optional(),
});

const heroPropsSchema = z.object({
  headline: z.string().min(1).max(200),
  subheadline: z.string().max(500),
  ctaLabel: z.string().min(1).max(60),
  ctaHref: z.string().min(1).max(500),
  backgroundImageUrl: z.string().url().optional(),
  alignment: z.enum(["left", "center", "right"]),
});

const aboutPropsSchema = z.object({
  heading: z.string().min(1).max(200),
  body: z.string().min(1).max(5000),
  imageUrl: z.string().url().optional(),
  imagePosition: z.enum(["left", "right"]),
});

const serviceItemSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(1000),
  icon: z.string().max(60).optional(),
});

const servicesPropsSchema = z.object({
  heading: z.string().min(1).max(200),
  subtitle: z.string().max(500).optional(),
  items: z.array(serviceItemSchema).min(1).max(12),
});

const featuresPropsSchema = z.object({
  heading: z.string().min(1).max(200),
  subtitle: z.string().max(500).optional(),
  items: z.array(serviceItemSchema).min(1).max(16),
  columns: z.union([z.literal(2), z.literal(3), z.literal(4)]),
});

const testimonialItemSchema = z.object({
  quote: z.string().min(1).max(1000),
  author: z.string().min(1).max(120),
  role: z.string().max(120).optional(),
  avatarUrl: z.string().url().optional(),
  rating: z.number().int().min(1).max(5).optional(),
});

const testimonialsPropsSchema = z.object({
  heading: z.string().min(1).max(200),
  items: z.array(testimonialItemSchema).min(1).max(20),
});

const faqItemSchema = z.object({
  question: z.string().min(1).max(500),
  answer: z.string().min(1).max(3000),
});

const faqPropsSchema = z.object({
  heading: z.string().min(1).max(200),
  items: z.array(faqItemSchema).min(1).max(30),
});

const ctaPropsSchema = z.object({
  heading: z.string().min(1).max(200),
  subheading: z.string().max(500).optional(),
  buttonLabel: z.string().min(1).max(60),
  buttonHref: z.string().min(1).max(500),
  variant: z.enum(["primary", "secondary", "accent"]),
});

const formFieldSchema = z.object({
  name: z.string().min(1).max(60),
  label: z.string().min(1).max(120),
  type: z.enum(["text", "email", "tel", "textarea", "select"]),
  required: z.boolean(),
  options: z.array(z.string().max(200)).optional(),
});

const contactFormPropsSchema = z.object({
  heading: z.string().min(1).max(200),
  subtitle: z.string().max(500).optional(),
  fields: z.array(formFieldSchema).min(1).max(20),
  submitLabel: z.string().min(1).max(60),
  successMessage: z.string().min(1).max(500),
});

const galleryImageSchema = z.object({
  url: z.string().url(),
  alt: z.string().max(200),
  caption: z.string().max(500).optional(),
});

const galleryPropsSchema = z.object({
  heading: z.string().max(200).optional(),
  images: z.array(galleryImageSchema).min(1).max(50),
  columns: z.union([z.literal(2), z.literal(3), z.literal(4)]),
});

const planSchema = z.object({
  name: z.string().min(1).max(60),
  price: z.string().min(1).max(20),
  period: z.string().min(1).max(30),
  features: z.array(z.string().max(200)).min(1).max(20),
  ctaLabel: z.string().min(1).max(60),
  ctaHref: z.string().min(1).max(500),
  highlighted: z.boolean().optional(),
});

const pricingPropsSchema = z.object({
  heading: z.string().min(1).max(200),
  subtitle: z.string().max(500).optional(),
  plans: z.array(planSchema).min(1).max(6),
});

const footerPropsSchema = z.object({
  companyName: z.string().min(1).max(120),
  tagline: z.string().max(200).optional(),
  links: z.array(linkSchema).max(20),
  socialLinks: z.array(z.object({ platform: z.string().max(30), url: z.string().url() })).max(10).optional(),
  copyright: z.string().max(200).optional(),
});

// ── Section Validator Registry ──────────────────────────────────────

const sectionValidatorRegistry: Record<SectionType, z.ZodTypeAny> = {
  navbar: navbarPropsSchema,
  hero: heroPropsSchema,
  about: aboutPropsSchema,
  services: servicesPropsSchema,
  features: featuresPropsSchema,
  testimonials: testimonialsPropsSchema,
  faq: faqPropsSchema,
  cta: ctaPropsSchema,
  contactForm: contactFormPropsSchema,
  gallery: galleryPropsSchema,
  pricing: pricingPropsSchema,
  footer: footerPropsSchema,
};

// ── Public API ──────────────────────────────────────────────────────

export function validateSectionProps(
  sectionType: string,
  props: unknown,
): { ok: true; data: unknown } | { ok: false; errors: z.ZodIssue[] } {
  const schema = sectionValidatorRegistry[sectionType as SectionType];
  if (!schema) {
    return { ok: false, errors: [{ code: "custom", path: ["sectionType"], message: `Unknown section type: ${sectionType}` }] };
  }
  const result = schema.safeParse(props);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, errors: result.error.issues };
}

export const sectionDescriptorSchema = z.object({
  id: z.string().min(1).optional(),
  sectionType: z.string().min(1),
  props: z.record(z.string(), z.unknown()),
  sortOrder: z.number().int().min(0),
  isVisible: z.boolean(),
});

export const pageSchema = z.object({
  id: z.string().min(1).optional(),
  title: z.string().min(1).max(200),
  slug: z.string().min(1).max(120),
  sortOrder: z.number().int().min(0).optional(),
  meta: z.object({ title: z.string().optional(), description: z.string().optional() }).optional().default({}),
  sections: z.array(sectionDescriptorSchema),
});

export const siteSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  theme: z.object({
    primaryColor: z.string(),
    secondaryColor: z.string(),
    accentColor: z.string(),
    backgroundColor: z.string(),
    textColor: z.string(),
    fontHeading: z.string(),
    fontBody: z.string(),
    borderRadius: z.enum(["none", "sm", "md", "lg", "full"]),
  }),
  meta: z.object({ title: z.string().optional(), description: z.string().optional(), favicon: z.string().optional() }).optional().default({}),
  pages: z.array(pageSchema).min(1),
});

/**
 * Validate a full site schema — validates structure AND every section's props.
 */
export function validateSiteSchema(
  site: unknown,
): { ok: true; data: z.infer<typeof siteSchema> } | { ok: false; errors: z.ZodIssue[] } {
  const structResult = siteSchema.safeParse(site);
  if (!structResult.success) return { ok: false, errors: structResult.error.issues };

  const allErrors: z.ZodIssue[] = [];
  for (const page of structResult.data.pages) {
    for (const section of page.sections) {
      const propResult = validateSectionProps(section.sectionType, section.props);
      if (!propResult.ok) {
        for (const err of propResult.errors) {
          allErrors.push({
            ...err,
            path: ["pages", page.slug, "sections", section.id ?? section.sectionType, ...err.path],
          });
        }
      }
    }
  }

  if (allErrors.length > 0) return { ok: false, errors: allErrors };
  return { ok: true, data: structResult.data };
}

// Re-export individual schemas for route-level use
export {
  heroPropsSchema,
  servicesPropsSchema,
  testimonialsPropsSchema,
  contactFormPropsSchema,
  navbarPropsSchema,
  footerPropsSchema,
  aboutPropsSchema,
  featuresPropsSchema,
  faqPropsSchema,
  ctaPropsSchema,
  galleryPropsSchema,
  pricingPropsSchema,
};
