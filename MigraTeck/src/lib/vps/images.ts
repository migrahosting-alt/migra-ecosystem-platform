import { z } from "zod";
import { env } from "@/lib/env";

export type VpsSupportedImage = {
  slug: string;
  name: string;
  family: string;
  version: string;
  description: string;
  defaultUsername: string;
  providerSlugs?: string[] | undefined;
  highlighted?: boolean | undefined;
};

const imageSchema = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  family: z.string().min(1),
  version: z.string().min(1),
  description: z.string().min(1),
  defaultUsername: z.string().min(1),
  providerSlugs: z.array(z.string().min(1)).optional(),
  highlighted: z.boolean().optional(),
});

const imagesSchema = z.array(imageSchema);

const defaultImages: VpsSupportedImage[] = [
  {
    slug: "debian-13",
    name: "Debian 13",
    family: "Debian",
    version: "13",
    description: "Stable Debian platform for production application workloads and general-purpose VPS use.",
    defaultUsername: "root",
    highlighted: true,
  },
  {
    slug: "debian-12",
    name: "Debian 12",
    family: "Debian",
    version: "12",
    description: "Current Debian stable branch for compatibility-sensitive deployments.",
    defaultUsername: "root",
  },
  {
    slug: "ubuntu-24-04",
    name: "Ubuntu 24.04 LTS",
    family: "Ubuntu",
    version: "24.04",
    description: "Long-term support Ubuntu image for teams standardizing on recent LTS packages.",
    defaultUsername: "root",
  },
  {
    slug: "ubuntu-22-04",
    name: "Ubuntu 22.04 LTS",
    family: "Ubuntu",
    version: "22.04",
    description: "Long-term support Ubuntu image for established workloads with older package constraints.",
    defaultUsername: "root",
  },
  {
    slug: "rocky-9",
    name: "Rocky Linux 9",
    family: "Rocky Linux",
    version: "9",
    description: "Enterprise-style Linux distribution for teams standardizing on RHEL-compatible environments.",
    defaultUsername: "root",
  },
  {
    slug: "almalinux-9",
    name: "AlmaLinux 9",
    family: "AlmaLinux",
    version: "9",
    description: "RHEL-compatible Linux image for business workloads and panel-hosted services.",
    defaultUsername: "root",
  },
  {
    slug: "centos-stream-9",
    name: "CentOS Stream 9",
    family: "CentOS Stream",
    version: "9",
    description: "Rolling preview of the next RHEL minor stream for teams that need earlier package movement.",
    defaultUsername: "root",
  },
];

function loadConfiguredImages(): VpsSupportedImage[] {
  const raw = env.MIGRAHOSTING_VPS_IMAGES_JSON;
  if (!raw) {
    return defaultImages;
  }

  try {
    const parsed = imagesSchema.safeParse(JSON.parse(raw));
    if (parsed.success && parsed.data.length > 0) {
      return parsed.data;
    }
  } catch {
    // Fall back to defaults when custom image config is invalid.
  }

  return defaultImages;
}

const configuredImages = loadConfiguredImages();

export function listSupportedVpsImages(providerSlug?: string): VpsSupportedImage[] {
  if (!providerSlug) {
    return configuredImages;
  }

  return configuredImages.filter((image) => !image.providerSlugs?.length || image.providerSlugs.includes(providerSlug));
}

export function getSupportedVpsImage(slug: string | null | undefined, providerSlug?: string): VpsSupportedImage | undefined {
  if (!slug) {
    return undefined;
  }

  return listSupportedVpsImages(providerSlug).find((image) => image.slug === slug)
    || configuredImages.find((image) => image.slug === slug);
}

export function buildImageMetadataPatch(slug: string | null | undefined, providerSlug?: string) {
  const image = getSupportedVpsImage(slug, providerSlug);
  if (!image) {
    return null;
  }

  return {
    imageSlug: image.slug,
    osName: image.name,
    imageVersion: image.version,
    defaultUsername: image.defaultUsername,
  };
}