import consola from 'consola'
import { events } from 'fetch-event-stream'

import { copilotBaseUrl, copilotHeaders } from '~/lib/api-config'
import { HTTPError } from '~/lib/error'
import { state } from '~/lib/state'

export const createResponses = async (
  payload: ResponsesPayload,
  options: { vision: boolean; initiator: 'agent' | 'user' },
) => {
  if (!state.copilotToken) throw new Error('Copilot token not found')

  const headers: Record<string, string> = {
    ...copilotHeaders(state, options.vision),
    'X-Initiator': options.initiator,
  }

  const response = await fetch(`${copilotBaseUrl(state)}/responses`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    consola.error('Failed to create responses', response)
    throw new HTTPError('Failed to create responses', response)
  }

  if (payload.stream) {
    return events(response)
  }

  return (await response.json()) as ResponsesResult
}

// Types

export interface ResponsesPayload {
  model: string
  input: ResponseInputItem[] | string
  stream?: boolean
  tools?: ResponseTool[]
  temperature?: number
  top_p?: number
  max_output_tokens?: number
  previous_response_id?: string
  instructions?: string
  [key: string]: unknown
}

export type ResponseInputItem = Record<string, unknown>

export type ResponseTool = Record<string, unknown>

export type ResponsesResult = Record<string, unknown>

export interface ResponseStreamEvent {
  type: string
  [key: string]: unknown
}

export interface ResponseOutputItemAddedEvent extends ResponseStreamEvent {
  type: 'response.output_item.added'
  output_index: number
  item: { id?: string;[key: string]: unknown }
}

export interface ResponseOutputItemDoneEvent extends ResponseStreamEvent {
  type: 'response.output_item.done'
  output_index: number
  item: { id?: string;[key: string]: unknown }
}
