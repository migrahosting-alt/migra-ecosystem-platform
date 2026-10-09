import { redirect } from "next/navigation";
import type { ProductKey } from "@/data/products";

const productToSlug: Record<ProductKey, string> = {
  migrateck: "migrateck",
  migrahosting: "migrahosting",
  migraintake: "migraintake",
  migramail: "migramail",
  migramarketing: "migramarketing",
  migrapanel: "migrapanel",
  migrapilot: "migrapilot",
  migravoice: "migravoice",
  migradrive: "migradrive",
  migrainvoice: "migrainvoice",
};

type RequestAccessPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function getFirstQueryValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0]?.trim() ?? "";
  }

  return value?.trim() ?? "";
}

export default async function RequestAccessPage({ searchParams }: RequestAccessPageProps) {
  const params = await searchParams;
  const product = getFirstQueryValue(params.product).toLowerCase();
  const plan = getFirstQueryValue(params.plan);
  const billing = getFirstQueryValue(params.billing);

  if (!product) {
    redirect("/products");
  }

  const productSlug = productToSlug[product as ProductKey];

  if (!productSlug) {
    redirect("/products");
  }

  if (productSlug === "migrahosting" && (plan || billing)) {
    const nextParams = new URLSearchParams();
    if (plan) {
      nextParams.set("plan", plan);
    }
    if (billing) {
      nextParams.set("billing", billing);
    }

    const query = nextParams.toString();
    redirect(query ? `/products/${productSlug}?${query}` : `/products/${productSlug}`);
  }

  redirect(`/products/${productSlug}`);
}
