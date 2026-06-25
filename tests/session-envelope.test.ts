import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSessionEnvelope, withSessionEnvelope } from '../src/main/session-envelope'
import { scheduleTextBatch } from '../src/main/agent-text-batch'
import { SessionRuntimeController } from '../src/main/session-runtime'

function fakeWindow() {
  const sent: Array<{ channel: string; payload: unknown }> = []
  return {
    sent,
    win: {
      isDestroyed: () => false,
      webContents: {
        send: (channel: string, payload: unknown) => {
          sent.push({ channel, payload })
        },
      },
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('session event envelope', () => {
  it('creates an app-owned routing envelope separate from the SDK session id', () => {
    const envelope = createSessionEnvelope({
      context: 'editor',
      sessionId: 'app-session-a',
      sdkSessionId: 'sdk-session-a',
      workspacePath: '/workspace/a',
    })

    expect(envelope).toEqual({
      context: 'editor',
      sessionId: 'app-session-a',
      clientSessionKey: 'app-session-a',
      sdkSessionId: 'sdk-session-a',
      workspacePath: '/workspace/a',
    })
  })

  it('envelope fields override conflicting payload routing fields', () => {
    const envelope = createSessionEnvelope({
      context: 'ask',
      sessionId: 'ask-session',
      workspacePath: '/app/ask',
    })

    const payload = withSessionEnvelope(envelope, {
      type: 'result',
      sessionId: 'wrong-session',
      context: 'editor',
    })

    expect(payload.sessionId).toBe('ask-session')
    expect(payload.clientSessionKey).toBe('ask-session')
    expect(payload.context).toBe('ask')
    expect(payload.workspacePath).toBe('/app/ask')
  })

  it('text batching emits session-scoped agent events', async () => {
    const { win, sent } = fakeWindow()
    const envelope = createSessionEnvelope({
      context: 'editor',
      sessionId: 'session-a',
      sdkSessionId: 'sdk-a',
      workspacePath: '/workspace/a',
    })

    scheduleTextBatch('session-a', 'hello ', 'uuid-1', win as never, envelope)
    scheduleTextBatch('session-a', 'world', 'uuid-2', win as never, envelope)
    await new Promise((resolve) => setTimeout(resolve, 40))

    expect(sent).toHaveLength(1)
    expect(sent[0].channel).toBe('agent:event')
    expect(sent[0].payload).toMatchObject({
      context: 'editor',
      sessionId: 'session-a',
      clientSessionKey: 'session-a',
      sdkSessionId: 'sdk-a',
      workspacePath: '/workspace/a',
      type: 'stream_event',
      uuid: 'uuid-2',
      event: {
        delta: { text: 'hello world' },
      },
    })
  })
})

describe('session runtime event routing', () => {
  it('emits converted SDK messages with the session envelope', () => {
    const { win, sent } = fakeWindow()
    const runtime = new SessionRuntimeController()
    const envelope = createSessionEnvelope({
      context: 'editor',
      sessionId: 'app-session-a',
      sdkSessionId: 'sdk-session-a',
      workspacePath: '/workspace/a',
    })

    runtime.emitSdkMessage(win as never, 'app-session-a', envelope, {
      type: 'assistant',
      uuid: 'assistant-1',
      message: {
        content: [{ type: 'text', text: 'hello from sdk' }],
      },
    } as never)

    expect(sent).toHaveLength(1)
    expect(sent[0].channel).toBe('agent:event')
    expect(sent[0].payload).toMatchObject({
      context: 'editor',
      sessionId: 'app-session-a',
      clientSessionKey: 'app-session-a',
      sdkSessionId: 'sdk-session-a',
      workspacePath: '/workspace/a',
      type: 'assistant',
      uuid: 'assistant-1',
      message: {
        content: [{ type: 'text', text: 'hello from sdk' }],
      },
    })
  })

  it('batches SDK text deltas with the session envelope', async () => {
    const { win, sent } = fakeWindow()
    const runtime = new SessionRuntimeController()
    const envelope = createSessionEnvelope({
      context: 'editor',
      sessionId: 'app-session-text',
      sdkSessionId: 'sdk-session-text',
      workspacePath: '/workspace/text',
    })

    runtime.emitSdkMessage(win as never, 'app-session-text', envelope, {
      type: 'stream_event',
      uuid: 'delta-1',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'hello ' },
      },
    } as never)
    runtime.emitSdkMessage(win as never, 'app-session-text', envelope, {
      type: 'stream_event',
      uuid: 'delta-2',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'world' },
      },
    } as never)
    await new Promise((resolve) => setTimeout(resolve, 40))

    expect(sent).toHaveLength(1)
    expect(sent[0].channel).toBe('agent:event')
    expect(sent[0].payload).toMatchObject({
      context: 'editor',
      sessionId: 'app-session-text',
      clientSessionKey: 'app-session-text',
      sdkSessionId: 'sdk-session-text',
      workspacePath: '/workspace/text',
      type: 'stream_event',
      uuid: 'delta-2',
      event: {
        delta: { text: 'hello world' },
      },
    })
  })

  it('emits skill output with the session envelope', () => {
    const { win, sent } = fakeWindow()
    const runtime = new SessionRuntimeController()
    const envelope = createSessionEnvelope({
      context: 'editor',
      sessionId: 'app-session-skill-output',
      sdkSessionId: 'sdk-session-skill-output',
      workspacePath: '/workspace/skill-output',
    })
    const instanceId = runtime.registerRun({
      query: {} as never,
      skillId: 'slides',
      abortController: new AbortController(),
      envelope,
    })

    runtime.setSkillOutputWindow(win as never)
    runtime.beginSession(envelope)
    runtime.emitSdkMessage(win as never, 'app-session-skill-output', envelope, {
      type: 'stream_event',
      uuid: 'skill-delta-1',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: '```skill-output\n<html>' },
      },
    } as never)
    runtime.cleanupRun('app-session-skill-output', instanceId)

    const skillOutput = sent.find((entry) => entry.channel === 'skill:output')
    expect(skillOutput?.payload).toMatchObject({
      skillId: 'slides',
      content: '<html>',
      isStreaming: true,
      language: 'html',
      context: 'editor',
      sessionId: 'app-session-skill-output',
      clientSessionKey: 'app-session-skill-output',
      sdkSessionId: 'sdk-session-skill-output',
      workspacePath: '/workspace/skill-output',
    })
  })

  it('applies permission mode to the active query by app session, SDK session, or context', async () => {
    const runtime = new SessionRuntimeController()
    const setPermissionMode = vi.fn().mockResolvedValue(undefined)
    const envelope = createSessionEnvelope({
      context: 'editor',
      sessionId: 'app-session-permission-mode',
      sdkSessionId: 'sdk-session-permission-mode',
      workspacePath: '/workspace/permission-mode',
    })
    runtime.registerRun({
      query: { setPermissionMode } as never,
      skillId: null,
      abortController: new AbortController(),
      envelope,
    })

    await expect(runtime.setPermissionMode('app-session-permission-mode', 'acceptEdits')).resolves.toBe(true)
    await expect(runtime.setPermissionMode('sdk-session-permission-mode', 'plan')).resolves.toBe(true)
    await expect(runtime.setPermissionMode('editor', 'dontAsk')).resolves.toBe(true)
    await expect(runtime.setPermissionMode('missing-session', 'default')).resolves.toBe(false)

    expect(setPermissionMode).toHaveBeenNthCalledWith(1, 'acceptEdits')
    expect(setPermissionMode).toHaveBeenNthCalledWith(2, 'plan')
    expect(setPermissionMode).toHaveBeenNthCalledWith(3, 'dontAsk')
  })

  it('keeps skill output on the app session after the SDK session materializes', () => {
    const { win, sent } = fakeWindow()
    const runtime = new SessionRuntimeController()
    const envelope = createSessionEnvelope({
      context: 'editor',
      sessionId: 'app-session-late-sdk',
      workspacePath: '/workspace/late-sdk',
    })
    const instanceId = runtime.registerRun({
      query: {} as never,
      skillId: 'slides',
      abortController: new AbortController(),
      envelope,
    })

    runtime.setSkillOutputWindow(win as never)
    runtime.beginSession(envelope)
    runtime.materializeSdkSession('app-session-late-sdk', 'sdk-session-late')
    runtime.emitSdkMessage(win as never, 'app-session-late-sdk', envelope, {
      type: 'stream_event',
      uuid: 'skill-delta-late-sdk',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: '```skill-output\n<html>late sdk</html>' },
      },
    } as never)
    runtime.cleanupRun('app-session-late-sdk', instanceId)

    const skillOutput = sent.find((entry) => entry.channel === 'skill:output')
    expect(skillOutput?.payload).toMatchObject({
      skillId: 'slides',
      content: '<html>late sdk</html>',
      isStreaming: true,
      language: 'html',
      context: 'editor',
      sessionId: 'app-session-late-sdk',
      clientSessionKey: 'app-session-late-sdk',
      sdkSessionId: 'sdk-session-late',
      workspacePath: '/workspace/late-sdk',
    })
  })

  it('emits skill output from Edit new_string deltas', () => {
    const { win, sent } = fakeWindow()
    const runtime = new SessionRuntimeController()
    const envelope = createSessionEnvelope({
      context: 'editor',
      sessionId: 'app-session-edit-output',
      sdkSessionId: 'sdk-session-edit-output',
      workspacePath: '/workspace/edit-output',
    })
    const instanceId = runtime.registerRun({
      query: {} as never,
      skillId: 'frontend-slides',
      abortController: new AbortController(),
      envelope,
    })

    runtime.setSkillOutputWindow(win as never)
    runtime.beginSession(envelope)
    runtime.emitSdkMessage(win as never, 'app-session-edit-output', envelope, {
      type: 'stream_event',
      uuid: 'edit-start',
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'tool-edit-1', name: 'Edit' },
      },
    } as never)
    runtime.emitSdkMessage(win as never, 'app-session-edit-output', envelope, {
      type: 'stream_event',
      uuid: 'edit-delta',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: {
          type: 'input_json_delta',
          partial_json: JSON.stringify({
            file_path: '/workspace/edit-output/deck.html',
            old_string: '<!-- SLIDES_HERE -->',
            new_string: '<section class="slide"><h1>Slide A</h1></section>',
          }),
        },
      },
    } as never)
    runtime.cleanupRun('app-session-edit-output', instanceId)

    const skillOutput = sent.find((entry) => entry.channel === 'skill:output')
    expect(skillOutput?.payload).toMatchObject({
      skillId: 'frontend-slides',
      content: '<section class="slide"><h1>Slide A</h1></section>',
      isStreaming: true,
      language: 'html',
      context: 'editor',
      sessionId: 'app-session-edit-output',
      clientSessionKey: 'app-session-edit-output',
      sdkSessionId: 'sdk-session-edit-output',
      workspacePath: '/workspace/edit-output',
    })
  })

  it('emits skill output from Bash heredoc artifact writes', () => {
    const { win, sent } = fakeWindow()
    const runtime = new SessionRuntimeController()
    const envelope = createSessionEnvelope({
      context: 'editor',
      sessionId: 'app-session-bash-output',
      sdkSessionId: 'sdk-session-bash-output',
      workspacePath: '/workspace/bash-output',
    })
    const instanceId = runtime.registerRun({
      query: {} as never,
      skillId: 'guizang-ppt-skill',
      abortController: new AbortController(),
      envelope,
    })

    runtime.setSkillOutputWindow(win as never)
    runtime.beginSession(envelope)
    runtime.emitSdkMessage(win as never, 'app-session-bash-output', envelope, {
      type: 'stream_event',
      uuid: 'bash-start',
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'tool-bash-1', name: 'Bash' },
      },
    } as never)
    runtime.emitSdkMessage(win as never, 'app-session-bash-output', envelope, {
      type: 'stream_event',
      uuid: 'bash-delta',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: {
          type: 'input_json_delta',
          partial_json: JSON.stringify({
            command: "cat > deck.html <<'EOF'\n<!DOCTYPE html>\n<html><body>Deck</body></html>\nEOF",
          }),
        },
      },
    } as never)
    runtime.cleanupRun('app-session-bash-output', instanceId)

    const skillOutput = sent.find((entry) => entry.channel === 'skill:output')
    expect(skillOutput?.payload).toMatchObject({
      skillId: 'guizang-ppt-skill',
      content: '<!DOCTYPE html>\n<html><body>Deck</body></html>',
      isStreaming: true,
      language: 'html',
      context: 'editor',
      sessionId: 'app-session-bash-output',
      clientSessionKey: 'app-session-bash-output',
      sdkSessionId: 'sdk-session-bash-output',
      workspacePath: '/workspace/bash-output',
    })
  })

  it('does not treat ordinary Bash heredoc scripts as skill output', () => {
    const { win, sent } = fakeWindow()
    const runtime = new SessionRuntimeController()
    const envelope = createSessionEnvelope({
      context: 'editor',
      sessionId: 'app-session-bash-script',
      sdkSessionId: 'sdk-session-bash-script',
      workspacePath: '/workspace/bash-script',
    })
    const instanceId = runtime.registerRun({
      query: {} as never,
      skillId: 'frontend-slides',
      abortController: new AbortController(),
      envelope,
    })

    runtime.setSkillOutputWindow(win as never)
    runtime.beginSession(envelope)
    runtime.emitSdkMessage(win as never, 'app-session-bash-script', envelope, {
      type: 'stream_event',
      uuid: 'bash-script-start',
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'tool-bash-script', name: 'Bash' },
      },
    } as never)
    runtime.emitSdkMessage(win as never, 'app-session-bash-script', envelope, {
      type: 'stream_event',
      uuid: 'bash-script-delta',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: {
          type: 'input_json_delta',
          partial_json: JSON.stringify({
            command: "python <<'PY'\nprint('preparing deck.html')\nPY",
          }),
        },
      },
    } as never)
    runtime.cleanupRun('app-session-bash-script', instanceId)

    expect(sent.some((entry) => entry.channel === 'skill:output')).toBe(false)
  })

  it('emits execution errors with the session envelope', () => {
    const { win, sent } = fakeWindow()
    const runtime = new SessionRuntimeController()
    const envelope = createSessionEnvelope({
      context: 'ask',
      sessionId: 'ask-session',
      workspacePath: '/app/ask',
    })

    runtime.emitExecutionError(win as never, envelope, 'network failed')

    expect(sent).toHaveLength(1)
    expect(sent[0].channel).toBe('agent:event')
    expect(sent[0].payload).toMatchObject({
      context: 'ask',
      sessionId: 'ask-session',
      clientSessionKey: 'ask-session',
      workspacePath: '/app/ask',
      type: 'result',
      subtype: 'error_during_execution',
      errors: ['network failed'],
    })
  })

  it('emits agent notifications with the session envelope', () => {
    const { win, sent } = fakeWindow()
    const runtime = new SessionRuntimeController()
    const envelope = createSessionEnvelope({
      context: 'editor',
      sessionId: 'app-session-notification',
      sdkSessionId: 'sdk-session-notification',
      workspacePath: '/workspace/notification',
    })

    runtime.emitNotification(win as never, envelope, {
      type: 'info',
      title: 'Heads up',
      message: 'Agent needs attention',
    })

    expect(sent).toHaveLength(1)
    expect(sent[0].channel).toBe('agent:notification')
    expect(sent[0].payload).toMatchObject({
      type: 'info',
      title: 'Heads up',
      message: 'Agent needs attention',
      context: 'editor',
      sessionId: 'app-session-notification',
      clientSessionKey: 'app-session-notification',
      sdkSessionId: 'sdk-session-notification',
      workspacePath: '/workspace/notification',
      workspaceCwd: '/workspace/notification',
    })
  })

  it('resolves event envelopes from the active runtime run', () => {
    const runtime = new SessionRuntimeController()
    const envelope = createSessionEnvelope({
      context: 'editor',
      sessionId: 'app-session-materialized',
      workspacePath: '/workspace/materialized',
    })
    runtime.registerRun({
      query: {} as never,
      skillId: null,
      abortController: new AbortController(),
      envelope,
    })

    runtime.materializeSdkSession('app-session-materialized', 'sdk-real')

    expect(runtime.resolveEventEnvelope('app-session-materialized', {
      context: 'ask',
      sessionId: 'fallback',
      clientSessionKey: 'fallback',
      workspacePath: '/fallback',
    })).toEqual({
      context: 'editor',
      sessionId: 'app-session-materialized',
      clientSessionKey: 'app-session-materialized',
      sdkSessionId: 'sdk-real',
      workspacePath: '/workspace/materialized',
    })
  })

  it('finalizes a run by flushing pending text before cleanup', () => {
    const { win, sent } = fakeWindow()
    const runtime = new SessionRuntimeController()
    const envelope = createSessionEnvelope({
      context: 'editor',
      sessionId: 'app-session-finalize',
      sdkSessionId: 'sdk-finalize',
      workspacePath: '/workspace/finalize',
    })
    const instanceId = runtime.registerRun({
      query: {} as never,
      skillId: null,
      abortController: new AbortController(),
      envelope,
    })

    runtime.emitSdkMessage(win as never, 'app-session-finalize', envelope, {
      type: 'stream_event',
      uuid: 'pending-delta',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'flush me' },
      },
    } as never)
    runtime.finalizeRun(win as never, 'app-session-finalize', instanceId)

    expect(sent).toHaveLength(1)
    expect(sent[0].payload).toMatchObject({
      sessionId: 'app-session-finalize',
      sdkSessionId: 'sdk-finalize',
      event: {
        delta: { text: 'flush me' },
      },
    })
    expect(runtime.getEnvelope('app-session-finalize')).toBeNull()
  })

  it('owns AskUser pending request registration and resolution', async () => {
    const { win, sent } = fakeWindow()
    const runtime = new SessionRuntimeController()
    const envelope = createSessionEnvelope({
      context: 'editor',
      sessionId: 'app-session-ask-user',
      sdkSessionId: 'sdk-ask-user',
      workspacePath: '/workspace/ask-user',
    })

    const pending = runtime.requestAskUserAnswer(win as never, envelope, {
      questions: [{
        question: 'Pick one',
        header: 'Choice',
        options: [{ label: 'A', description: 'First' }],
        multiSelect: false,
      }],
      question: 'Pick one',
      header: 'Choice',
      options: [{ label: 'A', description: 'First' }],
      multiSelect: false,
    }, { questions: [] })

    expect(sent).toHaveLength(1)
    expect(sent[0].channel).toBe('agent:askUser')
    expect(sent[0].payload).toMatchObject({
      context: 'editor',
      sessionId: 'app-session-ask-user',
      sdkSessionId: 'sdk-ask-user',
      workspacePath: '/workspace/ask-user',
      question: 'Pick one',
    })

    const requestId = (sent[0].payload as { id: string }).id
    runtime.resolveAskUser(requestId, { Choice: 'A' })

    await expect(pending).resolves.toMatchObject({
      behavior: 'allow',
      updatedInput: {
        answers: { Choice: 'A' },
      },
    })
  })

  it('emits AskUser timeout with the owning session envelope', async () => {
    vi.useFakeTimers()

    const { win, sent } = fakeWindow()
    const runtime = new SessionRuntimeController()
    const envelope = createSessionEnvelope({
      context: 'editor',
      sessionId: 'app-session-ask-timeout',
      sdkSessionId: 'sdk-ask-timeout',
      workspacePath: '/workspace/ask-timeout',
    })

    const pending = runtime.requestAskUserAnswer(win as never, envelope, {
      questions: [{
        question: 'Continue?',
        options: [{ label: 'Yes' }],
        multiSelect: false,
      }],
      question: 'Continue?',
      options: [{ label: 'Yes' }],
      multiSelect: false,
    }, { questions: [] })

    const askEvent = sent.find((event) => event.channel === 'agent:askUser')
    const requestId = (askEvent?.payload as { id: string }).id
    vi.advanceTimersByTime(300000)

    await expect(pending).resolves.toMatchObject({
      behavior: 'deny',
      message: 'AskUserQuestion timed out — user did not respond',
    })

    const timeoutEvent = sent.find((event) => event.channel === 'agent:askUserTimeout')
    expect(timeoutEvent?.payload).toMatchObject({
      requestId,
      context: 'editor',
      sessionId: 'app-session-ask-timeout',
      clientSessionKey: 'app-session-ask-timeout',
      sdkSessionId: 'sdk-ask-timeout',
      workspacePath: '/workspace/ask-timeout',
    })
  })

  it('owns permission pending request registration and resolution', async () => {
    const { win, sent } = fakeWindow()
    const runtime = new SessionRuntimeController()
    const envelope = createSessionEnvelope({
      context: 'editor',
      sessionId: 'app-session-permission',
      sdkSessionId: 'sdk-permission',
      workspacePath: '/workspace/permission',
    })
    const input = { file_path: '/workspace/permission/file.md' }

    const pending = runtime.requestPermissionApproval(win as never, envelope, {
      toolName: 'Write',
      input,
      title: 'Write file',
      displayName: 'Write',
    })

    expect(sent).toHaveLength(1)
    expect(sent[0].channel).toBe('agent:permissionRequest')
    expect(sent[0].payload).toMatchObject({
      context: 'editor',
      sessionId: 'app-session-permission',
      sdkSessionId: 'sdk-permission',
      workspacePath: '/workspace/permission',
      toolName: 'Write',
      input,
    })

    const requestId = (sent[0].payload as { id: string }).id
    runtime.resolvePermission(requestId, 'allow')

    await expect(pending).resolves.toMatchObject({
      behavior: 'allow',
      updatedInput: input,
    })
  })

  it('emits permission cancellation with the owning session envelope when the SDK aborts', async () => {
    const { win, sent } = fakeWindow()
    const runtime = new SessionRuntimeController()
    const envelope = createSessionEnvelope({
      context: 'editor',
      sessionId: 'app-session-permission-abort',
      sdkSessionId: 'sdk-permission-abort',
      workspacePath: '/workspace/permission-abort',
    })
    const abortController = new AbortController()
    abortController.abort()

    const pending = runtime.requestPermissionApproval(win as never, envelope, {
      toolName: 'Write',
      input: { file_path: '/workspace/permission-abort/file.md' },
    }, abortController.signal)

    await expect(pending).resolves.toMatchObject({
      behavior: 'deny',
      message: 'Tool use cancelled by SDK',
    })
    expect(sent).toHaveLength(1)
    expect(sent[0].channel).toBe('agent:permissionTimeout')
    expect(sent[0].payload).toMatchObject({
      context: 'editor',
      sessionId: 'app-session-permission-abort',
      clientSessionKey: 'app-session-permission-abort',
      sdkSessionId: 'sdk-permission-abort',
      workspacePath: '/workspace/permission-abort',
    })
  })

  it('keeps parallel session messages and prompts routed to their own envelopes', async () => {
    const { win, sent } = fakeWindow()
    const runtime = new SessionRuntimeController()
    const envelopeA = createSessionEnvelope({
      context: 'editor',
      sessionId: 'workspace-a-session',
      sdkSessionId: 'sdk-a',
      workspacePath: '/workspace/a',
    })
    const envelopeB = createSessionEnvelope({
      context: 'editor',
      sessionId: 'workspace-b-session',
      sdkSessionId: 'sdk-b',
      workspacePath: '/workspace/b',
    })
    const instanceA = runtime.registerRun({
      query: {} as never,
      skillId: null,
      abortController: new AbortController(),
      envelope: envelopeA,
    })
    runtime.registerRun({
      query: {} as never,
      skillId: null,
      abortController: new AbortController(),
      envelope: envelopeB,
    })

    runtime.emitSdkMessage(win as never, 'workspace-a-session', envelopeA, {
      type: 'stream_event',
      uuid: 'a-delta',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'answer for A' },
      },
    } as never)

    const permission = runtime.requestPermissionApproval(win as never, envelopeB, {
      toolName: 'Write',
      input: { file_path: '/workspace/b/result.md' },
    })

    const permissionEvent = sent.find((event) => event.channel === 'agent:permissionRequest')
    expect(permissionEvent?.payload).toMatchObject({
      sessionId: 'workspace-b-session',
      sdkSessionId: 'sdk-b',
      workspacePath: '/workspace/b',
      toolName: 'Write',
    })

    runtime.emitSdkMessage(win as never, 'workspace-b-session', envelopeB, {
      type: 'assistant',
      uuid: 'b-assistant',
      message: {
        content: [{ type: 'text', text: 'answer for B' }],
      },
    } as never)

    runtime.finalizeRun(win as never, 'workspace-a-session', instanceA)

    const bMessage = sent.find((event) => (
      event.channel === 'agent:event'
      && (event.payload as { uuid?: string }).uuid === 'b-assistant'
    ))
    const aMessage = sent.find((event) => (
      event.channel === 'agent:event'
      && (event.payload as { uuid?: string }).uuid === 'a-delta'
    ))

    expect(bMessage?.payload).toMatchObject({
      sessionId: 'workspace-b-session',
      sdkSessionId: 'sdk-b',
      workspacePath: '/workspace/b',
      type: 'assistant',
    })
    expect(aMessage?.payload).toMatchObject({
      sessionId: 'workspace-a-session',
      sdkSessionId: 'sdk-a',
      workspacePath: '/workspace/a',
      type: 'stream_event',
      event: {
        delta: { text: 'answer for A' },
      },
    })

    const requestId = (permissionEvent?.payload as { id: string }).id
    runtime.resolvePermission(requestId, 'allow')
    await expect(permission).resolves.toMatchObject({
      behavior: 'allow',
      updatedInput: { file_path: '/workspace/b/result.md' },
    })
  })

  it('aborts by SDK session id without rejecting prompts from other sessions', async () => {
    const { win, sent } = fakeWindow()
    const runtime = new SessionRuntimeController()
    const envelopeA = createSessionEnvelope({
      context: 'editor',
      sessionId: 'workspace-a-session',
      sdkSessionId: 'sdk-a',
      workspacePath: '/workspace/a',
    })
    const envelopeB = createSessionEnvelope({
      context: 'editor',
      sessionId: 'workspace-b-session',
      sdkSessionId: 'sdk-b',
      workspacePath: '/workspace/b',
    })
    const abortA = new AbortController()
    const abortB = new AbortController()
    runtime.registerRun({
      query: {} as never,
      skillId: null,
      abortController: abortA,
      envelope: envelopeA,
    })
    runtime.registerRun({
      query: {} as never,
      skillId: null,
      abortController: abortB,
      envelope: envelopeB,
    })

    const permissionA = runtime.requestPermissionApproval(win as never, envelopeA, {
      toolName: 'Write',
      input: { file_path: '/workspace/a/result.md' },
    })
    const permissionB = runtime.requestPermissionApproval(win as never, envelopeB, {
      toolName: 'Write',
      input: { file_path: '/workspace/b/result.md' },
    })
    const permissionAEvent = sent.find((event) => (
      event.channel === 'agent:permissionRequest'
      && (event.payload as { sessionId?: string }).sessionId === 'workspace-a-session'
    ))

    runtime.abort('sdk-b')

    expect(abortA.signal.aborted).toBe(false)
    expect(abortB.signal.aborted).toBe(true)
    await expect(permissionB).resolves.toMatchObject({
      behavior: 'deny',
      message: 'Query aborted',
    })

    const requestAId = (permissionAEvent?.payload as { id: string }).id
    runtime.resolvePermission(requestAId, 'allow')
    await expect(permissionA).resolves.toMatchObject({
      behavior: 'allow',
      updatedInput: { file_path: '/workspace/a/result.md' },
    })
  })
})
