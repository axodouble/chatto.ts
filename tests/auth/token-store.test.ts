import { describe, it, expect, mock } from 'bun:test'
import { TokenStore } from '../../src/auth/token-store'
import { ChattoAuthError } from '../../src/errors'

describe('TokenStore', () => {
  it('returns the initial token', () => {
    const store = new TokenStore('https://c', 'tk0')
    expect(store.getToken()).toBe('tk0')
  })

  it('canRefresh is false without credentials, true with', () => {
    expect(new TokenStore('https://c', 'tk0').canRefresh()).toBe(false)
    expect(new TokenStore('https://c', 'tk0', { login: 'u', password: 'p' }).canRefresh()).toBe(true)
  })

  it('refresh() re-logs-in, stores and returns the new token', async () => {
    const loginFn = mock(async () => ({ token: 'tk1' }))
    const store = new TokenStore('https://c', 'tk0', { login: 'u', password: 'p' }, loginFn)
    const t = await store.refresh()
    expect(t).toBe('tk1')
    expect(store.getToken()).toBe('tk1')
    expect(loginFn).toHaveBeenCalledWith('https://c', 'u', 'p')
  })

  it('refresh() without credentials rejects with ChattoAuthError', async () => {
    const store = new TokenStore('https://c', 'tk0')
    await expect(store.refresh()).rejects.toBeInstanceOf(ChattoAuthError)
  })

  it('refresh() is single-flight: concurrent calls trigger one login', async () => {
    let resolve!: (v: { token: string }) => void
    const loginFn = mock(() => new Promise<{ token: string }>(r => { resolve = r }))
    const store = new TokenStore('https://c', 'tk0', { login: 'u', password: 'p' }, loginFn)
    const a = store.refresh()
    const b = store.refresh()
    resolve({ token: 'tk1' })
    expect(await a).toBe('tk1')
    expect(await b).toBe('tk1')
    expect(loginFn).toHaveBeenCalledTimes(1)
  })

  it('refresh() can be called again after a prior refresh settles', async () => {
    let n = 0
    const loginFn = mock(async () => ({ token: `tk${++n}` }))
    const store = new TokenStore('https://c', 'tk0', { login: 'u', password: 'p' }, loginFn)
    expect(await store.refresh()).toBe('tk1')
    expect(await store.refresh()).toBe('tk2')
    expect(loginFn).toHaveBeenCalledTimes(2)
  })
})

describe('TokenStore with refresh tokens', () => {
  const session = (n: number) => ({ token: `tk${n}`, refreshToken: `rt${n}`, expiresIn: 900, refreshTokenExpiresIn: 7776000 })

  it('canRefresh with only a refresh token', () => {
    expect(new TokenStore('https://c', 'tk0', undefined, undefined, { refreshToken: 'rt0' }).canRefresh()).toBe(true)
  })

  it('rotates the refresh token and tracks expiry', async () => {
    const refreshFn = mock(async () => session(1))
    const store = new TokenStore('https://c', 'tk0', undefined, undefined, { refreshToken: 'rt0', refreshFn })
    expect(await store.refresh()).toBe('tk1')
    expect(refreshFn).toHaveBeenCalledWith('https://c', 'rt0')
    expect(store.getSession()).toMatchObject({ token: 'tk1', refreshToken: 'rt1' })
    expect(store.msUntilExpiry()).toBeGreaterThan(890_000)
    refreshFn.mockImplementation(async () => session(2))
    await store.refresh()
    expect(refreshFn).toHaveBeenLastCalledWith('https://c', 'rt1')
  })

  it('prefers the refresh token over password login', async () => {
    const loginFn = mock(async () => ({ token: 'pw' }))
    const refreshFn = mock(async () => session(1))
    const store = new TokenStore('https://c', 'tk0', { login: 'u', password: 'p' }, loginFn, { refreshToken: 'rt0', refreshFn })
    await store.refresh()
    expect(loginFn).not.toHaveBeenCalled()
  })

  it('falls back to password login when the refresh token is rejected', async () => {
    const loginFn = mock(async () => ({ token: 'pw1', refreshToken: 'rtPw', expiresIn: 900 }))
    const refreshFn = mock(async () => { throw new ChattoAuthError('invalid_grant', 'revoked') })
    const store = new TokenStore('https://c', 'tk0', { login: 'u', password: 'p' }, loginFn, { refreshToken: 'rt0', refreshFn })
    expect(await store.refresh()).toBe('pw1')
    expect(store.getSession().refreshToken).toBe('rtPw')
  })

  it('surfaces a rejected refresh token when there is no password fallback', async () => {
    const refreshFn = mock(async () => { throw new ChattoAuthError('invalid_grant', 'revoked') })
    const store = new TokenStore('https://c', 'tk0', undefined, undefined, { refreshToken: 'rt0', refreshFn })
    await expect(store.refresh()).rejects.toThrow('revoked')
  })

  it('reports unknown expiry as undefined', () => {
    expect(new TokenStore('https://c', 'tk0').msUntilExpiry()).toBeUndefined()
  })
})
