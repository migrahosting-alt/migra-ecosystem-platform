/**
 * Project Registry Verifier
 * 
 * Validates the MigraPilot project registry data
 */

import projectRegistry from "../../lib/pilot/project-registry";

// Validation functions
function validateRegistry(): void {
  console.log("Validating project registry...");
  
  // Check minimum projects
  if (projectRegistry.projects.length < 8) {
    throw new Error(`Registry must have at least 8 projects, found ${projectRegistry.projects.length}`);
  }
  
  // Validate each project
  for (const project of projectRegistry.projects) {
    // Check required fields
    if (!project.key) throw new Error(`Project ${project.name} missing key`);
    if (!project.name) throw new Error(`Project with key ${project.key} missing name`);
    if (!project.type) throw new Error(`Project ${project.key} missing type`);
    if (!project.description) throw new Error(`Project ${project.key} missing description`);
    
    // Check safe commands or read-only flag
    if (!project.safeReadOnlyOnly && (!project.safeCommands || project.safeCommands.length === 0)) {
      throw new Error(`Project ${project.key} must have safe commands or safeReadOnlyOnly=true`);
    }
    
    // Check forbidden commands
    if (!project.forbiddenCommands) {
      throw new Error(`Project ${project.key} missing forbiddenCommands`);
    }
    
    // Check hazards
    if (!project.hazards || project.hazards.length === 0) {
      throw new Error(`Project ${project.key} must have at least one hazard`);
    }
    
    // Check destructive commands
    const destructiveWords = [
      "rm -rf", "systemctl restart", "pm2 restart", 
      "prisma migrate deploy", "deploy", "ssh", "scp", "rsync"
    ];
    
    for (const cmd of project.safeCommands || []) {
      for (const word of destructiveWords) {
        if (cmd.includes(word)) {
          throw new Error(`Project ${project.key} contains destructive command: ${word}`);
        }
      }
    }
    
    // Check public endpoints
    if (project.services) {
      for (const service of project.services) {
        if (service.name === "migrapilot.service" && service.port === 3399) {
          console.warn("Warning: migrapilot.service exposed on port 3399");
        }
      }
    }
    
    // Check for pilot.migrateck.com references
    const migrateckRefs = [
      "pilot.migrateck.com", 
      "/api/pilot/chat"
    ];
    
    for (const ref of migrateckRefs) {
      if (project.name.toLowerCase().includes(ref) || 
          project.description.toLowerCase().includes(ref)) {
        throw new Error(`Project ${project.key} references pilot.migrateck.com`);
      }
    }
  }
  
  // Check verification gates
  for (const project of projectRegistry.projects) {
    for (const gate of project.verificationGates) {
      if (!gate.checkId) {
        throw new Error(`Verification gate ${gate.name} in project ${project.key} missing checkId`);
      }
      if (typeof gate.checkId === "function") {
        throw new Error(`Verification gate ${gate.name} in project ${project.key} has function-valued checkId`);
      }
    }
  }
  
  console.log("Registry validation passed!");
}

// Run validation
try {
  validateRegistry();
  console.log("✅ All validations passed");
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error("❌ Validation failed:", message);
  process.exit(1);
}
