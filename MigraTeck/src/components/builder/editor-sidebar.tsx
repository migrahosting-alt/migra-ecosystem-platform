"use client";

import { useEditor, useEditorDispatch, useSelectedPage } from "@/components/builder/editor-state";
import { SECTION_TYPES, type SectionType } from "@/lib/builder/types";
import { useState } from "react";

const SECTION_LABELS: Record<SectionType, string> = {
  navbar: "Navigation Bar",
  hero: "Hero Banner",
  about: "About",
  services: "Services",
  features: "Features",
  testimonials: "Testimonials",
  faq: "FAQ",
  cta: "Call to Action",
  contactForm: "Contact Form",
  gallery: "Gallery",
  pricing: "Pricing",
  footer: "Footer",
};

export function EditorSidebar() {
  const { site, selectedPageId, selectedSectionId } = useEditor();
  const dispatch = useEditorDispatch();
  const selectedPage = useSelectedPage();
  const [addingSection, setAddingSection] = useState(false);

  if (!site) return null;

  async function handleAddSection(sectionType: SectionType) {
    if (!selectedPageId) return;
    setAddingSection(true);

    try {
      const res = await fetch(`/api/builder/pages/${selectedPageId}/sections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectionType, propsJson: getDefaultProps(sectionType) }),
      });
      const data = await res.json();
      if (res.ok) {
        dispatch({ type: "ADD_SECTION", pageId: selectedPageId, section: data.section });
      }
    } catch {
      // silent fail
    } finally {
      setAddingSection(false);
    }
  }

  async function handleDeleteSection(sectionId: string) {
    try {
      const res = await fetch(`/api/builder/sections/${sectionId}`, { method: "DELETE" });
      if (res.ok) {
        dispatch({ type: "REMOVE_SECTION", sectionId });
      }
    } catch {
      // silent fail
    }
  }

  return (
    <aside className="w-64 border-r border-[var(--line)] bg-[var(--surface-3)] overflow-y-auto flex-shrink-0">
      {/* Pages */}
      <div className="p-3 border-b border-[var(--line)]">
        <h3 className="text-xs font-semibold text-[var(--ink-muted)] uppercase tracking-wide mb-2">Pages</h3>
        <div className="space-y-1">
          {site.pages.map((page) => (
            <button
              key={page.id}
              onClick={() => dispatch({ type: "SELECT_PAGE", pageId: page.id })}
              className={`w-full text-left px-3 py-1.5 text-sm rounded-md transition-colors ${
                page.id === selectedPageId
                  ? "bg-[var(--brand-50)] text-[var(--brand-700)] font-medium"
                  : "text-[var(--ink)] hover:bg-[var(--surface)]"
              }`}
            >
              {page.title}
            </button>
          ))}
        </div>
      </div>

      {/* Sections for selected page */}
      {selectedPage && (
        <div className="p-3">
          <h3 className="text-xs font-semibold text-[var(--ink-muted)] uppercase tracking-wide mb-2">
            Sections
          </h3>
          <div className="space-y-1">
            {selectedPage.sections
              .sort((a, b) => a.sortOrder - b.sortOrder)
              .map((section) => (
                <div
                  key={section.id}
                  className={`group flex items-center justify-between px-3 py-1.5 rounded-md transition-colors cursor-pointer ${
                    section.id === selectedSectionId
                      ? "bg-[var(--brand-50)] text-[var(--brand-700)]"
                      : "text-[var(--ink)] hover:bg-[var(--surface)]"
                  } ${!section.isVisible ? "opacity-40" : ""}`}
                  onClick={() => dispatch({ type: "SELECT_SECTION", sectionId: section.id })}
                >
                  <span className="text-sm truncate">
                    {SECTION_LABELS[section.sectionType as SectionType] ?? section.sectionType}
                  </span>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        dispatch({ type: "TOGGLE_SECTION_VISIBILITY", sectionId: section.id });
                      }}
                      className="text-xs text-[var(--ink-muted)] hover:text-[var(--ink)]"
                      title={section.isVisible ? "Hide" : "Show"}
                    >
                      {section.isVisible ? "👁" : "👁‍🗨"}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteSection(section.id);
                      }}
                      className="text-xs text-red-400 hover:text-red-600"
                      title="Delete section"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
          </div>

          {/* Add section dropdown */}
          <div className="mt-3">
            <select
              disabled={addingSection}
              onChange={(e) => {
                if (e.target.value) {
                  handleAddSection(e.target.value as SectionType);
                  e.target.value = "";
                }
              }}
              className="w-full rounded-lg border border-dashed border-[var(--line)] bg-transparent px-3 py-1.5 text-sm text-[var(--ink-muted)] hover:border-[var(--brand-500)] transition-colors cursor-pointer"
              defaultValue=""
            >
              <option value="" disabled>
                + Add section…
              </option>
              {SECTION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {SECTION_LABELS[type]}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
    </aside>
  );
}

/** Default empty props for each section type so the API validation passes. */
function getDefaultProps(type: SectionType): Record<string, unknown> {
  switch (type) {
    case "navbar":
      return { logo: { type: "text", text: "My Site" }, links: [], cta: { label: "Contact", href: "#contact" } };
    case "hero":
      return { headline: "Your Headline Here", subheadline: "A brief description.", cta: { label: "Learn More", href: "#" }, alignment: "center" };
    case "about":
      return { heading: "About Us", body: "Tell your story here." };
    case "services":
      return { heading: "Our Services", items: [{ icon: "⭐", title: "Service", description: "Description." }] };
    case "features":
      return { heading: "Features", items: [{ icon: "✓", title: "Feature", description: "Description." }] };
    case "testimonials":
      return { heading: "Testimonials", items: [{ quote: "Great service!", author: "Customer", rating: 5 }] };
    case "faq":
      return { heading: "FAQ", items: [{ question: "Question?", answer: "Answer." }] };
    case "cta":
      return { heading: "Ready to Get Started?", buttonLabel: "Contact Us", buttonHref: "#contact" };
    case "contactForm":
      return { heading: "Contact Us", fields: [{ name: "name", label: "Name", type: "text", required: true }, { name: "email", label: "Email", type: "email", required: true }, { name: "message", label: "Message", type: "textarea", required: true }], submitLabel: "Send", successMessage: "Thank you!" };
    case "gallery":
      return { heading: "Gallery", images: [] };
    case "pricing":
      return { heading: "Pricing", plans: [{ name: "Basic", price: "$49/mo", features: ["Feature 1"], cta: { label: "Choose", href: "#" } }] };
    case "footer":
      return { companyName: "My Company", links: [], socialLinks: [] };
    default:
      return {};
  }
}
