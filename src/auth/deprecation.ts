const PASSWORD_AUTH_MESSAGE =
  'Password authentication is deprecated and unsupported in chatto.ts. ' +
  'Bot accounts cannot sign in with a password; create a bot under Server Admin → Bots ' +
  'and pass its API key as `new ChattoClient({ baseUrl, token })`. ' +
  'See https://docs.chatto.run/guides/integrations/bot-accounts/'

let warned = false

/**
 * Emits a one-time `DeprecationWarning` (code `CHATTO_TS_PASSWORD_AUTH`) the
 * first time any password-auth entry point is used in this process.
 */
export function warnPasswordAuthDeprecated(): void {
  if (warned) return
  warned = true
  if (typeof process !== 'undefined' && typeof process.emitWarning === 'function') {
    process.emitWarning(PASSWORD_AUTH_MESSAGE, { type: 'DeprecationWarning', code: 'CHATTO_TS_PASSWORD_AUTH' })
  }
}

/** Test hook: lets the one-time warning fire again. */
export function resetPasswordAuthWarning(): void {
  warned = false
}
