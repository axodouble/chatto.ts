/**
 * A command bot showing replies, edits, reactions, uploads and threads.
 *
 *   CHATTO_BASE_URL=https://chat.example.com CHATTO_BOT_TOKEN=cht_BK_... bun examples/command-bot/main.ts
 *
 * Optional: CHATTO_PREFIX (default "!").
 */
import { ChattoClient } from 'chatto.ts'
import { createCommandBot } from './bot'

const baseUrl = process.env.CHATTO_BASE_URL
const token = process.env.CHATTO_BOT_TOKEN
if (!baseUrl || !token) {
  console.error('Set CHATTO_BASE_URL and CHATTO_BOT_TOKEN')
  process.exit(1)
}

const client = new ChattoClient({ baseUrl, token })

client.on('error', err => console.error('[command-bot] error:', err.message))
client.on('reconnecting', (attempt, delayMs) => console.warn(`[command-bot] reconnecting (#${attempt}) in ${Math.round(delayMs)}ms`))
// 'disconnect' after a revoked key or a fatal close: nothing more will arrive.
client.on('disconnect', () => console.warn('[command-bot] disconnected'))

const bot = await createCommandBot(client, {
  prefix: process.env.CHATTO_PREFIX ?? '!',
  onError: (err, message) => console.error(`[command-bot] command failed in ${message.channelId}:`, err),
})

await client.connect()
await client.setStatus('online')
console.log(`[command-bot] ready as ${bot.self.displayName} (${bot.self.id}), ${bot.commands.size} commands`)

let shuttingDown = false
const shutdown = async () => {
  if (shuttingDown) return
  shuttingDown = true
  await bot.stop()
  await client.disconnect()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
