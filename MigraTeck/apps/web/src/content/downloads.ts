import { z } from "zod";

const downloadItemSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  productKey: z.string().min(1),
  releaseState: z.string().min(1),
  platform: z.string().min(1),
  verifiedSource: z.boolean(),
  integrityNote: z.string().min(1),
  availability: z.string().min(1),
});

const downloadGroupSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  items: z.array(downloadItemSchema).min(1),
});

export type DownloadItem = z.infer<typeof downloadItemSchema>;
export type DownloadGroup = z.infer<typeof downloadGroupSchema>;

export const downloadGroups: DownloadGroup[] = [
  {
    title: "Applications",
    description:
      "Enterprise application delivery through official MigraTeck-controlled distribution channels.",
    items: [
      {
        name: "MigraPanel Desktop Console",
        description:
          "Operational desktop console planned for secure platform administration and cross-system workflow visibility.",
        productKey: "migrapanel",
        releaseState: "Pending public release channel",
        platform: "macOS / Windows / Linux",
        verifiedSource: true,
        integrityNote: "Checksum and signed manifest are published at release time.",
        availability: "Controlled rollout",
      },
      {
        name: "MigraDrive Sync Agent",
        description:
          "File synchronization client planned for secure storage access and document workflow alignment.",
        productKey: "migradrive",
        releaseState: "Pending public release channel",
        platform: "macOS / Windows",
        verifiedSource: true,
        integrityNote: "Integrity metadata will accompany the official release manifest.",
        availability: "Controlled rollout",
      },
    ],
  },
  {
    title: "Developer tools",
    description:
      "Developer-facing packages and CLI surfaces connected to the broader API and automation model.",
    items: [
      {
        name: "MigraTeck JavaScript SDK",
        description:
          "Typed SDK package for authenticated platform requests, product integrations, and future control plane workflows.",
        productKey: "migrateck",
        releaseState: "Preview package planning",
        platform: "npm distribution",
        verifiedSource: true,
        integrityNote: "Package integrity hashes are published through the package registry at release.",
        availability: "Planned public artifact",
      },
      {
        name: "MigraPilot CLI",
        description:
          "Automation-oriented command interface for orchestration, task execution, and workflow-linked operational tooling.",
        productKey: "migrapilot",
        releaseState: "Preview channel planning",
        platform: "Node.js CLI",
        verifiedSource: true,
        integrityNote: "Release hashes and installation guidance will ship with the official channel.",
        availability: "Planned beta access",
      },
    ],
  },
  {
    title: "Plugins and extensions",
    description:
      "Editor and partner extensions distributed through the same official trust boundary as the rest of the platform.",
    items: [
      {
        name: "VS Code Platform Toolkit",
        description:
          "Editor toolkit planned for schema-aware development, request validation support, and integration workflows.",
        productKey: "migrateck",
        releaseState: "Marketplace preparation",
        platform: "VS Code extension",
        verifiedSource: true,
        integrityNote: "Marketplace package integrity is published at the time of release.",
        availability: "Pending publication",
      },
    ],
  },
  {
    title: "Scripts and software assets",
    description:
      "Controlled scripts and software assets for bootstrap, verification, and deterministic platform setup.",
    items: [
      {
        name: "Provisioning Bootstrap Script",
        description:
          "Bootstrap script for verified environment setup, artifact verification, and controlled release preparation.",
        productKey: "migrahosting",
        releaseState: "Internal release-managed artifact",
        platform: "POSIX shell",
        verifiedSource: true,
        integrityNote: "Published alongside signed manifests when external distribution is enabled.",
        availability: "Managed access",
      },
    ],
  },
].map((group) => downloadGroupSchema.parse(group));
