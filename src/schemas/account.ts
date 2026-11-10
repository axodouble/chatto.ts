import { z } from 'zod'

import { PresenceStatusSchema, UserSchema } from './user'

// ---- Display settings (viewer.proto UserSettings) ----

export const TimeFormatSchema = z
  .enum(['TIME_FORMAT_UNSPECIFIED', 'TIME_FORMAT_AUTO', 'TIME_FORMAT_12_HOUR', 'TIME_FORMAT_24_HOUR'])
  .catch('TIME_FORMAT_UNSPECIFIED')
  .default('TIME_FORMAT_UNSPECIFIED')

export const UserSettingsSchema = z.object({
  /**
   * IANA timezone override. Absent = no choice recorded; empty string = the
   * user explicitly chose the device-local timezone.
   */
  timezone: z.string().optional(),
  timeFormat: TimeFormatSchema,
  /** Absent only on servers that don't support private time zones. */
  shareTimezone: z.boolean().optional(),
})
export type UserSettings = z.infer<typeof UserSettingsSchema>
export type TimeFormat = z.infer<typeof TimeFormatSchema>

export const GetSettingsResponseSchema = z.object({ settings: UserSettingsSchema.prefault({}) })
export const UpdateSettingsResponseSchema = GetSettingsResponseSchema

// ---- Verified emails ----

export const VerifiedEmailSchema = z.object({
  email: z.string().default(''),
  verifiedAt: z.string().optional(),
  primary: z.boolean().default(false),
})
export type VerifiedEmail = z.infer<typeof VerifiedEmailSchema>

export const VerifiedEmailsResponseSchema = z.object({
  verifiedEmails: z.array(VerifiedEmailSchema).default([]),
})

// ---- Password / deletion ----

export const ChangePasswordResponseSchema = z.object({ user: UserSchema.optional() })
export const RequestAccountDeletionResponseSchema = z.object({ confirmationToken: z.string().default('') })
export const EmptyResponseSchema = z.object({})

// ---- Presence preference (presence.proto) ----

export const PresencePreferenceSchema = z.object({
  status: PresenceStatusSchema.catch('PRESENCE_STATUS_UNSPECIFIED').default('PRESENCE_STATUS_UNSPECIFIED'),
  /** Opaque revision; pass it as `expectedRevision` when replacing the choice. */
  revision: z.string().default(''),
})
export type PresencePreference = z.infer<typeof PresencePreferenceSchema>

/** `preference` is absent until the account first saves a choice. */
export const PresencePreferenceResponseSchema = z.object({ preference: PresencePreferenceSchema.optional() })

// ---- External identities (external_identities.proto) ----

export const ProviderMetadataSchema = z.object({
  id: z.string().default(''),
  type: z.string().default(''),
  label: z.string().default(''),
  loginUrl: z.string().default(''),
  issuerUrl: z.string().optional(),
  autoProvision: z.boolean().optional(),
})
export type ProviderMetadata = z.infer<typeof ProviderMetadataSchema>

export const ExternalIdentityProviderSchema = z.object({
  linkUrl: z.string().default(''),
  linked: z.boolean().default(false),
  linkedIdentitySubjectHash: z.string().default(''),
  provider: ProviderMetadataSchema.optional(),
})
export type ExternalIdentityProvider = z.infer<typeof ExternalIdentityProviderSchema>

export const DisconnectEligibilitySchema = z
  .enum([
    'DISCONNECT_ELIGIBILITY_UNSPECIFIED',
    'DISCONNECT_ELIGIBILITY_ALLOWED',
    'DISCONNECT_ELIGIBILITY_LAST_ENABLED_SIGN_IN_METHOD',
    'DISCONNECT_ELIGIBILITY_DISABLED_BY_OPERATOR',
  ])
  .catch('DISCONNECT_ELIGIBILITY_UNSPECIFIED')
  .default('DISCONNECT_ELIGIBILITY_UNSPECIFIED')

export const LinkedExternalIdentitySchema = z.object({
  providerId: z.string().default(''),
  providerType: z.string().default(''),
  providerLabel: z.string().default(''),
  subjectHash: z.string().default(''),
  disconnectEligibility: DisconnectEligibilitySchema,
})
export type LinkedExternalIdentity = z.infer<typeof LinkedExternalIdentitySchema>

export const ListExternalIdentitiesResponseSchema = z.object({
  providers: z.array(ExternalIdentityProviderSchema).default([]),
  linkedIdentities: z.array(LinkedExternalIdentitySchema).default([]),
})
export type ExternalIdentities = z.infer<typeof ListExternalIdentitiesResponseSchema>

export const StartExternalIdentityLinkResponseSchema = z.object({ startUrl: z.string().default('') })

// ---- Account actions (account_actions.proto) ----

export const AccountActionsSchema = z.object({
  changeUsername: z
    .object({
      state: z
        .enum(['STATE_UNSPECIFIED', 'STATE_ALLOWED', 'STATE_PROVIDER_MANAGED'])
        .catch('STATE_UNSPECIFIED')
        .default('STATE_UNSPECIFIED'),
      /** Earliest time a change may be attempted; absent = no time restriction. */
      availableAt: z.string().optional(),
    })
    .optional(),
  /** Absent on older servers. */
  changePassword: z
    .enum([
      'PASSWORD_CHANGE_AVAILABILITY_UNSPECIFIED',
      'PASSWORD_CHANGE_AVAILABILITY_ALLOWED',
      'PASSWORD_CHANGE_AVAILABILITY_DIRECT_LOGIN_DISABLED',
      'PASSWORD_CHANGE_AVAILABILITY_UNSUPPORTED_ACCOUNT',
    ])
    .catch('PASSWORD_CHANGE_AVAILABILITY_UNSPECIFIED')
    .optional(),
  /** Absent on older servers. */
  deleteAccount: z
    .enum([
      'ACCOUNT_DELETION_AVAILABILITY_UNSPECIFIED',
      'ACCOUNT_DELETION_AVAILABILITY_ALLOWED',
      'ACCOUNT_DELETION_AVAILABILITY_PERMISSION_DENIED',
      'ACCOUNT_DELETION_AVAILABILITY_UNSUPPORTED_ACCOUNT',
    ])
    .catch('ACCOUNT_DELETION_AVAILABILITY_UNSPECIFIED')
    .optional(),
})
export type AccountActions = z.infer<typeof AccountActionsSchema>
