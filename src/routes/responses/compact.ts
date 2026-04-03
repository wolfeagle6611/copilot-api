import type { Context } from "hono"

import consola from "consola"

import { checkRateLimit } from "~/lib/rate-limit"
import { state } from "~/lib/state"
import {
  createResponses,
  type ResponseInputItem,
  type ResponsesPayload,
  type ResponsesResult,
} from "~/services/copilot/create-responses"

import { getResponsesRequestOptions } from "./utils"

const COMPACT_PROMPT = `You are performing a CONTEXT CHECKPOINT COMPACTION.
Create a concise handoff summary for another LLM that will resume the task.

Include:
- Current progress and key decisions made
- Important context, constraints, or user preferences
- What remains to be done (clear next steps)
- Any critical data, examples, or references needed to continue

Be concise, structured, and focused on helping the next LLM seamlessly continue the work.
Output ONLY the summary, no preamble.`

const SUMMARY_PREFIX = `Another language model started to solve this problem and produced a summary of its thinking process. Use this to build on the work already done and avoid duplicating work. Here is the summary:`

/**
 * Get max input chars based on 25% of the model's context window.
 * ~4 chars per token as a rough estimate.
 */
function getMaxInputChars(model: string): number {
  const modelData = state.models?.data.find((m) => m.id === model)
  const maxTokens =
    modelData?.capabilities.limits.max_context_window_tokens ?? 16_000
  return Math.floor(maxTokens * 0.25 * 4)
}

/**
 * Truncate input to fit within the model's context window.
 * Keeps the first item (system/instructions) and the most recent items.
 */
function truncateInput(
  input: Array<ResponseInputItem>,
  maxChars: number,
): Array<ResponseInputItem> {
  if (input.length === 0) return input

  if (JSON.stringify(input).length <= maxChars) return input

  const first = input[0]
  const rest = input.slice(1)
  const kept: Array<ResponseInputItem> = []
  let totalChars = JSON.stringify(first).length

  // Walk backwards, keeping the most recent items
  for (let i = rest.length - 1; i >= 0; i--) {
    const itemSize = JSON.stringify(rest[i]).length
    if (totalChars + itemSize > maxChars) break
    kept.unshift(rest[i])
    totalChars += itemSize
  }

  consola.debug(
    `Compact: truncated ${input.length} → ${kept.length + 1} items (${totalChars} chars)`,
  )
  return [first, ...kept]
}

/**
 * Extract summary text from the response output items.
 */
function extractSummaryText(result: ResponsesResult): string {
  const output = result.output as Array<Record<string, unknown>> | undefined
  if (!Array.isArray(output)) return ""

  const parts: Array<string> = []
  for (const item of output) {
    if (item.type !== "message" || !Array.isArray(item.content)) continue
    for (const part of item.content as Array<Record<string, unknown>>) {
      if (part.type === "output_text" && typeof part.text === "string") {
        parts.push(part.text)
      }
    }
  }
  return parts.join("")
}

/**
 * Handle POST /v1/responses/compact
 *
 * GitHub Copilot doesn't support /responses/compact natively.
 * We implement it by:
 * 1. Truncating input to 25% of the model's context window
 * 2. Keeping the first item (instructions) + most recent items
 * 3. Asking the model to summarize the conversation
 * 4. Returning a compacted response
 */
export async function handleCompact(c: Context) {
  await checkRateLimit(state)

  const payload = await c.req.json<ResponsesPayload>()

  const maxChars = getMaxInputChars(payload.model)
  const input = Array.isArray(payload.input) ? payload.input : []
  const truncated = truncateInput(input, maxChars)

  consola.debug(
    `Compact: model=${payload.model}, maxChars=${maxChars}, items=${truncated.length}`,
  )

  const compactPayload: ResponsesPayload = {
    model: payload.model,
    input: [...truncated, { role: "user", content: COMPACT_PROMPT }],
    stream: false,
  }

  const { vision, initiator } = getResponsesRequestOptions(compactPayload)
  const result = (await createResponses(compactPayload, {
    vision,
    initiator,
  })) as ResponsesResult

  // Extract summary text from response output
  const summaryText = extractSummaryText(result)

  return c.json({
    id: result.id ?? `resp_compact_${Date.now()}`,
    object: "response.compaction",
    created_at: Math.floor(Date.now() / 1000),
    output: [
      {
        type: "message",
        role: "assistant",
        content: [
          { type: "output_text", text: `${SUMMARY_PREFIX}\n\n${summaryText}` },
        ],
      },
    ],
    usage: result.usage ?? {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
    },
  })
}
