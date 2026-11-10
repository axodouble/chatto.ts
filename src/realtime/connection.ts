import WebSocket from 'ws'
import { EventEmitter } from 'events'
import { encodeSubscribe, decodeServerFrame } from './frames'
import type {
  RealtimeCaughtUp,
  RealtimeCloseCode,
  RealtimeEvent,
  RealtimeInitialState,
  RealtimeServerFrame,
  RealtimeSnapshot,
} from './generated'

/**
 * - `auth`: credentials were rejected; refresh them before reconnecting.
 * - `retry`: transient; reconnect (after `retryAfterMs`).
 * - `fatal`: reconnecting with the same client cannot succeed.
 * - `terminated`: the server ended the user's session (e.g. logout).
 * - `clean`: closed by the user or by a server close without reconnect.
 */
export type CloseKind = 'auth' | 'retry' | 'fatal' | 'terminated' | 'clean'

export interface CloseReason {
  kind: CloseKind
  /** WebSocket close code, or 1000 when the server sent a close frame. */
  code: number
  /** Realtime close code from the server's close frame, when one was sent. */
  realtimeCode?: RealtimeCloseCode
  message?: string
  retryAfterMs: number
}

interface RealtimeConnectionEvents {
  event: [event: RealtimeEvent]
  snapshot: [snapshot: RealtimeSnapshot]
  caughtUp: [caughtUp: RealtimeCaughtUp]
  error: [err: Error]
  close: [reason: CloseReason]
}

export interface RealtimeConnectionOptions {
  /** Startup state when the stored cursor cannot be resumed. Default `LIVE_ONLY`. */
  initialState?: Exclude<RealtimeInitialState, 'REALTIME_INITIAL_STATE_UNSPECIFIED'>
  /** Reconnect when no frame arrives for this long. Default 75000 ms. */
  heartbeatTimeoutMs?: number
}

const FATAL_CLOSE_CODES = new Set([1002, 1003, 1007, 1010])

export function classifyCloseCode(code: number): CloseKind {
  if (code === 1008) return 'auth'
  if (FATAL_CLOSE_CODES.has(code)) return 'fatal'
  return 'retry'
}

export function classifyRealtimeClose(code: RealtimeCloseCode, reconnect: boolean): CloseKind {
  switch (code) {
    case 'REALTIME_CLOSE_CODE_AUTHENTICATION_REQUIRED':
    case 'REALTIME_CLOSE_CODE_SESSION_RENEWAL_REQUIRED':
      return 'auth'
    case 'REALTIME_CLOSE_CODE_SESSION_TERMINATED':
      return 'terminated'
    case 'REALTIME_CLOSE_CODE_UNSUPPORTED_PROTOCOL':
    case 'REALTIME_CLOSE_CODE_INVALID_REQUEST':
      return 'fatal'
    case 'REALTIME_CLOSE_CODE_RESYNC_REQUIRED':
    case 'REALTIME_CLOSE_CODE_PRIVILEGED_MODE_EXPIRED':
      return 'retry'
    default:
      return reconnect ? 'retry' : 'clean'
  }
}

/**
 * One Chatto realtime (protocol v4) subscription. `connect()` resolves once the
 * server reports `caught_up`. The connection keeps the latest resume cursor so
 * a later `connect()` replays events missed while disconnected (cursors expire
 * after 15 minutes; the server then falls back to `initialState`).
 */
export class RealtimeConnection extends EventEmitter<RealtimeConnectionEvents> {
  private ws: WebSocket | null = null
  private watchdog: ReturnType<typeof setInterval> | null = null
  private lastFrameAt = 0
  private userClosed = false
  private closeEmitted = false
  private _cursor: string | undefined
  private readonly initialState: RealtimeInitialState
  private readonly heartbeatTimeoutMs: number

  constructor(
    private readonly wsUrl: string,
    private readonly getToken: () => string,
    private readonly wsFactory: (url: string) => WebSocket = url => new WebSocket(url),
    options: RealtimeConnectionOptions = {},
  ) {
    super()
    this.initialState = options.initialState ?? 'REALTIME_INITIAL_STATE_LIVE_ONLY'
    this.heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 75_000
  }

  /** Latest resume cursor accepted on this connection. */
  get cursor(): string | undefined {
    return this._cursor
  }

  /** Discard the resume cursor so the next connect starts from `initialState`. */
  resetCursor(): void {
    this._cursor = undefined
  }

  connect(): Promise<void> {
    this.userClosed = false
    this.closeEmitted = false
    return new Promise((resolve, reject) => {
      let settled = false
      const settle = (fn: () => void) => {
        if (settled) return
        settled = true
        fn()
      }

      const ws = this.wsFactory(this.wsUrl)
      this.ws = ws
      ;(ws as WebSocket & { binaryType: string }).binaryType = 'nodebuffer'

      ws.once('open', () => {
        this.lastFrameAt = Date.now()
        this.startWatchdog()
        this.sendRaw(
          encodeSubscribe({
            bearerToken: this.getToken() || undefined,
            resumeCursor: this._cursor,
            initialState: this.initialState,
          }),
        )
      })

      ws.on('message', (data: Buffer) => {
        if (this.ws !== ws) return
        this.lastFrameAt = Date.now()
        let frame: RealtimeServerFrame
        try {
          frame = decodeServerFrame(data)
        } catch (err) {
          // Never advance the cursor past a frame we could not decode.
          this.emit('error', err instanceof Error ? err : new Error(String(err)))
          ws.close(1003, 'invalid realtime frame')
          return
        }

        if (frame.event != null) {
          this.emit('event', frame.event)
          if (frame.event.cursor) this._cursor = frame.event.cursor
          return
        }
        if (frame.heartbeat != null) {
          if (frame.heartbeat.cursor) this._cursor = frame.heartbeat.cursor
          return
        }
        if (frame.snapshot != null) {
          this.emit('snapshot', frame.snapshot)
          return
        }
        if (frame.caughtUp != null) {
          if (frame.caughtUp.cursor) this._cursor = frame.caughtUp.cursor
          this.emit('caughtUp', frame.caughtUp)
          settle(resolve)
          return
        }
        if (frame.close != null) {
          const { code, message, reconnect, retryAfter } = frame.close
          if (code === 'REALTIME_CLOSE_CODE_RESYNC_REQUIRED') this._cursor = undefined
          this.cleanup()
          this.emitClose({
            kind: this.userClosed ? 'clean' : classifyRealtimeClose(code, reconnect),
            code: 1000,
            realtimeCode: code,
            message,
            retryAfterMs: retryAfter ?? 0,
          })
          ws.close(1000)
          settle(() => reject(new Error(`realtime closed before caught up: ${code}${message ? ` (${message})` : ''}`)))
          return
        }
        // Unknown top-level frame: do not continue past it.
        this.emit('error', new Error('unsupported realtime frame'))
        ws.close(1003, 'unsupported realtime frame')
      })

      ws.on('error', (err: Error) => {
        settle(() => reject(err))
        this.emit('error', err)
      })

      ws.on('close', (code: number) => {
        if (this.ws === ws) this.cleanup()
        const kind = this.userClosed ? 'clean' : classifyCloseCode(code)
        this.emitClose({ kind, code, retryAfterMs: 0 })
        settle(() => reject(new Error(`socket closed before caught up (code ${code})`)))
      })
    })
  }

  disconnect(): void {
    this.userClosed = true
    this.cleanup()
    this.ws?.close(1000)
  }

  private emitClose(reason: CloseReason): void {
    if (this.closeEmitted) return
    this.closeEmitted = true
    this.emit('close', reason)
  }

  private sendRaw(data: Buffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(data)
  }

  private startWatchdog(): void {
    this.stopWatchdog()
    const checkEvery = Math.min(15_000, Math.max(1, Math.floor(this.heartbeatTimeoutMs / 5)))
    this.watchdog = setInterval(() => {
      if (Date.now() - this.lastFrameAt >= this.heartbeatTimeoutMs) this.terminate()
    }, checkEvery)
  }

  private stopWatchdog(): void {
    if (this.watchdog != null) {
      clearInterval(this.watchdog)
      this.watchdog = null
    }
  }

  private terminate(): void {
    this.stopWatchdog()
    const ws = this.ws as (WebSocket & { terminate?: () => void }) | null
    if (ws == null) return
    if (typeof ws.terminate === 'function') ws.terminate()
    else ws.close()
  }

  private cleanup(): void {
    this.stopWatchdog()
  }
}
