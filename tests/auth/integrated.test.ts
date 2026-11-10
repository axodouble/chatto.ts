import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test'
import { loginWithPassword, refreshSession, logout } from '../../src/auth/integrated'
import { ChattoApiError, ChattoAuthError, ChattoParseError } from '../../src/errors'

function makeResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const successBody = {
  success: true,
  token: 'cht_testtoken123',
  user: { id: 'U123', login: 'testuser' },
}

describe('loginWithPassword', () => {
  let fetchMock: ReturnType<typeof mock>
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    fetchMock = mock(async (_url: string, _opts?: RequestInit) =>
      makeResponse(200, successBody),
    )
    globalThis.fetch = fetchMock as unknown as typeof fetch
  })

  afterEach(() => {
    mock.restore()
    // mock.restore() does not undo a direct `globalThis.fetch = ...` assignment,
    // so restore it explicitly — otherwise the mock leaks into later test files.
    globalThis.fetch = originalFetch
  })

  it('POSTs to /auth/login with login and password', async () => {
    await loginWithPassword('https://chat.example.com', 'testuser', 'secret')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://chat.example.com/auth/login')
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body as string)).toEqual({ login: 'testuser', password: 'secret' })
    expect((opts.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it('returns the parsed login result on success', async () => {
    const result = await loginWithPassword('https://chat.example.com', 'testuser', 'secret')
    expect(result.token).toBe('cht_testtoken123')
    expect(result.user.id).toBe('U123')
    expect(result.user.login).toBe('testuser')
    expect(result.success).toBe(true)
  })

  it('throws ChattoApiError on non-OK response', async () => {
    fetchMock = mock(async () => makeResponse(401, { error: 'Invalid credentials' }))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    await expect(
      loginWithPassword('https://chat.example.com', 'bad', 'wrong'),
    ).rejects.toBeInstanceOf(ChattoApiError)
  })

  it('includes error message from response body in ChattoApiError', async () => {
    fetchMock = mock(async () => makeResponse(401, { error: 'Invalid credentials' }))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const err = await loginWithPassword('https://chat.example.com', 'bad', 'wrong').catch(e => e) as ChattoApiError
    expect(err.message).toBe('Invalid credentials')
    expect(err.code).toBe('unauthenticated')
  })

  it('throws ChattoParseError when response body does not match schema', async () => {
    fetchMock = mock(async () => makeResponse(200, { unexpected: true }))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    await expect(
      loginWithPassword('https://chat.example.com', 'user', 'pass'),
    ).rejects.toBeInstanceOf(ChattoParseError)
  })

  it('does not send Authorization header', async () => {
    await loginWithPassword('https://chat.example.com', 'testuser', 'secret')
    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = opts.headers as Record<string, string>
    expect(headers['Authorization']).toBeUndefined()
  })
})

describe('refreshSession', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => { globalThis.fetch = originalFetch })

  it('uses the OAuth refresh_token grant and maps the snake_case response', async () => {
    const fetchMock = mock(async () => makeResponse(200, {
      access_token: 'at2', token_type: 'Bearer', expires_in: 900, refresh_token: 'rt2', refresh_token_expires_in: 7775000,
    }))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    const session = await refreshSession('https://c', 'rt1')
    expect(session).toEqual({ token: 'at2', refreshToken: 'rt2', expiresIn: 900, refreshTokenExpiresIn: 7775000 })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://c/oauth/token')
    expect(JSON.parse(init.body as string)).toEqual({ grant_type: 'refresh_token', refresh_token: 'rt1' })
  })

  it('throws ChattoAuthError with the OAuth error code', async () => {
    globalThis.fetch = mock(async () => makeResponse(400, { error: 'invalid_grant', error_description: 'Refresh token is invalid, expired, or revoked' })) as unknown as typeof fetch
    const err = await refreshSession('https://c', 'rt1').catch(e => e)
    expect(err).toBeInstanceOf(ChattoAuthError)
    expect(err.code).toBe('invalid_grant')
  })
})

describe('logout', () => {
  const originalFetch = globalThis.fetch
  afterEach(() => { globalThis.fetch = originalFetch })

  it('posts the bearer token and refresh token to /auth/logout', async () => {
    const fetchMock = mock(async () => makeResponse(200, { success: true }))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    await logout('https://c', 'at', 'rt')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://c/auth/logout')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer at')
    expect(JSON.parse(init.body as string)).toEqual({ refreshToken: 'rt' })
  })

  it('throws when the server cannot complete logout', async () => {
    globalThis.fetch = mock(async () => makeResponse(503, { success: false, error: 'Logout could not be completed' })) as unknown as typeof fetch
    await expect(logout('https://c', 'at')).rejects.toBeInstanceOf(ChattoApiError)
  })
})
