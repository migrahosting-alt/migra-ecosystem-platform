import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { LegalDocumentPage } from "@/components/legal/LegalDocumentPage";
import {
  canonicalLegalDocuments,
  getLegalDocument,
  legalAliases,
  resolveLegalSlug,
} from "@/content/legal";
import { buildPageMetadata } from "@/lib/metadata";

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

  return <LegalDocumentPage document={document} />;
}
