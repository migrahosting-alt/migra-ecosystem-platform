export const authServiceScaffold = {
  name: "MigraTeck Identity Service",
  status: "scaffolded",
  hashingStrategy: "argon2id-planned",
  sessionIsolation: [
    "organization-aware session boundaries",
    "separate signing keys per environment",
    "step-up verification for privileged actions",
  ],
  futureModules: ["accounts", "sessions", "organizations", "policies"],
} as const;
