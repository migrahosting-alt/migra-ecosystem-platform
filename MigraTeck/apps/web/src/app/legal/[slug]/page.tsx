import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { LegalDocumentPage } from "@/components/legal/LegalDocumentPage";
import {
  canonicalLegalDocuments,
  getLegalDocument,
  legalAliases,
  resolveLegalSlug,
} from "@/content/legal";
import { buildPageMetadata, absoluteUrl } from "@/lib/metadata";
import { buildBreadcrumbList, SITE_ROOT } from "@/lib/structured-data";

type Props = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return [
    ...canonicalLegalDocuments.map((document) => ({ slug: document.slug })),
    ...Object.keys(legalAliases).map((slug) => ({ slug })),
  ];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const document = getLegalDocument(slug);

  if (!document) {
    return {};
  }

  return buildPageMetadata({
    title: document.title,
    description: document.description,
    path: `/legal/${resolveLegalSlug(slug)}`,
  });
}

export default async function LegalDocumentRoute({ params }: Props) {
  const { slug } = await params;
  const canonicalSlug = resolveLegalSlug(slug);

  if (canonicalSlug !== slug) {
    redirect(`/legal/${canonicalSlug}`);
  }

  const document = getLegalDocument(slug);

  if (!document) {
    notFound();
  }

  const breadcrumb = buildBreadcrumbList([
    SITE_ROOT,
    { name: "Legal", url: absoluteUrl("/legal") },
    { name: document.title, url: absoluteUrl(`/legal/${canonicalSlug}`) },
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }}
      />
      <LegalDocumentPage document={document} />
    </>
  );
}
