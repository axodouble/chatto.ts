import { EventEmitter } from 'events'
import { RestClient } from './rest/client'
import { RealtimeConnection, type CloseReason, type RealtimeConnectionOptions } from './realtime/connection'
import { mapRealtimeEvent, toTypedEvent } from './realtime/events'
import type { RealtimeEvent } from './realtime/generated'
import { ChattoContext } from './context'
import { loginWithPassword } from './auth/integrated'
import { TokenStore } from './auth/token-store'
import type { RoomManager } from './managers/rooms'
import type { MessageManager } from './managers/messages'
import type { ThreadManager } from './managers/threads'
import type { UserManager } from './managers/users'
import type { AssetManager } from './managers/assets'
import type { ChattoClientOptions, ClientEventMap, ReconnectOptions, PresenceInput, CustomStatusInput, CustomStatus } from './types'
import { ChattoAuthError } from './errors'
import { normalizePresence } from './account/presence'


export class ChattoClient extends EventEmitter<ClientEventMap> {
  readonly rooms: RoomManager
  readonly messages: MessageManager
  readonly threads: ThreadManager
  readonly users: UserManager
  readonly assets: AssetManager
  private readonly rest: RestClient
  private readonly realtime: RealtimeConnection
  private readonly ctx: ChattoContext
  private readonly store: TokenStore
  private reconnecting = false
  private reconnectAttempt = 0
  private readonly reconnectOpts: Required<ReconnectOptions>
  private refreshTimer: ReturnType<typeof setInterval> | null = null
  private closedByUser = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private presenceTimer: ReturnType<typeof setInterval> | null = null
  private currentPresence: string | null = null
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
    this.store = new TokenStore(options.baseUrl, options.token, options.credentials)
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
      this.store.canRefresh() ? async () => { await this.store.refresh() } : undefined,
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
    this.on('error', () => {})
    this.wireRealtime()

    const intervalMs = options.refresh?.intervalMs
    if (intervalMs != null && intervalMs > 0 && this.store.canRefresh()) {
      this.refreshTimer = setInterval(() => {
        this.store.refresh()
          .then(() => this.emit('tokenRefresh'))
          .catch(err => this.emit('error', err instanceof Error ? err : new Error(String(err))))
      }, intervalMs)
    }
  }

  static async login(options: { baseUrl: string; login: string; password: string }): Promise<ChattoClient> {
    const { token } = await loginWithPassword(options.baseUrl, options.login, options.password)
    return new ChattoClient({
      baseUrl: options.baseUrl,
      token,
      credentials: { login: options.login, password: options.password },
    })
  }

  async connect(): Promise<void> {
    this.closedByUser = false
    await this.realtime.connect()
    this.emit('ready')
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
    this.teardownPresence()
    this.realtime.disconnect()
    this.emit('disconnect')
  }

  async setStatus(status: PresenceInput): Promise<PresenceInput> {
    const normalized = normalizePresence(status)
    if (normalized === 'OFFLINE') {
      this.teardownPresence()
      return status
    }
    this.currentPresence = normalized
    await this.ctx.account.updatePresence(normalized, true)
    // Re-check after the await: a disconnect() or terminal close may have torn
    // presence down (and reset currentPresence to null) while we were waiting
    // on the network. Starting a fresh heartbeat here would leak an interval
    // that never gets cleared.
    if (this.presenceOpts.autoRefresh && this.currentPresence === normalized) {
      this.startPresenceHeartbeat()
    }
    return status
  }

  async setCustomStatus(input: CustomStatusInput): Promise<CustomStatus> {
    return this.ctx.account.updateCustomStatus(input)
  }

  async clearCustomStatus(): Promise<void> {
    await this.ctx.account.deleteCustomStatus()
  }

  private startPresenceHeartbeat(): void {
    this.stopPresenceHeartbeat()
    this.presenceTimer = setInterval(() => {
      const status = this.currentPresence
      if (status == null) return
      this.ctx.account.updatePresence(status, true).catch(err => {
        this.emit('error', err instanceof Error ? err : new Error(String(err)))
      })
    }, this.presenceOpts.intervalMs)
  }

  private stopPresenceHeartbeat(): void {
    if (this.presenceTimer != null) {
      clearInterval(this.presenceTimer)
      this.presenceTimer = null
    }
  }

  // Called from every terminal shutdown path (user disconnect(), clean/fatal
  // close, auth close with no refreshable credentials, reconnect give-up)
  // so the heartbeat can never keep firing after the client has given up.
  private teardownPresence(): void {
    this.stopPresenceHeartbeat()
    this.currentPresence = null
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
      await this.store.refresh()
      this.emit('tokenRefresh')
    }
    await this.realtime.connect()
    this.reconnecting = false
    this.reconnectAttempt = 0
  }
}
