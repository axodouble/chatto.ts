/**
 * The smallest useful bot: replies to `/ping` with the round-trip latency.
 *
 *   CHATTO_BASE_URL=https://chat.example.com CHATTO_BOT_TOKEN=cht_BK_... bun examples/ping-bot.ts
 */
import { ChattoClient } from 'chatto.ts'

const baseUrl = process.env.CHATTO_BASE_URL
const token = process.env.CHATTO_BOT_TOKEN
if (!baseUrl || !token) {
  console.error('Set CHATTO_BASE_URL and CHATTO_BOT_TOKEN')
  process.exit(1)
}

const client = new ChattoClient({ baseUrl, token })

// Learn our own id so we never answer our own messages.
const self = (await client.viewer.fetch()).user.profile!

client.on('messageCreate', async message => {
  if (message.actorId === self.id) return
  if (message.content?.trim().toLowerCase() !== '/ping') return

  const started = Date.now()
  const reply = await message.reply('Ping...')
  await reply.edit(`Pong! API latency is ${Date.now() - started}ms`)
})

client.on('error', err => console.error('[ping-bot]', err))

await client.connect()
console.log(`[ping-bot] connected as ${self.displayName} (${self.id})`)

process.on('SIGINT', () => {
  void client.disconnect().then(() => process.exit(0))
})
