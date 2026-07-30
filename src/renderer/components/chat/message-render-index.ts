import type { ConversationMessage } from '../../../shared/types'

export type MessageRenderIndex = {
  latestStreamingUserMessageId: string | null
}

export function buildMessageRenderIndex(
  messages: ConversationMessage[],
  isQueryActive: boolean,
): MessageRenderIndex {
  if (!isQueryActive) return { latestStreamingUserMessageId: null }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].kind === 'user') {
      return { latestStreamingUserMessageId: messages[index].id }
    }
  }

  return { latestStreamingUserMessageId: null }
}
