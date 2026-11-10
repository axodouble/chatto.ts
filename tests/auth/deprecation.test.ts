import { describe, it, expect, spyOn, afterEach, beforeEach } from 'bun:test'
import { ChattoClient } from '../../src/client'
import { loginWithPassword } from '../../src/auth/integrated'
import { resetPasswordAuthWarning } from '../../src/auth/deprecation'
import type { RealtimeConnection } from '../../src/realtime/connection'

const fakeRt = () => ({ on() {}, connect: async () => {}, disconnect() {} }) as unknown as RealtimeConnection

function passwordAuthWarnings(spy: ReturnType<typeof spyOn>): unknown[] {
  return spy.mock.calls.filter(c => (c[1] as { code?: string } | undefined)?.code === 'CHATTO_TS_PASSWORD_AUTH')
}

describe('password auth deprecation', () => {
  let warnSpy: ReturnType<typeof spyOn>
  beforeEach(() => {
    resetPasswordAuthWarning()
    warnSpy = spyOn(process, 'emitWarning').mockImplementation(() => {})
  })
  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('does not warn for token-only (bot) clients', () => {
    new ChattoClient({ baseUrl: 'https://c', token: 'cht_BK_x' }, fakeRt)
    expect(passwordAuthWarnings(warnSpy)).toHaveLength(0)
  })

  it('warns once when credentials are passed to the constructor', () => {
    new ChattoClient({ baseUrl: 'https://c', token: 't', credentials: { login: 'u', password: 'p' } }, fakeRt)
    new ChattoClient({ baseUrl: 'https://c', token: 't', credentials: { login: 'u', password: 'p' } }, fakeRt)
    const calls = passwordAuthWarnings(warnSpy)
    expect(calls).toHaveLength(1)
    expect((calls[0] as unknown[])[1]).toMatchObject({ type: 'DeprecationWarning' })
  })

  it('warns when a refresh token is passed to the constructor', () => {
    new ChattoClient({ baseUrl: 'https://c', token: 't', refreshToken: 'r' }, fakeRt)
    expect(passwordAuthWarnings(warnSpy)).toHaveLength(1)
  })

  it('warns when loginWithPassword is called', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(async () => ({
      ok: true, status: 200, statusText: 'OK',
      json: async () => ({ success: true, token: 'tk', user: { id: 'U1', login: 'u' } }),
    }) as Response)
    try {
      await loginWithPassword('https://c', 'u', 'p')
      expect(passwordAuthWarnings(warnSpy)).toHaveLength(1)
    } finally {
      fetchSpy.mockRestore()
    }
  })
})
