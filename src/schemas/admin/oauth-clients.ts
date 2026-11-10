import { z } from 'zod'
import { PageInfoSchema } from '../page'

export const OAuthClientSourceSchema = z
  .enum(['OAUTH_CLIENT_SOURCE_UNSPECIFIED', 'OAUTH_CLIENT_SOURCE_CIMD', 'OAUTH_CLIENT_SOURCE_BUILT_IN'])
  .catch('OAUTH_CLIENT_SOURCE_UNSPECIFIED')
  .default('OAUTH_CLIENT_SOURCE_UNSPECIFIED')
export type OAuthClientSource = z.infer<typeof OAuthClientSourceSchema>

export const OAUTH_CLIENT_POLICIES = [
  'OAUTH_CLIENT_POLICY_UNSPECIFIED',
  'OAUTH_CLIENT_POLICY_DEFAULT',
  'OAUTH_CLIENT_POLICY_TRUSTED',
  'OAUTH_CLIENT_POLICY_BLOCKED',
] as const
export const OAuthClientPolicySchema = z
  .enum(OAUTH_CLIENT_POLICIES)
  .catch('OAUTH_CLIENT_POLICY_UNSPECIFIED')
  .default('OAUTH_CLIENT_POLICY_UNSPECIFIED')
export type OAuthClientPolicy = (typeof OAUTH_CLIENT_POLICIES)[number]

/** An OAuth client that completed at least one user authorization on this server. */
export const OAuthClientSchema = z.object({
  /** Stable ID: a CIMD URL or built-in application URI. */
  clientId: z.string(),
  clientName: z.string().default(''),
  /** Canonical origin derived from validated client metadata. */
  clientOrigin: z.string().default(''),
  source: OAuthClientSourceSchema,
  policy: OAuthClientPolicySchema,
  firstAuthorizationAt: z.string().optional(),
  lastAuthorizationAt: z.string().optional(),
  /** Web origins or native callback schemes seen during authorization. */
  redirectOrigins: z.array(z.string()).default([]),
  /** Distinct users who authorized this client. */
  authorizedUserCount: z.number().default(0),
})
export type OAuthClient = z.infer<typeof OAuthClientSchema>

export const ListOAuthClientsResponseSchema = z.object({
  oauthClients: z.array(OAuthClientSchema).default([]),
  page: PageInfoSchema.optional(),
})
export const OAuthClientResponseSchema = z.object({ oauthClient: OAuthClientSchema })
