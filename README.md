# chatto.ts

[![npm version](https://img.shields.io/npm/v/chatto.ts?style=flat)](https://www.npmjs.com/package/chatto.ts)
[![npm downloads](https://img.shields.io/npm/dw/chatto.ts?style=flat)](https://www.npmjs.com/package/chatto.ts)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=flat)](LICENSE)
[![Publish to npm](https://img.shields.io/github/actions/workflow/status/axodouble/chatto.ts/.github%2Fworkflows%2Fpublish.yml)](https://github.com/axodouble/chatto.ts)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178c6&logo=typescript&logoColor=white?style=flat)](https://www.typescriptlang.org/)

A Chatto Typescript library to interface with a Chatto instance.
Tested against `v0.5.0` of Chatto. Chatto `0.4.x` servers are not supported by this version; use `chatto.ts@0.4` for those.

If you are looking for a `Java` SDK, [feel free to use this SDK made by a fellow developer](https://github.com/freakynit/chatto-java-sdk)!

## API

The API will be built upon the documentation that lives at [docs.chatto.run](https://docs.chatto.run/reference/connectrpc-api/).

The documentation itself is bound to change.

## Usage

You can install this easily as an NPM package, just by using either bun or npm to install it.
Use `bun i chatto.ts` or `npm i chatto.ts`.

A simple example application:

```typescript
import { ChattoClient } from "chatto.ts";

// Login to the account
const client = await ChattoClient.login({
    baseUrl: "https://chat.example.com",
    login: "<username>",
    password: "<password>"
})

// Listen for a "command"
client.on('messageCreate', async message=>{
    if(message.content?.toLowerCase().startsWith('/ping')){
        const time = Date.now()
        const msg = await message.reply('Ping...')
        await msg.edit(`Pong! API Latency is ${Date.now() - time}ms`)
    }
})

// Connect
client.connect()
```

### Bot accounts

Chatto 0.5 has [bot accounts](https://docs.chatto.run/guides/integrations/bot-accounts/). Pass the bot's API key as the token; keys do not expire and are never refreshed:

```typescript
const bot = new ChattoClient({ baseUrl: "https://chat.example.com", token: process.env.CHATTO_BOT_KEY! })
bot.on('messageCreate', async message => {
    if (message.channel.isDM && message.content === '/ping') await message.reply('pong')
})
await bot.connect()
```

A new bot has no permissions. An admin grants them per scope (for example `message.read` and `message.post` for direct messages), in the bot's **Permissions** page or through `client.admin.permissions` (see [Administration](#administration)). Bots can also be created and managed from code with `client.bots` (API keys, incoming and outbound webhooks).

### Uploading images & media

Attach files directly when sending or replying — they are uploaded to the room
and attached automatically (at most 10 attachments per message):

```typescript
const bytes = await Bun.file("cat.png").bytes() // any Uint8Array / ArrayBuffer

// Attach inline when sending, optionally with an accessibility description
await client.messages.send(roomId, {
    content: "look at this",
    files: [{ data: bytes, filename: "cat.png", contentType: "image/png", description: "A cat on a keyboard" }],
})

// Or reply with a file
client.on('messageCreate', async message => {
    if (message.content === '/cat') {
        await message.reply({ files: [{ data: bytes, filename: "cat.png", contentType: "image/png" }] })
    }
})
```

You can also upload once and reuse the asset id, or read attachments off a
message:

```typescript
const asset = await client.assets.upload(roomId, { data: bytes, filename: "cat.png", contentType: "image/png" })
await client.messages.send(roomId, { content: "reused", attachmentIds: [asset.id] })

client.on('messageCreate', message => {
    for (const attachment of message.attachments) {
        console.log(attachment.filename, attachment.url) // signed URL, may expire
    }
})
```

### Messages, reactions, threads and pins

Every send gets an idempotency key, so retrying a failed send never posts twice.

```typescript
// Start a thread together with its first message
const root = await room.send({ content: "Release checklist", createThread: true })
await root.reply("1. Bump the version")
await root.follow()

// Reactions take a Chatto reaction name or a Unicode emoji
await root.react('👍')        // sent as "thumbsup"
await root.react('wave::skin-tone-3')

await root.pin()
const pins = await room.listPins()
await room.sendTyping()
await room.markAsRead()
```

Other room features live on `Room` and `client.rooms`: members, notices, read state, suspensions (`removeUser`/`liftSuspension`), room groups, invitations (`room.invite(userId)`, `client.rooms.invitations`), and timelines including joins, leaves and calls (`room.fetchEvents()`).

### Realtime events

The client uses Chatto's realtime protocol v4. Besides the convenience events (`messageCreate`, `messageUpdate`, `messageDelete`, `reactionAdd`, `reactionRemove`), every server event is emitted under its own name with a typed payload and its envelope metadata:

```typescript
client.on('userTyping', (event, meta) => console.log(`${meta.actorId} is typing in ${event.roomId}`))
client.on('presenceChanged', (event, meta) => console.log(meta.actorId, event.status))
client.on('roomInvitationCreated', event => console.log('invited to', event.roomId))
client.on('raw', event => console.log(event.event)) // every event
```

After a short disconnect the client resumes the stream from its last position, so no events are missed. `caughtUp` reports how the stream recovered: anything other than `REALTIME_RECOVERY_RESUMED` means events may have been missed while offline.

```typescript
client.on('caughtUp', ({ recovery }) => {
    if (recovery !== 'REALTIME_RECOVERY_RESUMED') console.log('events may have been missed; refetch what you need')
})

// Receive the visible rooms, room groups, users and active calls on connect
const client = new ChattoClient({ baseUrl, token, realtime: { initialState: 'snapshot' } })
client.on('snapshot', snapshot => console.log(snapshot.rooms.length, 'rooms'))
```

### More APIs

| Property | What it covers |
| --- | --- |
| `client.account` | presence preference, custom status, password, verified emails, settings, linked identities, account deletion |
| `client.users` | directory search and paging, lookup by login, profile and avatar updates |
| `client.viewer` | the signed-in user and privileged mode |
| `client.rooms` / `client.threads` / `client.messages` | everything described above |
| `client.bots` | bots, API keys, incoming and outbound webhooks |
| `client.search` | full-text message search (`search()`, `searchAll()`) |
| `client.notifications` | notification feed, unread counts, per-room notification policies |
| `client.roles`, `client.permissions` | roles and effective permissions |
| `client.server` | server profile, message of the day, upload limits |
| `client.voice` | active calls, joining and call tokens |
| `client.push` | Web Push subscriptions |
| `client.admin` | the admin API (see below) |

Anything else can be called directly with `client.rpc(service, method, input)`.

### Setting your status

Your status is saved on the server and shown on every device. While the client is connected it sends a heartbeat every 30s, which keeps the account shown with its status; without it the account shows as offline after a minute.

```typescript
// Presence: 'online' | 'away' | 'dnd' | 'offline' (aliases: 'idle', 'invisible')
await client.setStatus('online')

// Appear offline (also hides typing indicators)
await client.setStatus('offline')

// Custom status (emoji + text, optional expiry)
await client.setCustomStatus({ emoji: '🎧', text: 'listening', expiresAt: new Date(Date.now() + 3600_000) })
await client.clearCustomStatus()
```

Disable the heartbeat if the account should never be shown as online by this client:

```typescript
const client = new ChattoClient({ baseUrl, token, presence: { autoRefresh: false } })
```

### Sessions & reconnect

`ChattoClient.login()` signs in with a password and keeps the session alive with Chatto's rotating refresh token: the client renews the token a minute before it expires and whenever the server rejects it. By default it also keeps the password as a fallback; pass `retainCredentials: false` to keep only the refresh token.

```typescript
const client = await ChattoClient.login({
    baseUrl: "https://chat.example.com",
    login: "username",
    password: "password",
    retainCredentials: false
})

// Refresh tokens rotate: persist the latest session if you want to resume it later
client.on('tokenRefresh', session => save(session.refreshToken))

// Resume a saved session later
const resumed = new ChattoClient({ baseUrl: "https://chat.example.com", token: "", refreshToken: saved })
await resumed.refreshToken()

// Sign out (revokes the session on the server)
await client.logout()
```

**Realtime reconnection:** If the websocket drops (e.g. transient network failure), the client reconnects with exponential backoff + jitter. Configure via `reconnect` options:

```typescript
const client = new ChattoClient({
    baseUrl: "https://chat.example.com",
    token: initialToken,
    reconnect: {
        baseDelayMs: 1000,     // initial delay (default)
        maxDelayMs: 30000,     // cap (default)
        factor: 2,             // exponential multiplier (default)
        maxAttempts: Infinity  // attempts before giving up (default)
    }
})

client.on('reconnecting', (attempt, delayMs) => {
    console.log(`Reconnecting (attempt ${attempt}) in ${delayMs}ms`)
})
```

### Administration

`client.admin` wraps the admin API: members, roles, permissions, invitation codes, OAuth clients, the event log, diagnostics, room layout and server configuration. Most administrative permissions are only active in privileged mode, which lasts 15 minutes:

```typescript
await client.viewer.activatePrivilegedMode()

// Create a bot and let it read and post in direct messages
const { bot, apiKey } = await client.bots.create({ login: "helper", displayName: "Helper" })
await client.admin.permissions.setUserPermission(bot.user!.id, ['message.read', 'message.post'], 'allow', 'dm')

// Invite-only registration
const code = await client.admin.invitationCodes.create({ note: "for Sam" })

await client.viewer.deactivatePrivilegedMode()
```

## Running the live tests locally

The live integration tests (`tests/integration`) can run against a disposable Chatto `v0.5.0` server in Docker instead of a real instance.
Requires Docker with Compose, `curl` and `jq`.

```bash
bun run test:server:up    # start the server on http://localhost:4000, seed it, write .env.test
bun run test:live         # run tests/integration with .env.test (your .env is left alone)
bun run test:server:down  # stop the server and delete its data
```

The seed script (`docker/seed.sh`) completes first-run setup with an owner account `sdktest` / `chatto-ts-test-password`, creates a `#sdk-tests` channel, and is safe to re-run.
All secrets in `docker/chatto.toml` are throwaway test values; do not reuse them.

I do not own nor claim any ownership of the Chatto name or brand. Chatto and similar branding is all owned by their respective owners.
I do not have any affiliation with Chatto.

- Note, most of this code is AI generated, this is because I am expecting most things to break as Chatto is still in active development. Once a first stable release is announced where breaking changes should not occur anymore I will be going over everything to reimplement and refactor the code.