import { z } from 'zod'
import { ServerPublicProfileSchema } from '../server'

/** `chatto.api.v1.AccountCreationPolicy`. `UNSPECIFIED` (older servers) means open. */
export const AccountCreationPolicySchema = z
  .enum([
    'ACCOUNT_CREATION_POLICY_UNSPECIFIED',
    'ACCOUNT_CREATION_POLICY_OPEN',
    'ACCOUNT_CREATION_POLICY_INVITE_ONLY',
  ])
  .catch('ACCOUNT_CREATION_POLICY_UNSPECIFIED')
  .default('ACCOUNT_CREATION_POLICY_UNSPECIFIED')

export const RegistrationSettingsSchema = z.object({
  admission: AccountCreationPolicySchema,
})

/** Runtime-editable server settings. Empty strings mean unset / default. */
export const ServerConfigSchema = z.object({
  /** Server name for page titles; `''` means the default is used. */
  serverName: z.string().default(''),
  /** Short description for link-preview metadata. */
  description: z.string().default(''),
  /** Message of the day for the authenticated header. */
  motd: z.string().default(''),
  /** Welcome message shown on the login page. */
  welcomeMessage: z.string().default(''),
  registration: RegistrationSettingsSchema.prefault({}),
})

/** Get/UpdateServerConfig response: settings plus effective public branding. */
export const AdminServerConfigResponseSchema = z.object({
  config: ServerConfigSchema.prefault({}),
  publicProfile: ServerPublicProfileSchema.prefault({}),
})

/** Logo/banner upload and delete responses. */
export const AdminServerProfileResponseSchema = z.object({
  publicProfile: ServerPublicProfileSchema.prefault({}),
})

/** GetServerSecurityConfig / UpdateBlockedUsernames response. */
export const ServerSecurityConfigSchema = z.object({
  /** Blocked usernames, normalized by the server. */
  blockedUsernames: z.array(z.string()).default([]),
})

/** A server advertised in the public Neighbor directory. */
export const NeighborSchema = z.object({
  id: z.string(),
  /** Canonical HTTP(S) server origin. */
  origin: z.string().default(''),
  /** Opaque revision required for update and delete. */
  revision: z.string().default(''),
})

export const ListNeighborsResponseSchema = z.object({
  neighbors: z.array(NeighborSchema).default([]),
})

export const NeighborResponseSchema = z.object({ neighbor: NeighborSchema })

export const AdminServerEmptyResponseSchema = z.object({})

export type AccountCreationPolicy = z.infer<typeof AccountCreationPolicySchema>
export type RegistrationSettings = z.infer<typeof RegistrationSettingsSchema>
export type ServerConfig = z.infer<typeof ServerConfigSchema>
export type AdminServerConfig = z.infer<typeof AdminServerConfigResponseSchema>
export type ServerSecurityConfig = z.infer<typeof ServerSecurityConfigSchema>
export type Neighbor = z.infer<typeof NeighborSchema>
