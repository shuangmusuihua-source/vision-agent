import { describe, expect, it } from 'vitest'
import { buildReplayedMessages, reduceUserMessage } from '../src/renderer/store/message-pipeline'
import { emptySlot } from '../src/renderer/store/agent-store'
import type { UserPayload } from '../src/shared/types'

function userPayloadWithConversion(text = '附件：a.pdf | 类型：PDF文档 | 原始路径：/tmp/a.pdf'): UserPayload {
  return {
    type: 'user',
    uuid: 'user-1',
    message: {
      content: [{
        type: 'text',
        text: [
          text,
          '',
          '<attachment_conversion_context>',
          '附件转换结果：',
          '- 源文件: /tmp/a.pdf',
          '  Markdown路径: /tmp/work/.vision/attachments/a.md',
          '</attachment_conversion_context>',
        ].join('\n'),
      }],
    },
  }
}

describe('attachment conversion message metadata', () => {
  it('restores conversion metadata when replaying user messages', () => {
    const messages = buildReplayedMessages([userPayloadWithConversion()])
    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      kind: 'user',
      textContent: '附件：a.pdf | 类型：PDF文档 | 原始路径：/tmp/a.pdf',
      attachmentConversions: [{
        sourcePath: '/tmp/a.pdf',
        status: 'converted',
        markdownPath: '/tmp/work/.vision/attachments/a.md',
      }],
    })
  })

  it('updates the optimistic live user message with conversion metadata', () => {
    const slot = emptySlot()
    slot.messages = [{
      kind: 'user',
      id: 'optimistic-user',
      role: 'user',
      textContent: '附件：a.pdf | 类型：PDF文档 | 原始路径：/tmp/a.pdf',
      createdAt: 1,
    }]

    const patch = reduceUserMessage(slot, userPayloadWithConversion(), false)
    expect(patch?.messages?.[0]).toMatchObject({
      id: 'optimistic-user',
      attachmentConversions: [{
        sourcePath: '/tmp/a.pdf',
        status: 'converted',
        markdownPath: '/tmp/work/.vision/attachments/a.md',
      }],
    })
  })
})
