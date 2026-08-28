import { attachmentCapability } from '@/features/attachments/capability'

/**
 * GET /api/files/capability — what MigraPilot will accept, from the contract.
 *
 * Exists so a UI never hard-codes its own copy of the accepted list. Anything
 * rendered from this cannot drift from what the validator enforces, because both
 * read the same definition — which is the defect this whole slice removes.
 */
export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  return Response.json(attachmentCapability())
}
