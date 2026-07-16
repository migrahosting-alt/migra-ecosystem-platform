import type { RouteRequest, RouteResponse } from '@migrapilot/shared-types';

export function decideRoute(input: RouteRequest): RouteResponse {
  const promptLength = input.userPrompt.trim().length;
  const hasDiagnostics = Boolean(input.signals?.hasDiagnostics);
  const hasSelection = Boolean(input.signals?.hasSelection);
  const changedFileCount = input.signals?.changedFileCount ?? 0;

  if (input.feature === 'commit') {
    return {
      taskType: 'cheap_llm',
      modelProfile: 'cheap',
      retrievalMode: 'light',
      toolPlan: ['gitDiff'],
      maxInputTokens: 1200,
      maxOutputTokens: 200,
      allowEscalation: false,
      reason: 'Commit summaries should stay cheap.',
    };
  }

  if (input.feature === 'review' && changedFileCount > 8) {
    return {
      taskType: 'default_llm',
      modelProfile: 'default',
      retrievalMode: 'deep',
      toolPlan: ['gitDiff', 'readFileRange', 'searchWorkspace'],
      maxInputTokens: 7000,
      maxOutputTokens: 1200,
      allowEscalation: true,
      reason: 'Large reviews need broader grounding but should not start on premium.',
    };
  }

  if (hasDiagnostics || input.feature === 'fix') {
    return {
      taskType: 'default_llm',
      modelProfile: 'default',
      retrievalMode: 'standard',
      toolPlan: ['getDiagnostics', 'searchWorkspace', 'readFileRange'],
      maxInputTokens: 6000,
      maxOutputTokens: 900,
      allowEscalation: true,
      reason: 'Diagnostics-driven work benefits from targeted grounded reasoning.',
    };
  }

  if (hasSelection || input.feature === 'explain') {
    return {
      taskType: 'cheap_llm',
      modelProfile: 'cheap',
      retrievalMode: 'light',
      toolPlan: ['readFileRange'],
      maxInputTokens: 3000,
      maxOutputTokens: 700,
      allowEscalation: true,
      reason: 'Selected code explanation starts on a cheap path.',
    };
  }

  if (input.feature === 'test') {
    return {
      taskType: 'default_llm',
      modelProfile: 'default',
      retrievalMode: 'standard',
      toolPlan: ['readFileRange', 'searchWorkspace'],
      maxInputTokens: 5000,
      maxOutputTokens: 1000,
      allowEscalation: true,
      reason: 'Test generation usually needs code context but not premium by default.',
    };
  }

  if (promptLength < 160) {
    return {
      taskType: 'cheap_llm',
      modelProfile: 'cheap',
      retrievalMode: 'light',
      toolPlan: ['searchWorkspace'],
      maxInputTokens: 2500,
      maxOutputTokens: 500,
      allowEscalation: true,
      reason: 'Short requests should start cheap.',
    };
  }

  return {
    taskType: 'default_llm',
    modelProfile: 'default',
    retrievalMode: 'standard',
    toolPlan: ['searchWorkspace', 'readFileRange'],
    maxInputTokens: 5000,
    maxOutputTokens: 900,
    allowEscalation: true,
    reason: 'Default route for general workspace-aware assistance.',
  };
}
