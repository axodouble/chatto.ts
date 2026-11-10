/**
 * Build a FieldMask JSON string (comma-separated camelCase paths) from the
 * keys of `input` whose value is not `undefined`. A `null` value is included:
 * it selects the field so the server resets it to its default.
 */
export function inferUpdateMask(input: Record<string, unknown>): string {
  return Object.keys(input).filter(k => input[k] !== undefined).join(',')
}

/** Drop `null` values (selected-for-reset fields are sent absent). */
export function stripNulls<T extends Record<string, unknown>>(input: T): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) if (v != null) out[k] = v
  return out
}
