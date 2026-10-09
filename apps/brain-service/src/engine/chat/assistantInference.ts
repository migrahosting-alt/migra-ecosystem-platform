import type { ProviderAdapter } from '../../providers/providerRegistry.js';
import type { AdmissionGate } from '../admission/index.js';
import { selectModel } from '../models/capabilityRouter.js';
import type { ModelDescriptor, ModelRegistry } from '../models/modelRegistry.js';
import type { AssistantCompletion } from './assistantRoutes.js';

export interface AssistantInferenceDependencies {
  live: boolean;
  registry: ModelRegistry;
  enforceQualification: boolean;
  admissionGate: Pick<AdmissionGate, 'admit'>;
  providerFor: (model: ModelDescriptor) => ProviderAdapter;
}

export function createAssistantGenerator(dependencies: AssistantInferenceDependencies) {
  return async (message: string, signal?: AbortSignal): Promise<AssistantCompletion> => {
    if (!dependencies.live) throw new Error('assistant_live_provider_required');
    const decision = await selectModel(dependencies.registry, {
      tier: 'fast',
      needsTools: false,
      needsVision: false,
      enforce: dependencies.enforceQualification,
    });
    const model = decision?.ranked.find((candidate) => candidate.hosting !== 'remote');
    if (!model) throw new Error('assistant_owned_model_unavailable');
    const admission = await dependencies.admissionGate.admit({ model: model.id });
    if (!admission || admission.state !== 'ready') throw new Error('assistant_capacity_unavailable');
    const provider = dependencies.providerFor(model);
    if (provider.kind !== 'live') throw new Error('assistant_live_provider_required');
    signal?.throwIfAborted();
    const result = await provider.complete({
      feature: 'chat',
      modelProfile: 'default',
      systemPromptId: 'assistant.safe-read',
      userPrompt: message,
      context: {},
      outputMode: 'markdown',
      reasoning: 'none',
    }, signal);
    if (result.proposedEdits?.length) throw new Error('assistant_action_output_refused');
    return { reply: result.content, model: model.id };
  };
}
