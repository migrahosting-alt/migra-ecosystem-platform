/**
 * MigraPilot Project Registry
 * 
 * This file contains structured knowledge about MigraTeck projects
 * for MigraPilot reasoning capabilities.
 */

export interface ProjectRegistry {
  projects: Project[];
}

export interface Project {
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

export interface Service {
  name: string;
  port: number;
  protocol: "http" | "https" | "tcp" | "udp" | "sip" | "webrtc";
  description: string;
}

export interface Hazard {
  name: string;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  mitigation: string;
}

export interface VerificationGate {
  name: string;
  description: string;
  checkId: string;
  required: boolean;
}

const projectRegistry: ProjectRegistry = {
  projects: [
    {
      key: "migrapilot",
      name: "MigraPilot",
      type: "web",
      description: "Main MigraPilot web application for the MigraTeck ecosystem",
      localPath: "apps/pilot-web",
      runtime: "Next.js 15",
      devPort: 3399,
      services: [
        {
          name: "migrapilot.service",
          port: 3399,
          protocol: "http",
          description: "Main MigraPilot web application service"
        }
      ],
      hazards: [
        {
          name: "security-bypass",
          severity: "critical",
          description: "Attempt to bypass safety mechanisms",
          mitigation: "All requests must go through safe-read envelope"
        },
        {
          name: "data-exfiltration",
          severity: "high",
          description: "Unauthorized data access or transfer",
          mitigation: "Strict access controls and audit logging"
        }
      ],
      safeCommands: [
        "npm run build",
        "npm run pilot:ci",
        "npx --yes tsx scripts/pilot/verify-assistant.ts",
        "npx --yes tsx scripts/pilot/verify-project-registry.ts"
      ],
      forbiddenCommands: [
        "exec()",
        "shell commands",
        "mutation",
        "executor",
        "deploy",
        "restart",
        "production write",
        "direct database access"
      ],
      verificationGates: [
        {
          name: "safe-read-envelope",
          description: "Ensure all requests go through safe-read mechanism",
          checkId: "safe-read-envelope",
          required: true
        },
        {
          name: "no-production-actions",
          description: "Ensure no production write actions are attempted",  
          checkId: "no-production-actions",
          required: true
        }
      ]
    },
    {
      key: "annoupale",
      name: "AnnouPale / Pale",
      type: "web",
      description: "Announcement and notification system for MigraTeck",
      localPath: "apps/annoupale",
      hazards: [
        {
          name: "notification-spoofing",
          severity: "medium",
          description: "Unauthorized notification delivery",
          mitigation: "Strict authentication and authorization"
        }
      ],
      safeCommands: [
        "npm run build",
        "npm run test"
      ],
      safeReadOnlyOnly: true,
      forbiddenCommands: [
        "deploy",
        "production write",
        "direct database access"
      ],
      verificationGates: [
        {
          name: "auth-validation",
          description: "Ensure proper authentication validation",
          checkId: "auth-validation",
          required: true
        }
      ],
      needsVerification: true
    },
    {
      key: "migrapanel",
      name: "MigraPanel",
      type: "web",
      description: "Admin control panel for MigraTeck ecosystem",
      localPath: "apps/migrapanel",
      hazards: [
        {
          name: "privilege-escalation",
          severity: "high",
          description: "Unauthorized access to admin functions",
          mitigation: "Role-based access controls and audit logging"
        }
      ],
      safeCommands: [
        "npm run build",
        "npm run test"
      ],
      safeReadOnlyOnly: true,
      forbiddenCommands: [
        "deploy",
        "production write",
        "direct database access"
      ],
      verificationGates: [
        {
          name: "access-controls",
          description: "Ensure proper access controls are in place",
          checkId: "access-controls",
          required: true
        }
      ],
      needsVerification: true
    },
    {
      key: "migracredit",
      name: "MigraCredit",
      type: "api",
      description: "Credit and financial services for MigraTeck ecosystem",
      localPath: "apps/migracredit",
      hazards: [
        {
          name: "financial-data-leak",
          severity: "critical",
          description: "Unauthorized access to financial data",
          mitigation: "End-to-end encryption and strict access controls"
        }
      ],
      safeCommands: [
        "npm run build",
        "npm run test"
      ],
      safeReadOnlyOnly: true,
      forbiddenCommands: [
        "deploy",
        "production write",
        "direct database access",
        "rm -rf",
        "systemctl restart",
        "pm2 restart",
        "prisma migrate deploy"
      ],
      verificationGates: [
        {
          name: "financial-security",
          description: "Ensure financial data security measures",
          checkId: "financial-security",
          required: true
        }
      ],
      needsVerification: true
    },
    {
      key: "migracms",
      name: "MigraCMS",
      type: "cms",
      description: "Content management system for MigraTeck",
      localPath: "apps/migracms",
      hazards: [
        {
          name: "content-injection",
          severity: "high",
          description: "Unauthorized content modification",
          mitigation: "Input sanitization and access controls"
        }
      ],
      safeCommands: [
        "npm run build",
        "npm run test"
      ],
      safeReadOnlyOnly: true,
      forbiddenCommands: [
        "deploy",
        "production write",
        "direct database access"
      ],
      verificationGates: [
        {
          name: "content-security",
          description: "Ensure content modification security",
          checkId: "content-security",
          required: true
        }
      ],
      needsVerification: true
    },
    {
      key: "migravoice",
      name: "MigraVoice",
      type: "service",
      description: "Voice communication service for MigraTeck",
      localPath: "apps/migravoice",
      hazards: [
        {
          name: "audio-interception",
          severity: "high",
          description: "Unauthorized audio capture or monitoring",
          mitigation: "End-to-end encryption and secure protocols"
        }
      ],
      safeCommands: [
        "npm run build",
        "npm run test"
      ],
      safeReadOnlyOnly: true,
      forbiddenCommands: [
        "deploy",
        "production write",
        "direct database access"
      ],
      verificationGates: [
        {
          name: "audio-security",
          description: "Ensure audio data security measures",
          checkId: "audio-security",
          required: true
        }
      ],
      needsVerification: true
    },
    {
      key: "migramail",
      name: "MigraMail",
      type: "service",
      description: "Email communication service for MigraTeck",
      localPath: "apps/migramail",
      hazards: [
        {
          name: "email-spoofing",
          severity: "medium",
          description: "Unauthorized email sending or modification",
          mitigation: "Sender authentication and message encryption"
        }
      ],
      safeCommands: [
        "npm run build",
        "npm run test"
      ],
      safeReadOnlyOnly: true,
      forbiddenCommands: [
        "deploy",
        "production write",
        "direct database access"
      ],
      verificationGates: [
        {
          name: "email-security",
          description: "Ensure email data security measures",
          checkId: "email-security",
          required: true
        }
      ],
      needsVerification: true
    },
    {
      key: "migradrive",
      name: "MigraDrive",
      type: "service",
      description: "Cloud storage and file sharing service for MigraTeck",
      localPath: "apps/migradrive",
      hazards: [
        {
          name: "file-access-leak",
          severity: "high",
          description: "Unauthorized access to stored files",
          mitigation: "Access controls and encryption at rest"
        }
      ],
      safeCommands: [
        "npm run build",
        "npm run test"
      ],
      safeReadOnlyOnly: true,
      forbiddenCommands: [
        "deploy",
        "production write",
        "direct database access"
      ],
      verificationGates: [
        {
          name: "file-security",
          description: "Ensure file data security measures",
          checkId: "file-security",
          required: true
        }
      ],
      needsVerification: true
    },
    {
      key: "migrahosting",
      name: "MigraHosting Marketing / Client Portal",
      type: "web",
      description: "Marketing and client portal for MigraHosting services",
      localPath: "apps/migrahosting",
      hazards: [
        {
          name: "client-data-leak",
          severity: "high",
          description: "Unauthorized access to client information",
          mitigation: "Strict privacy controls and data protection"
        }
      ],
      safeCommands: [
        "npm run build",
        "npm run test"
      ],
      safeReadOnlyOnly: true,
      forbiddenCommands: [
        "deploy",
        "production write",
        "direct database access"
      ],
      verificationGates: [
        {
          name: "privacy-controls",
          description: "Ensure client data privacy controls",
          checkId: "privacy-controls",
          required: true
        }
      ],
      needsVerification: true
    },
    {
      key: "migrateck-console",
      name: "MigraTeck Console",
      type: "web",
      description: "Central console for managing MigraTeck ecosystem",
      localPath: "apps/migrateck-console",
      hazards: [
        {
          name: "console-access",
          severity: "critical",
          description: "Unauthorized access to system console",
          mitigation: "Multi-factor authentication and strict access controls"
        }
      ],
      safeCommands: [
        "npm run build",
        "npm run test"
      ],
      safeReadOnlyOnly: true,
      forbiddenCommands: [
        "deploy",
        "production write",
        "direct database access"
      ],
      verificationGates: [
        {
          name: "console-security",
          description: "Ensure console access security measures",
          checkId: "console-security",
          required: true
        }
      ],
      needsVerification: true
    }
  ]
};

export default projectRegistry;
