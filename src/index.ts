export { ChattoClient } from './client'
export { MessageBuilder } from './builders/message'
export { loginWithPassword, refreshSession, logout } from './auth/integrated'
export { ChattoApiError, ChattoParseError, ChattoValidationError, ChattoAuthError } from './errors'
export type { Message } from './resources/message'
export type { Room } from './resources/room'
export type { User } from './resources/user'
export type { Attachment } from './resources/attachment'
export type { MessagePayload } from './builders/payload'
export type { LoginResult, RefreshedSession } from './auth/integrated'
export type { SessionTokens } from './auth/token-store'
export { REALTIME_EVENT_NAMES } from './realtime/generated'
export type * from './realtime/generated'
export type { RealtimeEventMeta, RealtimeEventName, TypedRealtimeEvent } from './realtime/events'
export type { CloseKind, CloseReason } from './realtime/connection'
export type {
  MessageData,
  RoomData,
  CreateMessageInput,
  UpdateMessageInput,
  MessageDeleteEvent,
  ReactionEvent,
  ChattoClientOptions,
  ClientEventMap,
  ReconnectOptions,
  RefreshOptions,
  UserData,
  DirectoryMemberData,
  AssetData,
  MessageAttachmentData,
  AssetUploadData,
  VideoProcessingData,
  FileInput,
  ThumbnailOptions,
  PresenceInput,
  CustomStatusInput,
  CustomStatus,
  PresenceOptions,
  RealtimeOptions,
  RealtimeEventMap,
} from './types'

// Account, users, viewer, permissions, roles, server, voice, push
export type { AccountManager, UpdateSettingsInput, ExpectedUserOptions } from './managers/account'
export type { UserManager, ListUsersOptions, UpdateUserProfileInput } from './managers/users'
export type { ViewerManager } from './managers/viewer'
export type { PermissionManager } from './managers/permissions'
export type { RoleManager } from './managers/roles'
export type { ServerManager } from './managers/server'
export type { VoiceCallManager, CallMediaPublisherKindInput } from './managers/voice'
export type { PushNotificationManager, WebPushSubscription, PushSubscribeOptions } from './managers/push'
export type { PresenceStatusInput } from './account/presence'
export type {
  UserSettings,
  TimeFormat,
  VerifiedEmail,
  PresencePreference,
  ProviderMetadata,
  ExternalIdentityProvider,
  LinkedExternalIdentity,
  ExternalIdentities,
  AccountActions,
} from './schemas/account'
export type { Viewer, ViewerUser, ViewerCapabilities, PrivilegedModeState, PrivilegedModeResult } from './schemas/viewer'
export type { CapabilityGrant, EffectivePermission, EffectivePermissionScope } from './schemas/permission'
export type { Role } from './schemas/role'
export type { ServerProfile, ServerRuntimeConfig } from './schemas/server'
export type { RoomSummary, ActiveCall, CallParticipant, CallToken, CallMediaPublisherKind } from './schemas/voice'
export type { Page, PageOptions } from './util/page'

// Rooms, room directory, invitations
export { timelineEventKind, ROOM_TIMELINE_EVENT_KINDS } from './schemas/room'
export type { RoomManager } from './managers/rooms'
export type { RoomInvitationManager, ListRoomInvitationsOptions } from './managers/room-invitations'
export type {
  CreateRoomInput,
  UpdateRoomInput,
  FetchEventsOptions,
  ListMembersOptions,
  ListRoomsOptions,
  ListSuspensionsOptions,
  PinnedMessagesPage,
  PublishNoticeOptions,
  RemoveUserOptions,
  RoomAttachment,
  MemberPresenceInput,
  RoomArchiveFilterInput,
  RoomScopeInput,
  ThreadingModeInput,
} from './managers/rooms'
export type {
  PermissionGrant,
  RoomArchiveFilter,
  RoomDirectoryScope,
  RoomGroup,
  RoomGroupItem,
  RoomKind,
  RoomThreadingMode,
  RoomTimelineEvent,
  RoomTimelineEventKind,
  RoomTimelinePage,
  RoomViewerState,
  RoomWithViewerState,
  SidebarLink,
} from './schemas/room'
export type { MarkRoomAsReadResult, ReadMarker, RoomAttachmentListItem, RoomNotice, RoomReadState, RoomSuspension } from './schemas/room-service'
export type { RoomInvitation, RoomInvitationStatus } from './schemas/room-invitation'

// Messages and threads
export { toReactionName } from './util/emoji'
export type { MessageManager } from './managers/messages'
export type { ThreadManager, ThreadEventsPage, ThreadEventsWindow, FollowedThread, ListFollowedThreadsOptions, ThreadTarget } from './managers/threads'
export type { MessageOptions, MessageFileInput, MessageEditPayload } from './builders/payload'
export type { PendingFile } from './builders/message'
export type {
  LinkPreview,
  SocialPostPreview,
  ThreadSummary,
  ThreadViewerState,
  MessageViewerState,
  MessageAttachmentDescriptionInput,
  FetchLinkPreviewResult,
  AddReactionResult,
  RemoveReactionResult,
} from './schemas/message'
export type { ThreadFollowState, ThreadReadState, MarkThreadAsReadResult, ThreadRootAuthorFilter, ThreadOrder } from './schemas/thread'

// Bots, message search, notifications
export type { BotManager, ListBotsOptions, CreateBotOptions, CreateOutboundWebhookOptions, UpdateOutboundWebhookOptions, ListWebhookFailuresOptions } from './managers/bots'
export type {
  Bot,
  BotApiKey,
  BotIncomingWebhook,
  BotOutboundWebhook,
  BotWebhookFailure,
  CredentialLastUsedState,
  IssuedBotApiKey,
  CreatedBotIncomingWebhook,
  CreatedBotOutboundWebhook,
  BotWebhookFailurePage,
} from './schemas/bot'
export type {
  SearchManager,
  SearchOptions,
  SearchAllOptions,
  SearchResult,
  SearchPage,
  SearchStatus,
  SearchThreadContext,
  MessageSearchOrder,
  MessageSearchScope,
  MessageSearchGroupBy,
} from './managers/search'
export type { MessageSearchState } from './schemas/search'
export type { NotificationManager, NotificationList, NotificationPolicyScopeInput, NotificationDeliveryModeInput, NotificationPolicyChanges } from './managers/notifications'
export type {
  NotificationDeliveryMode,
  NotificationDeliveryModes,
  NotificationSignalClass,
  NotificationSignal,
  NotificationSignalKind,
  NotificationOccurrence,
  NotificationAttentionLevel,
  NotificationMessageReference,
  NotificationRoomUnreadCount,
  NotificationPolicyScope,
  ScopedNotificationPolicy,
} from './schemas/notification'

// Admin API (client.admin)
export type { AdminManager } from './managers/admin'
export { toPermissionDecision, toPermissionScope } from './managers/admin/permissions'
export type * from './managers/admin/users'
export type * from './schemas/admin/users'
export type * from './managers/admin/permissions'
export type * from './schemas/admin/permissions'
export type * from './managers/admin/roles'
export type * from './schemas/admin/roles'
export type * from './managers/admin/invitation-codes'
export type * from './schemas/admin/invitation-codes'
export type * from './managers/admin/oauth-clients'
export type * from './schemas/admin/oauth-clients'
export type * from './managers/admin/diagnostics'
export type * from './schemas/admin/diagnostics'
export type * from './managers/admin/event-log'
export type * from './schemas/admin/event-log'
export type * from './managers/admin/room-layout'
export type * from './schemas/admin/room-layout'
export type * from './managers/admin/server'
export type * from './schemas/admin/server'
