import { randomUUID } from "node:crypto";

import { stubLlmPlannerAdapter, pilotLlmPlannerAdapter, type LlmPlannerAdapter } from "./planner-llm-adapter";
import { validateTaskGraph } from "./schemas";
import type {
  MissionLane,
  MissionTask,
  MissionTaskGraph,
  PlannerInput,
  PlannerResult
} from "./types";

function createTask(input: {
  lane: MissionLane;
  title: string;
  intent: string;
  deps?: string[];
  toolCalls: MissionTask["toolCalls"];
  nonCritical?: boolean;
}): MissionTask {
  return {
    taskId: `task_${randomUUID()}`,
    lane: input.lane,
    title: input.title,
    intent: input.intent,
    deps: input.deps ?? [],
    toolCalls: input.toolCalls,
    status: "pending",
    retries: 0,
    maxRetries: 1,
    nonCritical: input.nonCritical,
    outputsRefs: []
  };
}

function hasKeyword(goal: string, keywords: string[]): boolean {
  const lower = goal.toLowerCase();
  return keywords.some((keyword) => lower.includes(keyword));
}

function buildRuleTaskGraph(input: PlannerInput): PlannerResult {
  const notes: string[] = [];
  const tasks: MissionTask[] = [];
  const lower = input.goal.toLowerCase();

  if (hasKeyword(lower, ["fix", "bug", "overflow", "ui"])) {
    notes.push("Rule planner selected bug-fix workflow.");

    const search = createTask({
      lane: "code",
      title: "Search repository",
      intent: "Locate relevant files and symbols",
      toolCalls: [
        {
          toolName: "repo.search",
          input: {
            query: lower.includes("overflow") ? "overflow" : "TODO",
            maxResults: 50
          },
          runnerTarget: "local",
          environment: "dev"
        }
      ]
    });

    const read = createTask({
      lane: "code",
      title: "Read likely file",
      intent: "Gather concrete context for patch",
      deps: [search.taskId],
      toolCalls: [
        {
          toolName: "repo.readFile",
          input: {
            path: input.context?.focusFile ?? "packages/tooling/schemas/base.tool-result.json",
            maxBytes: 65536
          },
          runnerTarget: "local",
          environment: "dev"
        }
      ]
    });

    const planPatch = createTask({
      lane: "code",
      title: "Plan patch",
      intent: "Prepare patch plan and baseline diff",
      deps: [read.taskId],
      toolCalls: [
        {
          toolName: "repo.diff",
          input: {
            staged: false,
            maxBytes: 262144
          },
          runnerTarget: "local",
          environment: "dev"
        }
      ]
    });

    const applyPatch = createTask({
      lane: "code",
      title: "Apply patch",
      intent: "Apply planned code changes",
      deps: [planPatch.taskId],
      toolCalls: [
        {
          toolName: "repo.applyPatch",
          input: {
            patch: input.context?.patch ?? "",
            idempotencyKey: `mission-${Date.now()}-patch`
          },
          runnerTarget: "local",
          environment: "dev"
        }
      ],
      nonCritical: true
    });

    const qa = createTask({
      lane: "qa",
      title: "Run verification",
      intent: "Run build or test after patch",
      deps: [applyPatch.taskId],
      toolCalls: [
        {
          toolName: "repo.run",
          input: {
            cmd: "npm",
            args: ["run", "build"],
            timeoutSec: 180
          },
          runnerTarget: "local",
          environment: "dev"
        }
      ]
    });

    const commit = createTask({
      lane: "code",
      title: "Create commit",
      intent: "Produce PR-ready commit",
      deps: [qa.taskId],
      toolCalls: [
        {
          toolName: "git.commit",
          input: {
            message: `mission: ${input.goal.slice(0, 80)}`,
            files: [input.context?.focusFile ?? "packages/tooling/schemas/base.tool-result.json"]
          },
          runnerTarget: "local",
          environment: "dev",
          nonCritical: true
        }
      ],
      nonCritical: true
    });

    const docs = createTask({
      lane: "docs",
      title: "Document mission note",
      intent: "Write journal note for mission progress",
      deps: [qa.taskId],
      toolCalls: [
        {
          toolName: "journal.append",
          input: {
            entry: {
              runId: `mission_note_${Date.now()}`,
              tool: "mission.orchestrator",
              tier: 1,
              action: "note",
              summary: `Mission note: ${input.goal}`,
              tags: ["mission", "docs"]
            }
          },
          runnerTarget: "local",
          environment: input.environment
        }
      ],
      nonCritical: true
    });

    tasks.push(search, read, planPatch, applyPatch, qa, commit, docs);
  } else if (hasKeyword(lower, ["deploy", "staging", "prod"])) {
    notes.push("Rule planner selected deploy workflow.");

    const topology = createTask({
      lane: "ops",
      title: "Inspect topology",
      intent: "Understand service dependencies before deploy",
      toolCalls: [
        {
          toolName: "inventory.services.topology",
          input: { filter: { classification: "internal" } },
          runnerTarget: "server",
          environment: input.environment
        }
      ]
    });

    const deployPreview = createTask({
      lane: "ops",
      title: "Deploy preview",
      intent: "Preview deploy action",
      deps: [topology.taskId],
      toolCalls: [
        {
          toolName: "deploy.preview",
          input: {
            goal: input.goal
          },
          runnerTarget: "server",
          environment: input.environment
        }
      ],
      nonCritical: true
    });

    const docs = createTask({
      lane: "docs",
      title: "Manual deploy instruction",
      intent: "If deploy.preview missing, halt with instructions",
      deps: [deployPreview.taskId],
      toolCalls: [
        {
          toolName: "journal.append",
          input: {
            entry: {
              runId: `mission_note_${Date.now()}`,
              tool: "mission.orchestrator",
              tier: 1,
              action: "note",
              summary: "deploy.preview unavailable, stop and run manual deploy checklist",
              tags: ["mission", "deploy", "manual"]
            }
          },
          runnerTarget: "local",
          environment: input.environment
        }
      ],
      nonCritical: true
    });

    tasks.push(topology, deployPreview, docs);
  } else if (hasKeyword(lower, ["dns", "pods", "storage"])) {
    notes.push("Rule planner selected ops safety workflow.");

    const contextTask = createTask({
      lane: "ops",
      title: "Collect system context",
      intent: "Prepare server scoped context",
      toolCalls: [
        {
          toolName: "system.context",
          input: {
            environment: input.environment
          },
          runnerTarget: "server",
          environment: input.environment
        }
      ]
    });

    const topology = createTask({
      lane: "ops",
      title: "Inspect topology and classification",
      intent: "Ensure internal/client boundaries before ops",
      deps: [contextTask.taskId],
      toolCalls: [
        {
          toolName: "inventory.services.topology",
          input: {
            filter: {
              classification: "internal"
            }
          },
          runnerTarget: "server",
          environment: input.environment
        }
      ]
    });

    tasks.push(contextTask, topology);
  } else {
    notes.push("Rule planner selected default exploratory workflow.");

    const status = createTask({
      lane: "code",
      title: "Check repo status",
      intent: "Baseline repository state",
      toolCalls: [
        {
          toolName: "repo.status",
          input: {},
          runnerTarget: "local",
          environment: "dev"
        }
      ]
    });

    const inventory = createTask({
      lane: "ops",
      title: "Inspect inventory",
      intent: "Read inventory summary",
      toolCalls: [
        {
          toolName: "inventory.tenants.list",
          input: { filter: { limit: 25, offset: 0 } },
          runnerTarget: "server",
          environment: input.environment
        }
      ],
      nonCritical: true
    });

    tasks.push(status, inventory);
  }

  const laneOrder: MissionLane[] = ["code", "qa", "ops", "docs"];
  const lanes = laneOrder.filter((lane) => tasks.some((task) => task.lane === lane));
  const taskGraph: MissionTaskGraph = {
    lanes,
    tasks
  };

  if (!validateTaskGraph(taskGraph)) {
    throw new Error("Planner generated invalid task graph");
  }

  return {
    planner: "rule",
    taskGraph,
    notes
  };
}

async function llmPlanner(input: PlannerInput): Promise<PlannerResult | null> {
  const adapterKey = process.env.MIGRAPILOT_LLM_PLANNER_MODULE ?? "pilot";
  const adapterRegistry: Record<string, LlmPlannerAdapter> = {
    stub: stubLlmPlannerAdapter,
    pilot: pilotLlmPlannerAdapter,
  };
  const adapter = adapterRegistry[adapterKey];
  if (!adapter) {
    return null;
  }

  try {
    const planned = await adapter(input);
    if (!planned) {
      return null;
    }
    if (!validateTaskGraph(planned.taskGraph)) {
      throw new Error("LLM planner returned invalid task graph");
    }
    return {
      planner: "llm",
      taskGraph: planned.taskGraph,
      notes: planned.notes ?? ["LLM planner executed"]
    };
  } catch {
    return null;
  }
}

export async function planMission(input: PlannerInput): Promise<PlannerResult> {
  if (process.env.MIGRAPILOT_PLANNER_MODE === "llm") {
    const llm = await llmPlanner(input);
    if (llm) {
      return llm;
    }
  }
  return buildRuleTaskGraph(input);
}
