import 'server-only'

import { callBrain } from '@/server/brain/gateway'

/**
 * Can an image actually be understood right now?
 *
 * "STORED" AND "USABLE" ARE DIFFERENT FACTS. An upload can succeed perfectly
 * while no model exists that may answer about it — the Brain's vision registry
 * is fail-closed, so a model is installed but unusable until it has been
 * licensed, measured and approved. Measured on production: four vision models
 * installed, none qualified, `default: null`.
 *
 * The UI must not read "upload succeeded" as "vision is ready", so the upload
 * response carries this alongside the stored record. The answer comes from the
 * BRAIN, never from a constant here — a hardcoded `true` would be a promise this
 * app is in no position to make.
 */

export type VisionState = 'ready' | 'no_qualified_model' | 'unknown'

export interface VisionCapability {
  state: VisionState
  /** The model an image turn would actually use, when there is one. */
  model: string | null
  /** How many vision models exist at all — 'none installed' reads differently. */
  installed: number
  /** Human-readable, for a UI that must explain why an action is unavailable. */
  message: string
}

interface VisionRegistryResponse {
  count?: number
  enforced?: boolean
  default?: { id?: string } | string | null
  registry?: { qualified?: unknown[] }
}

const modelIdOf = (value: VisionRegistryResponse['default']): string | null => {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && typeof value.id === 'string') return value.id
  return null
}

export async function visionCapability(): Promise<VisionCapability> {
  const result = await callBrain<VisionRegistryResponse>({ kind: 'visionCapability' })

  /*
   * UNREACHABLE IS NOT UNAVAILABLE. If the Brain cannot be asked, this app does
   * not know the answer — and reporting "not available" would be as much an
   * invention as reporting "ready". `unknown` lets a UI say the honest thing.
   */
  if (result.kind !== 'ok' || !result.value) {
    return {
      state: 'unknown',
      model: null,
      installed: 0,
      message: 'We could not check whether images can be read right now.',
    }
  }

  const installed = typeof result.value.count === 'number' ? result.value.count : 0
  const model = modelIdOf(result.value.default)

  if (model) {
    return { state: 'ready', model, installed, message: 'Images can be read in a conversation.' }
  }

  return {
    state: 'no_qualified_model',
    model: null,
    installed,
    message:
      installed > 0
        ? 'Your image is saved. Reading images in a conversation is not enabled yet — no vision model has been approved for use.'
        : 'Your image is saved. Reading images in a conversation is not available on this deployment.',
  }
}
