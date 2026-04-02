import type { MiddlewareHandler } from 'hono'

import { decompress as zstdDecompress } from 'fzstd'

/**
 * Middleware to decompress zstd-encoded request bodies.
 * Codex CLI sends requests with Content-Encoding: zstd.
 */
export const decompressRequest: MiddlewareHandler = async (c, next) => {
  const contentEncoding = c.req.header('content-encoding')

  if (contentEncoding === 'zstd') {
    const compressed = new Uint8Array(await c.req.arrayBuffer())
    const decompressed = zstdDecompress(compressed)
    const body = new TextDecoder().decode(decompressed)

    const headers = new Headers(c.req.raw.headers)
    headers.delete('content-encoding')
    headers.set('content-length', String(body.length))

    const newRequest = new Request(c.req.raw.url, {
      method: c.req.raw.method,
      headers,
      body,
    })

    // Hono uses c.req.raw internally — replace it directly
    Object.defineProperty(c.req, 'raw', { value: newRequest, writable: true })
    // Clear cached body so Hono re-reads from the new request
    Object.defineProperty(c.req, 'bodyCache', { value: {}, writable: true })
  }

  await next()
}
