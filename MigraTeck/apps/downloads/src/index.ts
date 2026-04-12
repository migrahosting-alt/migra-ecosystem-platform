export const downloadServiceScaffold = {
  name: "MigraTeck Download Service",
  status: "scaffolded",
  concerns: [
    "artifact signing",
    "checksum publication",
    "short-lived download authorization",
    "verified source metadata",
  ],
  futureModules: ["artifacts", "channels", "manifests", "download-tokens"],
} as const;
