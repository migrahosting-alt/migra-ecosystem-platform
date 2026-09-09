/**
 * What MigraPilot can be given — now defined ONCE, for every caller.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THIS FILE NO LONGER HOLDS THE RULES
 *
 * The table, the size ceiling, the refusal copy and the classification logic
 * moved to `@migrapilot/shared-types/file-policy`, because a second caller
 * appeared: Gmail attachments are ingested by the Brain, and they must obey the
 * same policy as an upload.
 *
 * The alternative was restating the rules in the Brain, which would have
 * recreated — across two processes this time — exactly the drift this contract
 * was written to end. The product once offered 48 extensions from a picker
 * while storage accepted 27, so a person could choose `.xlsx` from a menu
 * MigraPilot presented and be refused on upload, twenty-one types deep.
 *
 * This module stays as the consumer's import path so no call site had to
 * change, and so `@/features/attachments/capability` still means what it always
 * meant here. It re-exports; it never redefines. Adding a rule below would
 * reintroduce the second source of truth.
 */

export * from '@migrapilot/shared-types/file-policy'
