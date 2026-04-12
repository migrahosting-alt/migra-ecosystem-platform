"use client";

import type { ComponentType } from "react";
import type { SectionType, SectionPropsMap } from "@/lib/builder/types";
import { NavbarSection } from "@/components/builder/sections/NavbarSection";
import { HeroSection } from "@/components/builder/sections/HeroSection";
import { ServicesSection } from "@/components/builder/sections/ServicesSection";
import { TestimonialsSection } from "@/components/builder/sections/TestimonialsSection";
import { ContactFormSection } from "@/components/builder/sections/ContactFormSection";
import { FooterSection } from "@/components/builder/sections/FooterSection";

// ── Section Registry ────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sectionRegistry: Partial<Record<SectionType, ComponentType<any>>> = {
  navbar: NavbarSection,
  hero: HeroSection,
  services: ServicesSection,
  testimonials: TestimonialsSection,
  contactForm: ContactFormSection,
  footer: FooterSection,
};

// ── Render Section ──────────────────────────────────────────────────

export function RenderSection({
  sectionType,
  props,
  siteSlug,
  sectionId,
}: {
  sectionType: string;
  props: Record<string, unknown>;
  siteSlug?: string | undefined;
  sectionId?: string | undefined;
}) {
  const Component = sectionRegistry[sectionType as SectionType];
  if (!Component) {
    return (
      <div className="flex items-center justify-center bg-gray-100 p-8 text-sm text-gray-500 border border-dashed border-gray-300 rounded-lg">
        Unknown section type: <code className="ml-1 font-mono">{sectionType}</code>
      </div>
    );
  }
  return <Component props={props} siteSlug={siteSlug} sectionId={sectionId} />;
}

// ── Render Page ─────────────────────────────────────────────────────

interface RenderableSection {
  id?: string | undefined;
  sectionType: string;
  propsJson: Record<string, unknown>;
  sortOrder: number;
  isVisible: boolean;
}

export function RenderPage({ sections, siteSlug }: { sections: RenderableSection[]; siteSlug?: string | undefined }) {
  const visible = sections.filter((s) => s.isVisible).sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div>
      {visible.map((section, idx) => (
        <RenderSection
          key={section.id ?? idx}
          sectionType={section.sectionType}
          props={section.propsJson}
          siteSlug={siteSlug}
          sectionId={section.id}
        />
      ))}
    </div>
  );
}
