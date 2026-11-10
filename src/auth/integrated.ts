import { z } from 'zod'
import { ChattoApiError, ChattoAuthError, ChattoParseError } from '../errors'
import { warnPasswordAuthDeprecated } from './deprecation'

const LoginResponseSchema = z.object({
  success: z.boolean(),
  /** Short-lived bearer access token (15 minutes by default on Chatto 0.5). */
  token: z.string(),
  /** Rotating refresh token for `refreshSession` (Chatto 0.5+). */
  refreshToken: z.string().optional(),
  /** Access-token lifetime in seconds. */
  expiresIn: z.number().optional(),
  /** Remaining lifetime of the renewable session in seconds. */
  refreshTokenExpiresIn: z.number().optional(),
  user: z.object({
    id: z.string(),
    login: z.string(),
  }),
})

/** @deprecated Password authentication is unsupported. Use a bot API key. */
export type LoginResult = z.infer<typeof LoginResponseSchema>

/**
 * A renewed bearer session. Store the new `refreshToken`: the old one is now spent.
 * @deprecated Password sessions are unsupported. Bot API keys never need renewal.
 */
export interface RefreshedSession {
  token: string
  refreshToken: string
  /** Access-token lifetime in seconds. */
  expiresIn: number
  /** Remaining lifetime of the renewable session in seconds. */
  refreshTokenExpiresIn: number
}

const RefreshResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(),
  refresh_token_expires_in: z.number(),
})

/**
 * Sign in with a login (username or email) and password via `POST /auth/login`.
 *
 * @deprecated Password authentication is unsupported; bot accounts cannot use it. Create a bot under Server Admin → Bots and pass its API key as `new ChattoClient({ baseUrl, token })`.
 */
export async function loginWithPassword(
  baseUrl: string,
  login: string,
  password: string,
): Promise<LoginResult> {
  warnPasswordAuthDeprecated()
  const res = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password }),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>
    throw new ChattoApiError(
      'unauthenticated',
      typeof body['error'] === 'string' ? body['error'] : res.statusText,
      body,
    )
  }

  const body = await res.json()
  const parsed = LoginResponseSchema.safeParse(body)
  if (!parsed.success) {
    throw new ChattoParseError(parsed.error.issues, body)
  }
  return parsed.data
}

/**
 * Rotate a bearer session with the OAuth `refresh_token` grant (`POST /oauth/token`).
 * Each refresh token is single-use: reusing a spent one revokes the session.
 *
 * @deprecated Refresh tokens only come from password sign-in, which is unsupported.
 */
export async function refreshSession(baseUrl: string, refreshToken: string): Promise<RefreshedSession> {
  const res = await fetch(`${baseUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  })
  const body = await res.json().catch(() => ({})) as Record<string, unknown>
  if (!res.ok) {
    const code = typeof body['error'] === 'string' ? body['error'] : 'refresh_failed'
    const message = typeof body['error_description'] === 'string' ? body['error_description'] : res.statusText
    throw new ChattoAuthError(code, message)
  }
  const parsed = RefreshResponseSchema.safeParse(body)
  if (!parsed.success) throw new ChattoParseError(parsed.error.issues, body)
  return {
    token: parsed.data.access_token,
    refreshToken: parsed.data.refresh_token,
    expiresIn: parsed.data.expires_in,
    refreshTokenExpiresIn: parsed.data.refresh_token_expires_in,
  }
}

/**
 * Revoke a bearer session via `POST /auth/logout`. Revokes the access token and,
 * when given, the refresh token; the server then ends the user's realtime sessions.
 *
 * @deprecated Only applies to password sessions, which are unsupported. Revoke a
 * bot API key with `client.bots.revokeApiKey()` instead.
 */
export async function logout(baseUrl: string, token: string, refreshToken?: string): Promise<void> {
  const res = await fetch(`${baseUrl}/auth/logout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(refreshToken != null ? { refreshToken } : {}),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as Record<string, unknown>
    throw new ChattoApiError('logout_failed', typeof body['error'] === 'string' ? body['error'] : res.statusText, body)
  }
}
