# MigraPilot Project Registry

## Overview

The MigraPilot Project Registry contains structured knowledge about MigraTeck projects to enable MigraPilot to reason about:
- Repositories and deployment paths
- Services and ports
- Security hazards and mitigation strategies
- Safe and forbidden commands
- Verification gates for project integrity

## Structure

### Project Registry Format

```typescript
interface ProjectRegistry {
  projects: Project[];
}

interface Project {
  key: string;
  name: string;
  type: "web" | "api" | "service" | "library" | "mobile" | "infra" | "cms";
  description: string;
  repository?: string;
  localPath: string;
  runtime?: string;
  devPort?: number;
  services?: Service[];
  hazards: Hazard[];
  safeCommands: string[];
  safeReadOnlyOnly?: boolean;
  forbiddenCommands: string[];
  verificationGates: VerificationGate[];
  needsVerification?: boolean;
}

interface Service {
  name: string;
  port: number;
  protocol: "http" | "https" | "tcp" | "udp" | "sip" | "webrtc";
  description: string;
}

interface Hazard {
  name: string;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  mitigation: string;
}

interface VerificationGate {
  name: string;
  description: string;
  checkId: string;
  required: boolean;
}
```

## Projects

The registry contains data for the following MigraTeck projects:

1. **MigraPilot** - Main MigraPilot web application
2. **AnnouPale / Pale** - Announcement and notification system
3. **MigraPanel** - Admin control panel
4. **MigraCredit** - Credit and financial services
5. **MigraCMS** - Content management system
6. **MigraVoice** - Voice communication service
7. **MigraMail** - Email communication service
8. **MigraDrive** - Cloud storage and file sharing
9. **MigraHosting Marketing / Client Portal** - Marketing and client portal
10. **MigraTeck Console** - Central console for managing ecosystem

For projects where exact details are not certain, the \`needsVerification\` flag is set to true with a warning note: "Verify source-of-truth before acting."

## Validation Rules

The verifier validates:
- Registry has at least 8 projects
- Every project has key, name, type, description
- Every project has at least one safe command or explicit safeReadOnlyOnly=true
- Every project has forbidden commands
- Every project has hazards
- No project safeCommands include destructive words:
  rm -rf
  systemctl restart
  pm2 restart
  prisma migrate deploy
  deploy
  ssh
  scp
  rsync
- No project exposes /api/pilot/chat as a public endpoint
- No project references pilot.migrateck.com as public/exposed
- Every verification gate has a string checkId, not a function
