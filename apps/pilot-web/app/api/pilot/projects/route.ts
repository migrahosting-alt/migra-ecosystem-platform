import { NextRequest, NextResponse } from "next/server";
import projectRegistry from "../../../../lib/pilot/project-registry";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get("key");

  if (key) {
    const project = projectRegistry.projects.find(p => p.key === key);
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    return NextResponse.json({
      mode: "project_registry_read",
      readOnly: true,
      toolsExecuted: false,
      executor: "absent",
      count: 1,
      projects: [project]
    });
  }

  return NextResponse.json({
    mode: "project_registry_read",
    readOnly: true,
    toolsExecuted: false,
    executor: "absent",
    count: projectRegistry.projects.length,
    projects: projectRegistry.projects
  });
}
