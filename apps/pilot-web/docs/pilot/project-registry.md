# Pilot Project Registry

This document describes the structure and usage of the pilot project registry.

## Phase 13.1 - Read-only Project Registry Access

### API Endpoint
- **Path**: `/api/pilot/projects`
- **Method**: `GET`
- **Response Format**: JSON

### Response Structure
```json
{
  "mode": "project_registry_read",
  "readOnly": true,
  "toolsExecuted": false,
  "executor": "absent",
  "count": 2,
  "projects": [
    {
      "key": "pilot-web",
      "name": "Pilot Web Application",
      "type": "web-application",
      "description": "Main web application for the MigraPilot system",
      "services": [
        {
          "name": "frontend",
          "status": "running"
        }
      ],
      "hazards": [
        {
          "description": "Potential security vulnerability in authentication flow"
        }
      ],
      "safeCommands": [
        "npm install",
        "npm run build",
        "npm test"
      ],
      "forbiddenCommands": [
        "rm -rf /",
        "sudo apt-get remove",
        "systemctl restart"
      ],
      "verificationGates": [
        {
          "name": "security-check",
          "description": "Security vulnerability scan"
        },
        {
          "name": "code-review",
          "description": "Code review by senior developers"
        }
      ]
    }
  ]
}
```

### Query Parameters
- `key` (optional): Filter projects by specific key

### Security
This endpoint provides read-only access to project information and does not execute any commands or modify system state.

### Implementation Details
The API route is implemented in `app/api/pilot/projects/route.ts` and the UI page is located at `app/pilot/projects/page.tsx`.
