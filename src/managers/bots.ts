import type { ClientContext } from '../context'
import { ChattoValidationError } from '../errors'
import { type Page, type PageOptions, pageRequest, toPage } from '../util/page'
import {
  ListBotsResponseSchema,
  BotResponseSchema,
  BatchGetBotsResponseSchema,
  DeleteBotResponseSchema,
  IssuedBotApiKeyResponseSchema,
  CreateBotIncomingWebhookResponseSchema,
  ListBotOutboundWebhooksResponseSchema,
  BotOutboundWebhookResponseSchema,
  CreateBotOutboundWebhookResponseSchema,
  RevokeBotOutboundWebhookResponseSchema,
  ListBotWebhookFailuresResponseSchema,
  type Bot,
  type BotOutboundWebhook,
  type BotWebhookFailurePage,
  type CreatedBotIncomingWebhook,
  type CreatedBotOutboundWebhook,
  type IssuedBotApiKey,
} from '../schemas/bot'

const SERVICE = 'chatto.api.v1.BotService'

export interface ListBotsOptions extends PageOptions {
  /** Case-insensitive login or display-name search (max 100 chars). */
  search?: string
}

export interface CreateBotOptions {
  /** Bot login (2–32 chars, same rules as human usernames). */
  login: string
  /** Public display name (max 32 chars). */
  displayName: string
  /** Name of the initial API key. Server default: "Default key". */
  apiKeyName?: string
}

export interface CreateOutboundWebhookOptions {
  /** Display name (1–64 chars), fixed after creation. */
  name: string
  /** Absolute HTTPS destination (HTTP allowed for `localhost` names only). */
  url: string
  /** Optional complete `Authorization` header value sent with each request. */
  authorization?: string
  /** Whether the endpoint delivers immediately. Default `true`; `false` creates it paused. */
  enabled?: boolean
}

export interface UpdateOutboundWebhookOptions {
  /** Pause (`false`) or resume (`true`). Resuming only delivers new messages. */
  enabled?: boolean
  /** New destination. Changing settings cancels queued retries. */
  url?: string
  /** New `Authorization` header value; `null` or `''` removes it. */
  authorization?: string | null
}

export interface ListWebhookFailuresOptions {
  /** Records per page (1–100). Server default: 20. */
  pageSize?: number
  /** Cursor from a previous page's `nextCursor`. */
  cursor?: string
}

/**
 * Bot accounts and their credentials (`chatto.api.v1.BotService`).
 *
 * Callers see/manage their own bots; `bot.manage` (or `user.manage-accounts`
 * for reads) covers every bot. Bots authenticate with an API key sent as
 * `Authorization: Bearer cht_BK_…`; keys never expire and are shown only once.
 */
export class BotManager {
  constructor(private readonly ctx: ClientContext) {}

  /** List bots visible to the caller, ordered by login. Page size max 100 (default 20). */
  async list(opts: ListBotsOptions = {}): Promise<Page<Bot>> {
    if (opts.limit != null && opts.limit > 100) {
      throw new ChattoValidationError('page_limit_too_large', 'At most 100 bots may be listed per page')
    }
    const res = await this.ctx.rest.post(
      SERVICE,
      'ListBots',
      { search: opts.search || undefined, page: pageRequest(opts) },
      ListBotsResponseSchema,
    )
    return toPage(res.bots, res.page)
  }

  /** Fetch one bot. NOT_FOUND for unknown bots, PERMISSION_DENIED when not visible. */
  async fetch(botUserId: string): Promise<Bot> {
    const res = await this.ctx.rest.post(SERVICE, 'GetBot', { botUserId }, BotResponseSchema)
    return res.bot
  }

  /** Fetch up to 100 bots at once. Missing or inaccessible bots are omitted. */
  async fetchMany(botUserIds: string[]): Promise<Bot[]> {
    if (botUserIds.length === 0) return []
    if (botUserIds.length > 100) {
      throw new ChattoValidationError('too_many_bot_ids', 'At most 100 bot IDs may be fetched at once')
    }
    const res = await this.ctx.rest.post(SERVICE, 'BatchGetBots', { botUserIds }, BatchGetBotsResponseSchema)
    return res.bots
  }

  /**
   * Create a bot owned by the caller (or by a bot caller's human owner).
   * Requires `bot.create` (on fresh servers this needs privileged mode for
   * admins). The bot starts without permission grants.
   *
   * The returned `apiKey` is a **show-once secret** — store it immediately.
   */
  async create(opts: CreateBotOptions): Promise<IssuedBotApiKey> {
    return this.ctx.rest.post(
      SERVICE,
      'CreateBot',
      { login: opts.login, displayName: opts.displayName, apiKeyName: opts.apiKeyName },
      IssuedBotApiKeyResponseSchema,
    )
  }

  /** Delete a bot and invalidate all of its API keys. Returns whether it was deleted. */
  async delete(botUserId: string): Promise<boolean> {
    const res = await this.ctx.rest.post(SERVICE, 'DeleteBot', { botUserId }, DeleteBotResponseSchema)
    return res.deleted
  }

  /**
   * Issue a new named API key (max 20 active per bot). Requires ownership or
   * `bot.manage`. The returned `apiKey` is a **show-once secret**.
   */
  async createApiKey(botUserId: string, name: string): Promise<IssuedBotApiKey> {
    return this.ctx.rest.post(SERVICE, 'CreateBotApiKey', { botUserId, name }, IssuedBotApiKeyResponseSchema)
  }

  /** Irreversibly revoke one API key (closes its realtime connections). Returns the updated bot. */
  async revokeApiKey(botUserId: string, keyId: string): Promise<Bot> {
    const res = await this.ctx.rest.post(SERVICE, 'RevokeBotApiKey', { botUserId, keyId }, BotResponseSchema)
    return res.bot
  }

  /**
   * Create a named incoming webhook (max 20 active per bot). The returned
   * `webhookUrl` contains a **show-once credential**.
   */
  async createIncomingWebhook(botUserId: string, name: string): Promise<CreatedBotIncomingWebhook> {
    return this.ctx.rest.post(
      SERVICE,
      'CreateBotIncomingWebhook',
      { botUserId, name },
      CreateBotIncomingWebhookResponseSchema,
    )
  }

  /** Irreversibly revoke one incoming webhook. Returns the updated bot. */
  async revokeIncomingWebhook(botUserId: string, webhookId: string): Promise<Bot> {
    const res = await this.ctx.rest.post(
      SERVICE,
      'RevokeBotIncomingWebhook',
      { botUserId, webhookId },
      BotResponseSchema,
    )
    return res.bot
  }

  /**
   * Give a bot to another active human owner. Requires `bot.manage`. API keys
   * and the permission allowlist are kept; effective permissions immediately
   * use the new owner's ceiling.
   */
  async reassignOwner(botUserId: string, ownerUserId: string): Promise<Bot> {
    const res = await this.ctx.rest.post(
      SERVICE,
      'ReassignBotOwner',
      { botUserId, ownerUserId },
      BotResponseSchema,
    )
    return res.bot
  }

  /** List all outbound webhook endpoints of a bot (max 20, including paused ones). */
  async listOutboundWebhooks(botUserId: string): Promise<BotOutboundWebhook[]> {
    const res = await this.ctx.rest.post(
      SERVICE,
      'ListBotOutboundWebhooks',
      { botUserId },
      ListBotOutboundWebhooksResponseSchema,
    )
    return res.webhooks
  }

  /** Fetch one outbound webhook endpoint. */
  async fetchOutboundWebhook(botUserId: string, webhookId: string): Promise<BotOutboundWebhook> {
    const res = await this.ctx.rest.post(
      SERVICE,
      'GetBotOutboundWebhook',
      { botUserId, webhookId },
      BotOutboundWebhookResponseSchema,
    )
    return res.webhook
  }

  /**
   * Create an outbound webhook endpoint (max 20 per bot). Unlike the raw API,
   * the endpoint is enabled unless `enabled: false` is passed. The returned
   * `signingSecret` is a **show-once** HMAC secret.
   */
  async createOutboundWebhook(botUserId: string, opts: CreateOutboundWebhookOptions): Promise<CreatedBotOutboundWebhook> {
    return this.ctx.rest.post(
      SERVICE,
      'CreateBotOutboundWebhook',
      {
        botUserId,
        name: opts.name,
        url: opts.url,
        authorization: opts.authorization || undefined,
        enabled: opts.enabled ?? true,
      },
      CreateBotOutboundWebhookResponseSchema,
    )
  }

  /**
   * Patch an outbound webhook's `enabled`, `url` and/or `authorization`. Only
   * the keys present in `changes` are applied (sent as the field mask). The
   * name and signing secret cannot be changed.
   */
  async updateOutboundWebhook(
    botUserId: string,
    webhookId: string,
    changes: UpdateOutboundWebhookOptions,
  ): Promise<BotOutboundWebhook> {
    const mask: string[] = []
    const body: Record<string, unknown> = { botUserId, webhookId }
    if (changes.enabled !== undefined) {
      mask.push('enabled')
      body.enabled = changes.enabled
    }
    if (changes.url !== undefined) {
      mask.push('url')
      body.url = changes.url
    }
    if (changes.authorization !== undefined) {
      mask.push('authorization')
      // A selected-but-absent value resets (removes) the header.
      if (changes.authorization) body.authorization = changes.authorization
    }
    if (mask.length === 0) {
      throw new ChattoValidationError('empty_update', 'At least one of enabled, url or authorization must be given')
    }
    body.updateMask = mask.join(',')
    const res = await this.ctx.rest.post(SERVICE, 'UpdateBotOutboundWebhook', body, BotOutboundWebhookResponseSchema)
    return res.webhook
  }

  /** Permanently revoke an outbound webhook and cancel its queued retries. Idempotent. */
  async revokeOutboundWebhook(botUserId: string, webhookId: string): Promise<void> {
    await this.ctx.rest.post(
      SERVICE,
      'RevokeBotOutboundWebhook',
      { botUserId, webhookId },
      RevokeBotOutboundWebhookResponseSchema,
    )
  }

  /**
   * List retained delivery failures of an outbound webhook, oldest first
   * (cursor-paginated; page size 1–100, default 20). Diagnostic only: an
   * empty result does not prove successful delivery.
   */
  async listWebhookFailures(
    botUserId: string,
    webhookId: string,
    opts: ListWebhookFailuresOptions = {},
  ): Promise<BotWebhookFailurePage> {
    if (opts.pageSize != null && opts.pageSize > 100) {
      throw new ChattoValidationError('page_size_too_large', 'At most 100 webhook failures may be listed per page')
    }
    const res = await this.ctx.rest.post(
      SERVICE,
      'ListBotWebhookFailures',
      { botUserId, webhookId, pageSize: opts.pageSize, cursor: opts.cursor || undefined },
      ListBotWebhookFailuresResponseSchema,
    )
    return { failures: res.failures, nextCursor: res.nextCursor || null }
  }
}
