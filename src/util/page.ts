/** Offset pagination input, sent as Chatto's `PageRequest`. */
export interface PageOptions {
  /** Page size (0–500). The server applies its default when omitted. */
  limit?: number
  /** Number of rows to skip. */
  offset?: number
}

/** One page of an offset-paginated list. */
export interface Page<T> {
  items: T[]
  /** Total rows across all pages, when the server reports it. */
  totalCount: number
  hasMore: boolean
}

/** Build a `PageRequest` body field, or `undefined` when no options were given. */
export function pageRequest(opts?: PageOptions): { limit?: number; offset?: number } | undefined {
  if (opts == null || (opts.limit == null && opts.offset == null)) return undefined
  return { limit: opts.limit, offset: opts.offset }
}

/** Wrap list rows and an optional parsed `PageInfo` into a `Page`. */
export function toPage<T>(items: T[], page?: { totalCount: number; hasMore: boolean }): Page<T> {
  return { items, totalCount: page?.totalCount ?? items.length, hasMore: page?.hasMore ?? false }
}
