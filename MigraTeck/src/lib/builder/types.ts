/**
 * MigraBuilder — Section type registry and shared type definitions.
 */

// ── Section Type Registry ───────────────────────────────────────────

export const SECTION_TYPES = [
  "hero",
  "about",
  "services",
  "features",
  "testimonials",
  "faq",
  "cta",
  "contactForm",
  "gallery",
  "pricing",
  "navbar",
  "footer",
] as const;

export type SectionType = (typeof SECTION_TYPES)[number];

// ── Theme ───────────────────────────────────────────────────────────

export interface BuilderTheme {
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  backgroundColor: string;
  textColor: string;
  fontHeading: string;
  fontBody: string;
  borderRadius: "none" | "sm" | "md" | "lg" | "full";
}

export const DEFAULT_THEME: BuilderTheme = {
  primaryColor: "#2563eb",
  secondaryColor: "#1e40af",
  accentColor: "#f59e0b",
  backgroundColor: "#ffffff",
  textColor: "#111827",
  fontHeading: "Inter",
  fontBody: "Inter",
  borderRadius: "md",
};

// ── Section Props ───────────────────────────────────────────────────

export interface NavbarProps {
  logoText: string;
  logoUrl?: string;
  links: { label: string; href: string }[];
  ctaLabel?: string;
  ctaHref?: string;
}

export interface HeroProps {
  headline: string;
  subheadline: string;
  ctaLabel: string;
  ctaHref: string;
  backgroundImageUrl?: string;
  alignment: "left" | "center" | "right";
}

export interface AboutProps {
  heading: string;
  body: string;
  imageUrl?: string;
  imagePosition: "left" | "right";
}

export interface ServicesProps {
  heading: string;
  subtitle?: string;
  items: {
    title: string;
    description: string;
    icon?: string;
  }[];
}

export interface FeaturesProps {
  heading: string;
  subtitle?: string;
  items: {
    title: string;
    description: string;
    icon?: string;
  }[];
  columns: 2 | 3 | 4;
}

export interface TestimonialsProps {
  heading: string;
  items: {
    quote: string;
    author: string;
    role?: string;
    avatarUrl?: string;
    rating?: number;
  }[];
}

export interface FaqProps {
  heading: string;
  items: { question: string; answer: string }[];
}

export interface CtaProps {
  heading: string;
  subheading?: string;
  buttonLabel: string;
  buttonHref: string;
  variant: "primary" | "secondary" | "accent";
}

export interface ContactFormProps {
  heading: string;
  subtitle?: string;
  fields: {
    name: string;
    label: string;
    type: "text" | "email" | "tel" | "textarea" | "select";
    required: boolean;
    options?: string[];
  }[];
  submitLabel: string;
  successMessage: string;
}

export interface GalleryProps {
  heading?: string;
  images: { url: string; alt: string; caption?: string }[];
  columns: 2 | 3 | 4;
}

export interface PricingProps {
  heading: string;
  subtitle?: string;
  plans: {
    name: string;
    price: string;
    period: string;
    features: string[];
    ctaLabel: string;
    ctaHref: string;
    highlighted?: boolean;
  }[];
}

export interface FooterProps {
  companyName: string;
  tagline?: string;
  links: { label: string; href: string }[];
  socialLinks?: { platform: string; url: string }[];
  copyright?: string;
}

// ── Section Props Map ───────────────────────────────────────────────

export interface SectionPropsMap {
  navbar: NavbarProps;
  hero: HeroProps;
  about: AboutProps;
  services: ServicesProps;
  features: FeaturesProps;
  testimonials: TestimonialsProps;
  faq: FaqProps;
  cta: CtaProps;
  contactForm: ContactFormProps;
  gallery: GalleryProps;
  pricing: PricingProps;
  footer: FooterProps;
}

// ── Section Descriptor ──────────────────────────────────────────────

export interface SectionDescriptor<T extends SectionType = SectionType> {
  id?: string;
  sectionType: T;
  props: SectionPropsMap[T];
  sortOrder: number;
  isVisible: boolean;
}

// ── Page / Site Schema ──────────────────────────────────────────────

export interface PageSchema {
  id?: string;
  title: string;
  slug: string;
  sortOrder?: number;
  meta?: { title?: string; description?: string };
  sections: SectionDescriptor[];
}

export interface SiteSchema {
  id?: string;
  name: string;
  slug?: string;
  theme: BuilderTheme;
  meta?: { title?: string; description?: string; favicon?: string };
  pages: PageSchema[];
}

// ── Viewport ────────────────────────────────────────────────────────

export type Viewport = "desktop" | "tablet" | "mobile";

export const VIEWPORT_WIDTHS: Record<Viewport, number> = {
  desktop: 1280,
  tablet: 768,
  mobile: 375,
};
