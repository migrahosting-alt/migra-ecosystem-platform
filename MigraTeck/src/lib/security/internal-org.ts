interface InternalOrgShape {
  slug: string;
  type?: string | null;
}

export function isInternalOrg(org: InternalOrgShape): boolean {
  return org.slug.toLowerCase().startsWith("migra") || org.type === "INTERNAL";
}
