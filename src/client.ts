import { EventEmitter } from 'events'
import { RestClient } from './rest/client'
import { RealtimeConnection, type CloseReason, type RealtimeConnectionOptions } from './realtime/connection'
import { mapRealtimeEvent, toTypedEvent } from './realtime/events'
import type { RealtimeEvent } from './realtime/generated'
import { ChattoContext } from './context'
import { loginWithPassword, logout as logoutSession } from './auth/integrated'
import { TokenStore } from './auth/token-store'
import type { ZodTypeAny, z } from 'zod'
import type { RoomManager } from './managers/rooms'
import type { MessageManager } from './managers/messages'
import type { ThreadManager } from './managers/threads'
import type { UserManager } from './managers/users'
import type { AssetManager } from './managers/assets'
import type { AccountManager } from './managers/account'
import type { ViewerManager } from './managers/viewer'
import type { PermissionManager } from './managers/permissions'
import type { RoleManager } from './managers/roles'
import type { ServerManager } from './managers/server'
import type { VoiceCallManager } from './managers/voice'
import type { PushNotificationManager } from './managers/push'
import type { SessionTokens } from './auth/token-store'
import type { ChattoClientOptions, ClientEventMap, ReconnectOptions, PresenceInput, CustomStatusInput, CustomStatus } from './types'
import { ChattoAuthError } from './errors'
import { toPresenceStatus } from './account/presence'


export class ChattoClient extends EventEmitter<ClientEventMap> {
  readonly rooms: RoomManager
  readonly messages: MessageManager
  readonly threads: ThreadManager
  readonly users: UserManager
  readonly assets: AssetManager
  /** The signed-in account: presence, custom status, settings, emails, password. */
  readonly account: AccountManager
  /** The authenticated viewer and privileged mode. */
  readonly viewer: ViewerManager
  readonly permissions: PermissionManager
  readonly roles: RoleManager
  /** Server profile, message of the day, and runtime limits. */
  readonly server: ServerManager
  readonly voice: VoiceCallManager
  readonly push: PushNotificationManager
  private readonly rest: RestClient
  private readonly realtime: RealtimeConnection
  private readonly ctx: ChattoContext
  private readonly store: TokenStore
  private reconnecting = false
  private reconnectAttempt = 0
  private readonly reconnectOpts: Required<ReconnectOptions>
  private refreshTimer: ReturnType<typeof setInterval> | null = null
  private proactiveRefreshTimer: ReturnType<typeof setTimeout> | null = null
  private readonly baseUrl: string
  private closedByUser = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private presenceTimer: ReturnType<typeof setInterval> | null = null
  private readonly presenceOpts: { autoRefresh: boolean; intervalMs: number }

  constructor(
    options: ChattoClientOptions,
    realtimeFactory?: (
      wsUrl: string,
      getToken: () => string,
      options: RealtimeConnectionOptions,
    ) => RealtimeConnection,
  ) {
    super()
    const wsUrl = options.baseUrl.replace(/^https?/, m => (m === 'https' ? 'wss' : 'ws')) + '/api/realtime'
    this.baseUrl = options.baseUrl
    this.store = new TokenStore(options.baseUrl, options.token, options.credentials, undefined, {
      refreshToken: options.refreshToken,
      expiresAt: options.tokenExpiresAt instanceof Date ? options.tokenExpiresAt.getTime() : options.tokenExpiresAt,
    })
    this.reconnectOpts = {
      baseDelayMs: options.reconnect?.baseDelayMs ?? 1000,
      maxDelayMs: options.reconnect?.maxDelayMs ?? 30000,
      factor: options.reconnect?.factor ?? 2,
      maxAttempts: options.reconnect?.maxAttempts ?? Infinity,
    }
    this.presenceOpts = {
      autoRefresh: options.presence?.autoRefresh ?? true,
      intervalMs: options.presence?.intervalMs ?? 30000,
    }
    const getToken = () => this.store.getToken()
    this.rest = new RestClient(
      options.baseUrl,
      getToken,
      this.store.canRefresh() ? () => this.refreshToken() : undefined,
    )
    const realtimeOptions: RealtimeConnectionOptions = {
      initialState: options.realtime?.initialState === 'snapshot'
        ? 'REALTIME_INITIAL_STATE_SNAPSHOT'
        : 'REALTIME_INITIAL_STATE_LIVE_ONLY',
      heartbeatTimeoutMs: options.realtime?.heartbeatTimeoutMs,
    }
    this.realtime = realtimeFactory
      ? realtimeFactory(wsUrl, getToken, realtimeOptions)
      : new RealtimeConnection(wsUrl, getToken, undefined, realtimeOptions)
    this.ctx = new ChattoContext(this.rest)
    this.rooms = this.ctx.rooms
    this.messages = this.ctx.messages
    this.threads = this.ctx.threads
    this.users = this.ctx.users
    this.assets = this.ctx.assets
    this.account = this.ctx.account
    this.viewer = this.ctx.viewer
    this.permissions = this.ctx.permissions
    this.roles = this.ctx.roles
    this.server = this.ctx.server
    this.voice = this.ctx.voice
    this.push = this.ctx.push
    this.on('error', () => {})
    this.wireRealtime()

    const intervalMs = options.refresh?.intervalMs
    if (intervalMs != null && intervalMs > 0 && this.store.canRefresh()) {
      this.refreshTimer = setInterval(() => {
        this.refreshToken().catch(err => this.emit('error', err instanceof Error ? err : new Error(String(err))))
      }, intervalMs)
    }
  }

  /**
   * Sign in with a password and return a client for the resulting session.
   * The session is renewed with its rotating refresh token; the password is
   * retained only as a fallback when `retainCredentials` is true (the default,
   * for compatibility). Pass extra client options (reconnect, realtime, ...)
   * through `options`.
   */
  static async login(
    options: { baseUrl: string; login: string; password: string; retainCredentials?: boolean } &
      Omit<ChattoClientOptions, 'baseUrl' | 'token' | 'credentials' | 'refreshToken' | 'tokenExpiresAt'>,
  ): Promise<ChattoClient> {
    const { login, password, retainCredentials = true, ...rest } = options
    const result = await loginWithPassword(options.baseUrl, login, password)
    return new ChattoClient({
      ...rest,
      token: result.token,
      refreshToken: result.refreshToken,
      tokenExpiresAt: result.expiresIn != null ? Date.now() + result.expiresIn * 1000 : undefined,
      credentials: retainCredentials ? { login, password } : undefined,
    })
  }

  /** The current bearer session (token, refresh token, expiry), e.g. to persist it. */
  get session(): SessionTokens {
    return this.store.getSession()
  }

  async connect(): Promise<void> {
    this.closedByUser = false
    // Renew an access token that is about to expire before subscribing.
    const remaining = this.store.msUntilExpiry()
    if (remaining != null && remaining < 60_000 && this.store.canRefresh()) await this.refreshToken()
    await this.realtime.connect()
    this.scheduleProactiveRefresh()
    if (this.presenceOpts.autoRefresh) this.startPresenceHeartbeat()
    this.emit('ready')
  }

  /**
   * Revoke this session on the server (access and refresh token) and disconnect.
   * Bot API keys are not revoked by logout; manage them with the bots API.
   */
  async logout(): Promise<void> {
    const session = this.store.getSession()
    await this.disconnect()
    await logoutSession(this.baseUrl, session.token, session.refreshToken)
  }

  /**
   * Call any ConnectRPC method directly — an escape hatch for APIs without a
   * typed wrapper (e.g. `chatto.admin.v1.*`). The input uses proto3 JSON
   * (lowerCamelCase fields, int64 as strings, enums by name). Pass a Zod schema
   * to validate and type the response; otherwise the raw JSON is returned.
   */
  rpc<S extends ZodTypeAny>(service: string, method: string, input: unknown, schema: S): Promise<z.output<S>>
  rpc(service: string, method: string, input?: unknown): Promise<unknown>
  rpc(service: string, method: string, input: unknown = {}, schema?: ZodTypeAny): Promise<unknown> {
    return this.rest.call(service, method, input, schema)
  }

  /** Renew the access token now (refresh token first, then password fallback). */
  async refreshToken(): Promise<void> {
    await this.store.refresh()
    this.emit('tokenRefresh', this.store.getSession())
    if (this.proactiveRefreshTimer != null) this.scheduleProactiveRefresh()
  }

  // Keep a connected client's access token fresh so realtime reconnects and
  // REST calls never start with an expired token.
  private scheduleProactiveRefresh(): void {
    this.clearProactiveRefresh()
    const remaining = this.store.msUntilExpiry()
    if (remaining == null || !this.store.canRefresh() || this.closedByUser) return
    const delay = Math.max(5_000, remaining - 60_000)
    this.proactiveRefreshTimer = setTimeout(() => {
      this.proactiveRefreshTimer = null
      this.refreshToken()
        .then(() => this.scheduleProactiveRefresh())
        .catch(err => {
          this.emit('error', err instanceof Error ? err : new Error(String(err)))
          // Retry soon; the realtime/REST auth paths also refresh on demand.
          if (!this.closedByUser) this.proactiveRefreshTimer = setTimeout(() => this.scheduleProactiveRefresh(), 30_000)
        })
    }, delay)
    this.proactiveRefreshTimer.unref?.()
  }

  private clearProactiveRefresh(): void {
    if (this.proactiveRefreshTimer != null) {
      clearTimeout(this.proactiveRefreshTimer)
      this.proactiveRefreshTimer = null
    }
  }

  async disconnect(): Promise<void> {
    this.closedByUser = true
    this.reconnecting = false
    if (this.reconnectTimer != null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.refreshTimer != null) {
      clearInterval(this.refreshTimer)
      this.refreshTimer = null
    }
    this.clearProactiveRefresh()
    this.teardownPresence()
    this.realtime.disconnect()
    this.emit('disconnect')
  }

  /**
   * Save the account's presence choice (Chatto 0.5 presence preference). It is
   * shown on every device and survives disconnects: `'dnd'` suppresses alerts
   * and `'offline'`/`'invisible'` make the account appear offline. While the
   * client is connected (or after this call), a liveness heartbeat keeps an
   * Online/Away/DND choice visible; without one it shows as offline within 60s.
   */
  async setStatus(status: PresenceInput): Promise<PresenceInput> {
    await this.ctx.account.setPresencePreference(toPresenceStatus(status))
    if (this.presenceOpts.autoRefresh && !this.closedByUser) this.startPresenceHeartbeat()
    return status
  }

  async setCustomStatus(input: CustomStatusInput): Promise<CustomStatus> {
    return this.ctx.account.updateCustomStatus(input)
  }

  async clearCustomStatus(): Promise<void> {
    await this.ctx.account.deleteCustomStatus()
  }

  // RefreshPresence reports liveness: Chatto shows the saved choice only while
  // a heartbeat arrived within the last 60 seconds.
  private startPresenceHeartbeat(): void {
    if (this.presenceTimer != null) return
    const beat = () => {
      this.ctx.account.refreshPresence().catch(err => {
        this.emit('error', err instanceof Error ? err : new Error(String(err)))
      })
    }
    beat()
    this.presenceTimer = setInterval(beat, this.presenceOpts.intervalMs)
    this.presenceTimer.unref?.()
  }

  // Called from every terminal shutdown path (user disconnect(), clean/fatal
  // close, auth close with no refreshable credentials, reconnect give-up)
  // so the heartbeat can never keep firing after the client has given up.
  private teardownPresence(): void {
    if (this.presenceTimer != null) {
      clearInterval(this.presenceTimer)
      this.presenceTimer = null
    }
  }

  private wireRealtime(): void {
    this.realtime.on('event', (event: RealtimeEvent) => this.dispatchRealtimeEvent(event))
    this.realtime.on('snapshot', snapshot => this.emit('snapshot', snapshot))
    this.realtime.on('caughtUp', state => this.emit('caughtUp', state))
    this.realtime.on('error', (err: Error) => this.emit('error', err))

    this.realtime.on('close', (reason: CloseReason) => {
      if (this.closedByUser) return
      if (reason.kind === 'clean' || reason.kind === 'fatal') {
        this.teardownPresence()
        if (reason.kind === 'fatal') {
          this.emit('error', new Error(`realtime closed: ${reason.realtimeCode ?? reason.code}${reason.message ? ` (${reason.message})` : ''}`))
        }
        this.emit('disconnect')
        return
      }
      if (reason.kind === 'terminated') {
        this.teardownPresence()
        this.emit('error', new ChattoAuthError('session_terminated', reason.message || 'The server ended this session'))
        this.emit('disconnect')
        return
      }
      if (reason.kind === 'auth' && !this.store.canRefresh()) {
        this.teardownPresence()
        this.emit('error', new ChattoAuthError('no_credentials', 'Realtime auth failed and no credentials to refresh'))
        this.emit('disconnect')
        return
      }
      this.startReconnect(reason)
    })
  }

  private dispatchRealtimeEvent(event: RealtimeEvent): void {
    this.emit('raw', event)
    const typed = toTypedEvent(event)
    if (typed != null) {
      ;(this.emit as (name: string, ...args: unknown[]) => boolean)(typed.name, typed.payload, typed.meta)
    }

    const sdkEvent = mapRealtimeEvent(event)
    if (sdkEvent == null) return
    const hydrate = async () => {
      switch (sdkEvent.kind) {
        case 'messageCreate':
          this.emit('messageCreate', await this.messages.fetch(sdkEvent.roomId, sdkEvent.messageEventId))
          break
        case 'messageUpdate':
          this.emit('messageUpdate', await this.messages.fetch(sdkEvent.roomId, sdkEvent.messageEventId))
          break
        case 'messageDelete':
          this.emit('messageDelete', sdkEvent.event)
          break
        case 'reactionAdd':
          this.emit('reactionAdd', sdkEvent.event)
          break
        case 'reactionRemove':
          this.emit('reactionRemove', sdkEvent.event)
          break
      }
    }
    hydrate().catch(err => {
      this.emit('error', err instanceof Error ? err : new Error(String(err)))
    })
  }

  private startReconnect(reason: CloseReason): void {
    if (this.closedByUser) return
    if (this.reconnecting) return
    this.reconnecting = true
    this.reconnectAttempt = 0
    this.attemptReconnect(reason)
  }

  private attemptReconnect(reason: CloseReason): void {
    if (this.reconnectAttempt >= this.reconnectOpts.maxAttempts) {
      this.reconnecting = false
      this.teardownPresence()
      this.emit('disconnect')
      return
    }
    const n = this.reconnectAttempt
    const raw = Math.min(
      this.reconnectOpts.baseDelayMs * this.reconnectOpts.factor ** n,
      this.reconnectOpts.maxDelayMs,
    )
    const jittered = raw / 2 + Math.random() * (raw / 2)
    const delay = Math.max(jittered, reason.retryAfterMs)
    this.reconnectAttempt = n + 1
    this.emit('reconnecting', this.reconnectAttempt, delay)
    this.reconnectTimer = setTimeout(() => {
      if (this.closedByUser) {
        this.reconnecting = false
        return
      }
      this.reconnectTimer = null
      this.doReconnect(reason).catch(err => {
        this.emit('error', err instanceof Error ? err : new Error(String(err)))
        this.attemptReconnect(reason)
      })
    }, delay)
  }

  private async doReconnect(reason: CloseReason): Promise<void> {
    if (reason.kind === 'auth' && this.store.canRefresh()) {
      await this.refreshToken()
    }
    await this.realtime.connect()
    this.scheduleProactiveRefresh()
    this.reconnecting = false
    this.reconnectAttempt = 0
  }
}
