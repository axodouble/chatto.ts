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

### Authentication

chatto.ts is built for [bot accounts](https://docs.chatto.run/guides/integrations/bot-accounts/). Have a server admin create one under **Server Admin → Bots → Create Bot** and copy its API key (`cht_BK_…`); Chatto shows it only once. Keys do not expire; revoking one closes the bot's connections immediately.

A new bot has no permissions. Add it to the rooms it should work in and grant it what it needs there, in the bot's **Permissions** page or through `client.admin.permissions` (see [Administration](#administration)). A bot that reads and answers messages, reacts and uploads files needs `message.read`, `message.post`, `message.react` and `message.attach`.

A simple example application:

```typescript
import { ChattoClient } from "chatto.ts";

// Authenticate with the bot's API key
const client = new ChattoClient({
    baseUrl: "https://chat.example.com",
    token: process.env.CHATTO_BOT_TOKEN! // cht_BK_...
})

// Learn the bot's own user so it never answers itself
const self = (await client.viewer.fetch()).user.profile!

// Listen for a "command"
client.on('messageCreate', async message=>{
    if(message.actorId === self.id) return
    if(message.content?.toLowerCase().startsWith('/ping')){
        const time = Date.now()
        const msg = await message.reply('Ping...')
        await msg.edit(`Pong! API Latency is ${Date.now() - time}ms`)
    }
})

// Connect
client.connect()
```

Bots can also be created and managed from code with `client.bots` (API keys, incoming and outbound webhooks). Some account features are human-only: a bot cannot set a custom status or enter privileged mode.

### Examples

The [`examples/`](examples/) directory has runnable bots:

- [`ping-bot.ts`](examples/ping-bot.ts): the example above.
- [`command-bot/`](examples/command-bot/): a prefix command router with replies, edits, reactions, image uploads and threads.

```sh
CHATTO_BASE_URL=https://chat.example.com CHATTO_BOT_TOKEN=cht_BK_... bun run example:commands
```

The command bot doubles as a test: `bun test` runs it against an in-memory fake server, and `bun run test:live` runs it on a real server, driven by a second bot (see [Running the live tests locally](#running-the-live-tests-locally)).

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

// Custom status (emoji + text, optional expiry). Human accounts only.
await client.setCustomStatus({ emoji: '🎧', text: 'listening', expiresAt: new Date(Date.now() + 3600_000) })
await client.clearCustomStatus()
```

Disable the heartbeat if the account should never be shown as online by this client:

```typescript
const client = new ChattoClient({ baseUrl, token, presence: { autoRefresh: false } })
```

### Password authentication (deprecated, unsupported)

Password sign-in is deprecated and unsupported, and will be removed in a future release. Bot accounts cannot use it. This covers `ChattoClient.login()`, `loginWithPassword()`, `refreshSession()`, `logout()`, the `credentials`, `refreshToken`, `tokenExpiresAt` and `refresh` client options, `client.session`, `client.refreshToken()`, `client.logout()` and the `tokenRefresh` event. Using them emits a one-time `DeprecationWarning` (code `CHATTO_TS_PASSWORD_AUTH`).

For reference, `ChattoClient.login()` signs in with a password and keeps the session alive with Chatto's rotating refresh token: the client renews the token a minute before it expires and whenever the server rejects it. By default it also keeps the password as a fallback; pass `retainCredentials: false` to keep only the refresh token.

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

### Reconnect

If the websocket drops (e.g. transient network failure), the client reconnects with exponential backoff + jitter. Configure via `reconnect` options:

```typescript
const client = new ChattoClient({
    baseUrl: "https://chat.example.com",
    token: process.env.CHATTO_BOT_TOKEN!,
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

If the bot's key is revoked, the client does not retry: it emits a `ChattoAuthError` ("the token is invalid or was revoked") followed by `disconnect`.

### Administration

`client.admin` wraps the admin API: members, roles, permissions, invitation codes, OAuth clients, the event log, diagnostics, room layout and server configuration. Most administrative permissions are only active in privileged mode, which lasts 15 minutes. Privileged mode is for human admin accounts; bots cannot enter it.

```typescript
await client.viewer.activatePrivilegedMode()

// Create a bot and let it work in one room
const { bot, apiKey } = await client.bots.create({ login: "helper", displayName: "Helper" })
await client.rooms.addMember(roomId, bot.user.id)
await client.admin.permissions.setUserPermission(bot.user.id, ['message.read', 'message.post', 'message.react', 'message.attach'], 'allow', { roomId })

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

The seed script (`docker/seed.sh`) completes first-run setup with an owner account `sdktest` / `chatto-ts-test-password`, creates a `#sdk-tests` channel, and creates two bots in it (`docker/seed-bots.ts`): `sdkbot`, which most live tests and the example command bot run as, and `sdkdriver`, which sends the example bot its commands. Their keys go into `.env.test` as `CHATTO_BOT_TOKEN` and `CHATTO_DRIVER_TOKEN`. The script is safe to re-run; each run issues fresh keys and revokes the previous ones. The owner account is only used to provision the server and for the tests of human-only features.
All secrets in `docker/chatto.toml` are throwaway test values; do not reuse them.

I do not own nor claim any ownership of the Chatto name or brand. Chatto and similar branding is all owned by their respective owners.
I do not have any affiliation with Chatto.

- Note, most of this code is AI generated, this is because I am expecting most things to break as Chatto is still in active development. Once a first stable release is announced where breaking changes should not occur anymore I will be going over everything to reimplement and refactor the code.