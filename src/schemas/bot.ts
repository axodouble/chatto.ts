import { z } from 'zod'

import { PageInfoSchema } from './page'
import { UserSchema } from './user'

/** Availability of best-effort credential last-use telemetry. */
export const CredentialLastUsedStateSchema = z
  .enum([
    'CREDENTIAL_LAST_USED_STATE_UNSPECIFIED',
    'CREDENTIAL_LAST_USED_STATE_NO_USE_RECORDED',
    'CREDENTIAL_LAST_USED_STATE_RECORDED',
    'CREDENTIAL_LAST_USED_STATE_UNAVAILABLE',
  ])
  .catch('CREDENTIAL_LAST_USED_STATE_UNSPECIFIED')
  .default('CREDENTIAL_LAST_USED_STATE_UNSPECIFIED')

/** Safe metadata for one active bot API key. Never contains the raw key. */
export const BotApiKeySchema = z.object({
  /** Stable credential ID (the initial key of older bots uses the ID `legacy`). */
  id: z.string(),
  name: z.string().default(''),
  createdAt: z.string().optional(),
  lastUsedState: CredentialLastUsedStateSchema,
  /** Most recent recorded successful authentication, when recorded. */
  lastUsedAt: z.string().optional(),
})

/** Safe metadata for one active incoming webhook. Never contains the URL. */
export const BotIncomingWebhookSchema = z.object({
  id: z.string(),
  name: z.string().default(''),
  createdAt: z.string().optional(),
  lastUsedState: CredentialLastUsedStateSchema,
  lastUsedAt: z.string().optional(),
})

/** A managed bot account. Raw API keys are never part of this shape. */
export const BotSchema = z.object({
  /** Canonical public bot identity. */
  user: UserSchema,
  /** Stable human owner user ID. */
  ownerUserId: z.string().default(''),
  createdAt: z.string().optional(),
  /** Legacy time of the initial API key. Use `apiKeys` for active credentials. */
  apiKeyCreatedAt: z.string().optional(),
  /** Active incoming webhooks, ordered by creation time. */
  incomingWebhooks: z.array(BotIncomingWebhookSchema).default([]),
  /** Active API keys, ordered by creation time. */
  apiKeys: z.array(BotApiKeySchema).default([]),
  /** Start of the 30-day username-change cooldown, when one is running. */
  lastLoginChange: z.string().optional(),
})

/** Safe summary of one recorded outbound webhook delivery failure. */
export const BotWebhookFailureSchema = z.object({
  /** Delivery ID shared by all retry attempts. */
  id: z.string(),
  /** Safe failure category; never contains response bodies or credentials. */
  reason: z.string().default(''),
  attempts: z.number().int().default(0),
  /** 0 when no HTTP response was received. */
  httpStatus: z.number().int().default(0),
  completedAt: z.string().optional(),
  /** Source message ID associated with this delivery. */
  sourceEventId: z.string().default(''),
})

/** Outbound webhook endpoint. The Authorization header and signing secret are write-only. */
export const BotOutboundWebhookSchema = z.object({
  id: z.string(),
  enabled: z.boolean().default(false),
  /** Whether an Authorization header is configured (its value is never returned). */
  hasAuthorization: z.boolean().default(false),
  /** Latest retained failure. Absence does not prove successful delivery. */
  latestFailure: BotWebhookFailureSchema.optional(),
  url: z.string().default(''),
  name: z.string().default(''),
  createdAt: z.string().optional(),
})

export const ListBotsResponseSchema = z.object({
  bots: z.array(BotSchema).default([]),
  page: PageInfoSchema.optional(),
})
export const BotResponseSchema = z.object({ bot: BotSchema })
export const BatchGetBotsResponseSchema = z.object({ bots: z.array(BotSchema).default([]) })
export const DeleteBotResponseSchema = z.object({ deleted: z.boolean().default(false) })

/** CreateBot / CreateBotApiKey response: `apiKey` is shown once. */
export const IssuedBotApiKeyResponseSchema = z.object({
  bot: BotSchema,
  apiKey: z.string(),
  apiKeyMetadata: BotApiKeySchema,
})

/** CreateBotIncomingWebhook response: `webhookUrl` is shown once. */
export const CreateBotIncomingWebhookResponseSchema = z.object({
  bot: BotSchema,
  webhookUrl: z.string(),
})

export const ListBotOutboundWebhooksResponseSchema = z.object({
  webhooks: z.array(BotOutboundWebhookSchema).default([]),
})
export const BotOutboundWebhookResponseSchema = z.object({ webhook: BotOutboundWebhookSchema })

/** CreateBotOutboundWebhook response: `signingSecret` is shown once. */
export const CreateBotOutboundWebhookResponseSchema = z.object({
  webhook: BotOutboundWebhookSchema,
  signingSecret: z.string().default(''),
})
export const RevokeBotOutboundWebhookResponseSchema = z.object({})

export const ListBotWebhookFailuresResponseSchema = z.object({
  failures: z.array(BotWebhookFailureSchema).default([]),
  nextCursor: z.string().default(''),
})

export type Bot = z.infer<typeof BotSchema>
export type BotApiKey = z.infer<typeof BotApiKeySchema>
export type BotIncomingWebhook = z.infer<typeof BotIncomingWebhookSchema>
export type BotOutboundWebhook = z.infer<typeof BotOutboundWebhookSchema>
export type BotWebhookFailure = z.infer<typeof BotWebhookFailureSchema>
export type CredentialLastUsedState = z.infer<typeof CredentialLastUsedStateSchema>

/**
 * A freshly issued bot API key. `apiKey` is a **show-once secret** (format
 * `cht_BK_<botUserId>.<secret>`): Chatto cannot return it again, so store it
 * now. Bot API keys do not expire; revoke them with `revokeApiKey`.
 */
export type IssuedBotApiKey = z.infer<typeof IssuedBotApiKeyResponseSchema>

/**
 * A freshly created incoming webhook. `webhookUrl` embeds a **show-once
 * credential** and cannot be retrieved later. Treat it like a password.
 */
export type CreatedBotIncomingWebhook = z.infer<typeof CreateBotIncomingWebhookResponseSchema>

/**
 * A freshly created outbound webhook endpoint. `signingSecret` is the
 * **show-once** HMAC secret used to verify Chatto's requests; it cannot be
 * retrieved later.
 */
export type CreatedBotOutboundWebhook = z.infer<typeof CreateBotOutboundWebhookResponseSchema>

/** One page of outbound webhook failures. `nextCursor` is `null` at the end. */
export interface BotWebhookFailurePage {
  failures: BotWebhookFailure[]
  nextCursor: string | null
}
