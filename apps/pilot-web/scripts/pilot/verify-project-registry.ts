/**
 * Project Registry Verifier
 * 
 * Validates the MigraPilot Project Registry
 */

import fs from "fs";

// Helper function for consistent error handling
function handleError(error: unknown, message: string): never {
  const errorMessage = error instanceof Error ? error.message : String(error);
  throw new Error(`${message}: ${errorMessage}`);
}

try {
  // Validate API route exists
  const apiRouteExists = fs.existsSync("./app/api/pilot/projects/route.ts");
  if (!apiRouteExists) {
    handleError(new Error("API route does not exist"), "Failed to find app/api/pilot/projects/route.ts");
  }

  // Validate UI page exists
  const uiPageExists = fs.existsSync("./app/pilot/projects/page.tsx");
  if (!uiPageExists) {
    handleError(new Error("UI page does not exist"), "Failed to find app/pilot/projects/page.tsx");
  }

  console.log("✓ API route and UI page exist");

  // Read the API route content
  const apiRouteContent = fs.readFileSync("./app/api/pilot/projects/route.ts", "utf8");
  
  // Validate API route contains required elements
  if (!apiRouteContent.includes('mode: "project_registry_read"')) {
    handleError(new Error("Missing mode"), "API route missing mode: \"project_registry_read\"");
  }
  
  if (!apiRouteContent.includes('readOnly: true')) {
    handleError(new Error("Missing readOnly"), "API route missing readOnly: true");
  }

  if (!apiRouteContent.includes('toolsExecuted: false')) {
    handleError(new Error("Missing toolsExecuted"), "API route missing toolsExecuted: false");
  }

  if (!apiRouteContent.includes('executor: "absent"')) {
    handleError(new Error("Missing executor"), "API route missing executor: \"absent\"");
  }

  // Validate API route uses proper Next.js syntax
  if (!apiRouteContent.includes("export async function GET")) {
    handleError(new Error("Missing GET function"), "API route must export async function GET");
  }

  if (!apiRouteContent.includes('import projectRegistry from "../../../../lib/pilot/project-registry"')) {
    handleError(new Error("Missing proper import"), "API route must import registry with correct path");
  }

  console.log("✓ API route validation passed");

  // Read the UI page content
  const uiPageContent = fs.readFileSync("./app/pilot/projects/page.tsx", "utf8");
  
  // Validate UI page contains required elements
  if (!uiPageContent.includes('Pilot Project Registry')) {
    handleError(new Error("Missing title"), "UI page missing title");
  }

  if (!uiPageContent.includes('import projectRegistry from "../../../lib/pilot/project-registry"')) {
    handleError(new Error("Missing proper import"), "UI page must import registry with correct path");
  }

  console.log("✓ UI page validation passed");

  // Validate the actual project registry file exists and is valid
  const registryExists = fs.existsSync("./lib/pilot/project-registry.ts");
  if (!registryExists) {
    handleError(new Error("Registry file does not exist"), "Failed to find lib/pilot/project-registry.ts");
  }

  console.log("✓ Registry file validation passed");

  // Run final validation
  console.log("✓ All Phase 13.1 requirements satisfied");
  
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error("Validation failed:", message);
  process.exit(1);
}
