import { loginWithPassword, refreshSession, type RefreshedSession } from './integrated'
import { ChattoAuthError } from '../errors'

export interface StoredCredentials {
  login: string
  password: string
}

export type LoginFn = (
  baseUrl: string,
  login: string,
  password: string,
) => Promise<{ token: string; refreshToken?: string; expiresIn?: number }>

export type RefreshFn = (baseUrl: string, refreshToken: string) => Promise<RefreshedSession>

/**
 * Current bearer session, as reported by `client.on('tokenRefresh', session => ...)`.
 * @deprecated Password sessions are unsupported. Bot API keys never need renewal.
 */
export interface SessionTokens {
  token: string
  refreshToken?: string
  /** Access-token expiry (epoch ms), when known. */
  expiresAt?: number
}

export interface TokenStoreOptions {
  refreshToken?: string
  /** Access-token expiry (epoch ms). */
  expiresAt?: number
  refreshFn?: RefreshFn
}

/**
 * Holds the bearer token and renews it: first with the rotating refresh token
 * (Chatto 0.5 sessions), then by password re-login when credentials were retained.
 */
export class TokenStore {
  private inFlight: Promise<string> | null = null
  private refreshToken: string | undefined
  private expiresAt: number | undefined
  private readonly refreshFn: RefreshFn

  constructor(
    private readonly baseUrl: string,
    private token: string,
    private readonly credentials?: StoredCredentials,
    private readonly loginFn: LoginFn = loginWithPassword,
    options: TokenStoreOptions = {},
  ) {
    this.refreshToken = options.refreshToken
    this.expiresAt = options.expiresAt
    this.refreshFn = options.refreshFn ?? refreshSession
  }

  getToken(): string {
    return this.token
  }

  getSession(): SessionTokens {
    return { token: this.token, refreshToken: this.refreshToken, expiresAt: this.expiresAt }
  }

  /** Milliseconds until the access token expires, or undefined when unknown. */
  msUntilExpiry(now = Date.now()): number | undefined {
    return this.expiresAt == null ? undefined : this.expiresAt - now
  }

  canRefresh(): boolean {
    return this.refreshToken != null || this.credentials != null
  }

  refresh(): Promise<string> {
    if (this.inFlight != null) return this.inFlight
    if (!this.canRefresh()) {
      return Promise.reject(
        new ChattoAuthError('no_credentials', 'Cannot refresh token: no refresh token or credentials retained'),
      )
    }
    this.inFlight = this.doRefresh().finally(() => {
      this.inFlight = null
    })
    return this.inFlight
  }

  private async doRefresh(): Promise<string> {
    if (this.refreshToken != null) {
      try {
        const session = await this.refreshFn(this.baseUrl, this.refreshToken)
        this.apply(session.token, session.refreshToken, session.expiresIn)
        return session.token
      } catch (err) {
        // A rejected refresh token is spent; fall back to the password if we have it.
        if (this.credentials == null) throw err
        this.refreshToken = undefined
      }
    }
    const creds = this.credentials!
    const result = await this.loginFn(this.baseUrl, creds.login, creds.password)
    this.apply(result.token, result.refreshToken, result.expiresIn)
    return result.token
  }

  private apply(token: string, refreshToken: string | undefined, expiresInSeconds: number | undefined): void {
    this.token = token
    this.refreshToken = refreshToken
    this.expiresAt = expiresInSeconds != null ? Date.now() + expiresInSeconds * 1000 : undefined
  }
}
