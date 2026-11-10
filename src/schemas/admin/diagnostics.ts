import { z } from 'zod'

// int64 fields arrive as JSON strings → numbers; fields the proto declares as
// `string` (stream sequences, worker counters) stay strings.
const int64 = () => z.coerce.number().default(0)
const int32 = () => z.number().default(0)
const str = () => z.string().default('')

export const AdminLiveKitConnectionStateSchema = z
  .enum([
    'ADMIN_LIVE_KIT_CONNECTION_STATE_UNSPECIFIED',
    'ADMIN_LIVE_KIT_CONNECTION_STATE_NOT_CONFIGURED',
    'ADMIN_LIVE_KIT_CONNECTION_STATE_OK',
    'ADMIN_LIVE_KIT_CONNECTION_STATE_UNREACHABLE',
    'ADMIN_LIVE_KIT_CONNECTION_STATE_UNAUTHORIZED',
    'ADMIN_LIVE_KIT_CONNECTION_STATE_ERROR',
  ])
  .catch('ADMIN_LIVE_KIT_CONNECTION_STATE_UNSPECIFIED')
  .default('ADMIN_LIVE_KIT_CONNECTION_STATE_UNSPECIFIED')

export const AdminDurableWorkerHealthSchema = z
  .enum([
    'ADMIN_DURABLE_WORKER_HEALTH_UNSPECIFIED',
    'ADMIN_DURABLE_WORKER_HEALTH_INACTIVE',
    'ADMIN_DURABLE_WORKER_HEALTH_HEALTHY',
    'ADMIN_DURABLE_WORKER_HEALTH_WORKING',
    'ADMIN_DURABLE_WORKER_HEALTH_UNCONFIRMED',
    'ADMIN_DURABLE_WORKER_HEALTH_STALLED',
    'ADMIN_DURABLE_WORKER_HEALTH_UNAVAILABLE',
  ])
  .catch('ADMIN_DURABLE_WORKER_HEALTH_UNSPECIFIED')
  .default('ADMIN_DURABLE_WORKER_HEALTH_UNSPECIFIED')

export const AdminAssetCleanupHealthSchema = z
  .enum([
    'ADMIN_ASSET_CLEANUP_HEALTH_UNSPECIFIED',
    'ADMIN_ASSET_CLEANUP_HEALTH_INACTIVE',
    'ADMIN_ASSET_CLEANUP_HEALTH_INITIALIZING',
    'ADMIN_ASSET_CLEANUP_HEALTH_HEALTHY',
    'ADMIN_ASSET_CLEANUP_HEALTH_RETRYING',
    'ADMIN_ASSET_CLEANUP_HEALTH_STALLED',
    'ADMIN_ASSET_CLEANUP_HEALTH_UNAVAILABLE',
  ])
  .catch('ADMIN_ASSET_CLEANUP_HEALTH_UNSPECIFIED')
  .default('ADMIN_ASSET_CLEANUP_HEALTH_UNSPECIFIED')

/** LiveKit setup as seen by the Chatto node that handled the request. Never contains secrets. */
export const AdminLiveKitStatusSchema = z.object({
  enabled: z.boolean().default(false),
  configured: z.boolean().default(false),
  url: str(),
  /** API key identifier (not a secret). */
  apiKey: str(),
  separateWebhookKey: z.boolean().default(false),
  /** URL LiveKit must send webhooks to; empty without a public server URL. */
  webhookUrl: str(),
  connectionState: AdminLiveKitConnectionStateSchema,
  connectionError: str(),
  insecureUrl: z.boolean().default(false),
  lastWebhookAt: z.string().optional(),
  lastRejectedWebhookAt: z.string().optional(),
})

export const AdminDurableWorkerStatusSchema = z.object({
  key: str(),
  health: AdminDurableWorkerHealthSchema,
  pendingCount: str(),
  ackPendingCount: str(),
  waitingCount: str(),
  redeliveredCount: str(),
  lastDeliveredSequence: str(),
  ackFloorSequence: str(),
})

export const AdminAssetCleanupStatusSchema = z.object({
  health: AdminAssetCleanupHealthSchema,
  pendingCount: int64(),
  lastInspectedSequence: str(),
  latestDeletionSequence: str(),
})

export const AdminConnectionInfoSchema = z.object({
  connected: z.boolean().default(false),
  serverId: str(),
  serverName: str(),
  version: str(),
  maxPayload: int64(),
  /** Round-trip latency, e.g. `"5.6µs"`. */
  rtt: str(),
})

/** JetStream account limits; limits <= 0 mean unlimited. */
export const AdminAccountInfoSchema = z.object({
  memory: int64(),
  memoryUsed: int64(),
  storage: int64(),
  storageUsed: int64(),
  streams: int32(),
  streamsUsed: int32(),
  consumers: int32(),
  consumersUsed: int32(),
})

export const AdminServerStatsSchema = z.object({
  userCount: int32(),
  channelRoomCount: int32(),
  dmRoomCount: int32(),
})

export const AdminNatsStreamInfoSchema = z.object({
  name: str(),
  description: str(),
  subjects: z.array(z.string()).default([]),
  storage: str(),
  messages: int64(),
  bytes: int64(),
  firstSequence: str(),
  lastSequence: str(),
  consumerCount: int32(),
  replicas: int32(),
  clusterLeader: str(),
})

export const AdminNatsConsumerInfoSchema = z.object({
  stream: str(),
  name: str(),
  durable: str(),
  filterSubject: str(),
  filterSubjects: z.array(z.string()).default([]),
  ackPolicy: str(),
  pullBased: z.boolean().default(false),
  pushBound: z.boolean().default(false),
  pending: int64(),
  ackPending: int32(),
  redelivered: int32(),
  waiting: int32(),
  deliveredConsumerSequence: str(),
  deliveredStreamSequence: str(),
  ackFloorConsumerSequence: str(),
  ackFloorStreamSequence: str(),
})

export const AdminNatsStatsSchema = z.object({
  totalMessages: int64(),
  totalBytes: int64(),
  totalConsumerPending: int64(),
  totalAckPending: int32(),
  streams: z.array(AdminNatsStreamInfoSchema).default([]),
  consumers: z.array(AdminNatsConsumerInfoSchema).default([]),
})

export const AdminSystemInfoSchema = z.object({
  connection: AdminConnectionInfoSchema.prefault({}),
  account: AdminAccountInfoSchema.prefault({}),
  nats: AdminNatsStatsSchema.prefault({}),
  stats: AdminServerStatsSchema.prefault({}),
})

export const AdminProjectionMetricSchema = z.object({
  name: str(),
  value: int64(),
  bytes: int64(),
})

export const AdminProjectionStateSchema = z.object({
  key: str(),
  name: str(),
  subjects: z.array(z.string()).default([]),
  started: z.boolean().default(false),
  /** Set after startup completes. */
  startupDurationSeconds: z.number().optional(),
  lastAppliedSequence: str(),
  matchingStreamSequence: str(),
  streamLastSequence: str(),
  lag: int64(),
  failed: z.boolean().default(false),
  failedSequence: str(),
  failure: str(),
  entryCount: int64(),
  estimatedBytes: int64(),
  averageEntryBytes: int64(),
  metrics: z.array(AdminProjectionMetricSchema).default([]),
})

export const GetSystemInfoResponseSchema = z.object({
  systemInfo: AdminSystemInfoSchema.prefault({}),
  projections: z.array(AdminProjectionStateSchema).default([]),
  assetCleanup: AdminAssetCleanupStatusSchema.prefault({}),
  durableWorkers: z.array(AdminDurableWorkerStatusSchema).default([]),
  /** Whether projection diagnostics were collected; absent on older servers. */
  projectionsAvailable: z.boolean().optional(),
  livekit: AdminLiveKitStatusSchema.prefault({}),
})

/** Owner-only server diagnostics (broker, JetStream, projections, workers, LiveKit). */
export type AdminSystemInfoReport = z.infer<typeof GetSystemInfoResponseSchema>
export type AdminSystemInfo = z.infer<typeof AdminSystemInfoSchema>
export type AdminProjectionState = z.infer<typeof AdminProjectionStateSchema>
export type AdminDurableWorkerStatus = z.infer<typeof AdminDurableWorkerStatusSchema>
export type AdminAssetCleanupStatus = z.infer<typeof AdminAssetCleanupStatusSchema>
export type AdminLiveKitStatus = z.infer<typeof AdminLiveKitStatusSchema>
export type AdminNatsStreamInfo = z.infer<typeof AdminNatsStreamInfoSchema>
export type AdminNatsConsumerInfo = z.infer<typeof AdminNatsConsumerInfoSchema>
