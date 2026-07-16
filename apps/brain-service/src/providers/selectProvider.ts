import type { ModelProfile } from '@migrapilot/shared-types';
import type { BrainEnv } from '../config/env.js';

export function selectEffectiveProfile(
  requested: Exclude<ModelProfile, 'none'>,
  env: BrainEnv,
): Exclude<ModelProfile, 'none'> {
  if (env.mode === 'offline') {
    if (requested === 'cheap' || requested === 'default' || requested === 'premium') {
      return 'local';
    }
  }

  if (requested === 'premium' && !env.premiumModel) {
    return 'default';
  }

  if (requested === 'default' && !env.defaultModel && env.mode === 'cloud') {
    return 'cheap';
  }

  if (requested === 'cheap' && !env.cheapModel && env.mode === 'cloud') {
    return 'local';
  }

  return requested;
}