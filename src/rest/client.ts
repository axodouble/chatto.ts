import type { z, ZodTypeAny } from 'zod'
import { ChattoApiError, ChattoParseError } from '../errors'

export class RestClient {
  constructor(
    private readonly baseUrl: string,
    private readonly getToken: () => string,
    private readonly onUnauthorized?: () => Promise<void>,
  ) {}

  async post<S extends ZodTypeAny>(
    service: string,
    method: string,
    input: unknown,
    schema: S,
  ): Promise<z.output<S>> {
    return this.call(service, method, input, schema) as Promise<z.output<S>>
  }

  /** Like `post`, but validation is optional: without a schema the raw JSON is returned. */
  async call(service: string, method: string, input: unknown, schema?: ZodTypeAny): Promise<unknown> {
    const url = `${this.baseUrl}/api/connect/${service}/${method}`

    const attempt = async (): Promise<Response> =>
      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Connect-Protocol-Version': '1',
          Authorization: `Bearer ${this.getToken()}`,
        },
        body: JSON.stringify(input),
      })

    let res = await attempt()

    if (this.isUnauthorized(res) && this.onUnauthorized != null) {
      await this.onUnauthorized()
      res = await attempt()
    }

    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as Record<string, unknown>
      throw new ChattoApiError(
        typeof body['code'] === 'string' ? body['code'] : 'unknown',
        typeof body['message'] === 'string' ? body['message'] : res.statusText,
        body,
      )
    }

    const body = await res.json()
    if (schema == null) return body
    const parsed = schema.safeParse(body)
    if (!parsed.success) {
      throw new ChattoParseError(parsed.error.issues, body)
    }
    return parsed.data
  }

  private isUnauthorized(res: Response): boolean {
    return res.status === 401
  }
}
