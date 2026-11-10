import type { ClientContext } from '../context'
import { ChattoValidationError } from '../errors'
import {
  SubscribeResponseSchema,
  UnsubscribeResponseSchema,
  SendTestNotificationResponseSchema,
} from '../schemas/push'

const SERVICE = 'chatto.api.v1.PushNotificationService'

/** Shape of `PushSubscription.toJSON()` from the browser Push API. */
export interface WebPushSubscription {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export interface PushSubscribeOptions {
  /** Host (optionally with port, no scheme/path) of the Chatto server that served the web app. */
  clientHost: string
  /** Optional user-agent for device identification (max 512 chars). */
  userAgent?: string
  /** Random per-save token (32–128 chars). Generated when omitted. */
  cleanupToken?: string
}

function randomToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

/** Browser Web Push subscriptions (`chatto.api.v1.PushNotificationService`). */
export class PushNotificationManager {
  constructor(private readonly ctx: ClientContext) {}

  /**
   * Store or refresh a Web Push subscription. Requires Web Push configured on
   * the server. Subscriptions expire 180 days after the last save; re-subscribe
   * on startup and at least daily. Returns the cleanup token that was sent.
   */
  async subscribe(subscription: WebPushSubscription, opts: PushSubscribeOptions): Promise<{ cleanupToken: string }> {
    const cleanupToken = opts.cleanupToken ?? randomToken()
    if (cleanupToken.length < 32 || cleanupToken.length > 128) {
      throw new ChattoValidationError('invalid_cleanup_token', 'cleanupToken must be 32–128 characters')
    }
    await this.ctx.rest.post(
      SERVICE,
      'Subscribe',
      {
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
        userAgent: opts.userAgent,
        clientHost: opts.clientHost,
        cleanupToken,
      },
      SubscribeResponseSchema,
    )
    return { cleanupToken }
  }

  /** Remove a subscription by endpoint. Idempotent. */
  async unsubscribe(endpoint: string): Promise<void> {
    await this.ctx.rest.post(SERVICE, 'Unsubscribe', { endpoint }, UnsubscribeResponseSchema)
  }

  /** Send a test notification to your registered subscriptions. Rate-limited per account. */
  async sendTestNotification(): Promise<void> {
    await this.ctx.rest.post(SERVICE, 'SendTestNotification', {}, SendTestNotificationResponseSchema)
  }
}
