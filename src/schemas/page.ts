import { z } from 'zod'

/**
 * Chatto `PageInfo` for offset-paginated lists. `totalCount` is an int64 and
 * arrives as a JSON string; both fields are omitted when zero/false.
 *
 * Lives in its own module (re-exported from `./room`) so schema files can share
 * it without creating import cycles.
 */
export const PageInfoSchema = z.object({
  totalCount: z.coerce.number().default(0),
  hasMore: z.boolean().default(false),
})
