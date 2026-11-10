/**
 * Provisions the bot accounts the live tests run as. Called by docker/seed.sh;
 * prints KEY=VALUE lines for .env.test on stdout. Safe to re-run: existing bots
 * are reused and get a fresh key (their previous seed keys are revoked).
 *
 * TEST-ONLY. The owner signs in with a password because creating bots and
 * granting permissions needs a human admin in privileged mode.
 */
import { ChattoClient } from '../src/index'

const baseUrl = process.env.CHATTO_BASE_URL!
const login = process.env.CHATTO_LOGIN!
const password = process.env.CHATTO_PASSWORD!
const roomId = process.env.CHATTO_TEST_ROOM!
const KEY_NAME = 'live-tests'

// What a bot needs to run the example command bot in the test room.
const ROOM_PERMISSIONS = ['message.read', 'message.post', 'message.react', 'message.attach']

const BOTS = [
  { env: 'CHATTO_BOT_TOKEN', login: 'sdkbot', displayName: 'SDK Bot' },
  { env: 'CHATTO_DRIVER_TOKEN', login: 'sdkdriver', displayName: 'SDK Driver' },
]

// Seeding legitimately uses the deprecated password login; keep stderr quiet.
process.removeAllListeners('warning')

const owner = await ChattoClient.login({ baseUrl, login, password, retainCredentials: false })
await owner.viewer.activatePrivilegedMode()
try {
  for (const spec of BOTS) {
    const existing = (await owner.bots.list({ search: spec.login, limit: 100 })).items.find(b => b.user.login === spec.login)
    let botId: string
    let apiKey: string
    if (existing == null) {
      const created = await owner.bots.create({ login: spec.login, displayName: spec.displayName, apiKeyName: KEY_NAME })
      botId = created.bot.user.id
      apiKey = created.apiKey
      console.error(`seed: created bot @${spec.login} (${botId})`)
    } else {
      botId = existing.user.id
      for (const key of existing.apiKeys) {
        if (key.name === KEY_NAME) await owner.bots.revokeApiKey(botId, key.id)
      }
      apiKey = (await owner.bots.createApiKey(botId, KEY_NAME)).apiKey
      console.error(`seed: reusing bot @${spec.login} (${botId}), issued a new key`)
    }
    await owner.rooms.addMember(roomId, botId).catch(err => {
      if (err?.code !== 'already_exists') throw err
    })
    await owner.admin.permissions.setUserPermission(botId, ROOM_PERMISSIONS, 'allow', { roomId })
    console.log(`${spec.env}=${apiKey}`)
  }
} finally {
  await owner.viewer.deactivatePrivilegedMode().catch(() => {})
  await owner.logout().catch(() => {})
}
