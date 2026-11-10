import { z } from 'zod'
import { PageInfoSchema } from '../page'

export const InvitationCodeStatusSchema = z
  .enum([
    'INVITATION_CODE_STATUS_UNSPECIFIED',
    'INVITATION_CODE_STATUS_ACTIVE',
    'INVITATION_CODE_STATUS_EXPIRED',
    'INVITATION_CODE_STATUS_USED',
    'INVITATION_CODE_STATUS_REVOKED',
  ])
  .catch('INVITATION_CODE_STATUS_UNSPECIFIED')
  .default('INVITATION_CODE_STATUS_UNSPECIFIED')
export type InvitationCodeStatus = z.infer<typeof InvitationCodeStatusSchema>

/**
 * Single-use registration code for an invite-only server. Anyone holding
 * `code` can redeem it — treat it as a secret and never log it.
 */
export const InvitationCodeSchema = z.object({
  id: z.string(),
  /** The redeemable code (e.g. `R4NV-FWAW-…`). Secret. */
  code: z.string().default(''),
  /** Creator user ID. */
  createdBy: z.string().default(''),
  createdAt: z.string().optional(),
  /** Absent = no expiry. */
  expiresAt: z.string().optional(),
  status: InvitationCodeStatusSchema,
  revokedAt: z.string().optional(),
  /** Creation-time note; empty when none. */
  note: z.string().default(''),
})
export type InvitationCode = z.infer<typeof InvitationCodeSchema>

export const ListInvitationCodesResponseSchema = z.object({
  invitationCodes: z.array(InvitationCodeSchema).default([]),
  page: PageInfoSchema.optional(),
})
export const InvitationCodeResponseSchema = z.object({ invitationCode: InvitationCodeSchema })
