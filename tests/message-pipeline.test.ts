import { describe, expect, it } from 'vitest'
import type { AgentIPCMessage } from '../src/shared/types'
import { emptySlot } from '../src/renderer/store/agent-store'
import { buildReplayedMessages, reduceAgentMessage } from '../src/renderer/store/message-pipeline'

describe('reduceAgentMessage', () => {
  it('projects a live assistant message and emits the first-content event', () => {
    const message: AgentIPCMessage = {
      type: 'assistant',
      uuid: 'assistant-1',
      message: { content: [{ type: 'text', text: 'hello' }] },
    }

    const result = reduceAgentMessage(emptySlot(), message, 'live')

    expect(result.patch?.messages).toHaveLength(1)
    expect(result.patch?.messages?.[0]).toMatchObject({
      id: 'assistant-1',
      textContent: 'hello',
    })
    expect(result.events).toEqual([{ type: 'FIRST_CONTENT' }])
  })

  it('restores replay content without driving the live FSM', () => {
    const message: AgentIPCMessage = {
      type: 'assistant',
      uuid: 'assistant-history',
      message: { content: [{ type: 'text', text: 'history' }] },
    }

    const result = reduceAgentMessage(emptySlot(), message, 'replay')

    expect(result.patch?.messages?.[0]).toMatchObject({ textContent: 'history' })
    expect(result.events).toEqual([])
  })

  it('ignores streaming deltas during replay', () => {
    const message: AgentIPCMessage = {
      type: 'stream_event',
      uuid: 'stream-history',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'ignored' },
      },
    }

    expect(reduceAgentMessage(emptySlot(), message, 'replay')).toEqual({
      patch: null,
      events: [],
      firstContentSeenDuringThisCall: false,
    })
  })

  it('keeps the abort guard inside the pipeline result semantics', () => {
    const slot = {
      ...emptySlot(),
      _queryGeneration: 2,
      _resultGuardGen: 1,
    }
    const message = {
      type: 'result',
      subtype: 'error_during_execution',
      errors: ['aborted'],
    } as AgentIPCMessage

    expect(reduceAgentMessage(slot, message, 'live')).toEqual({
      patch: null,
      events: [],
      firstContentSeenDuringThisCall: false,
    })
  })

  it('uses the same tool-result projection for live delivery and replay', () => {
    const messages: AgentIPCMessage[] = [{
      type: 'assistant',
      uuid: 'tool-answer',
      message: {
        content: [
          { type: 'text', text: 'working' },
          { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: '/tmp/a.md' } },
        ],
      },
    }, {
      type: 'user',
      uuid: 'tool-result',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'contents' }],
      },
    }]

    let liveSlot = emptySlot()
    for (const message of messages) {
      const { patch } = reduceAgentMessage(liveSlot, message, 'live')
      if (patch) liveSlot = { ...liveSlot, ...patch }
    }

    const withoutProjectionTime = (items: typeof liveSlot.messages) => items.map(({ createdAt: _createdAt, ...message }) => message)
    expect(withoutProjectionTime(buildReplayedMessages(messages))).toEqual(withoutProjectionTime(liveSlot.messages))
    expect(liveSlot.messages[0]).toMatchObject({
      toolCalls: [{ toolUseId: 'tool-1', status: 'completed', result: 'contents' }],
    })
  })

  it('restores result diagnostics through the shared projection rules', () => {
    const messages = buildReplayedMessages([{
      type: 'result',
      subtype: 'success',
      stop_reason: 'max_tokens',
      session_id: 'sdk-session',
    } as AgentIPCMessage])

    expect(messages).toHaveLength(1)
    expect(messages[0]).toMatchObject({
      kind: 'stopped',
      textContent: expect.stringContaining('达到最大输出长度'),
    })
  })
})

const assistant=(id:string,content:any[])=>({type:'assistant',uuid:id,message:{content}} as any);
describe('message projection regression cases',()=>{
 it('retains independently identified repeated user messages',()=>{
  const result=buildReplayedMessages([{type:'user',uuid:'u1',message:{content:[{type:'text',text:'继续'}]}},assistant('a1',[{type:'text',text:'response'}]),{type:'user',uuid:'u2',message:{content:[{type:'text',text:'继续'}]}}] as any);
  expect(result.filter(m=>m.kind==='user').map(m=>m.id)).toEqual(['u1','u2']);
 });
 it('keeps all streamed text blocks after completion',()=>{
  let slot=emptySlot();
  for(const [index,text] of [[0,'first'],[1,'second']] as const){const result=reduceAgentMessage(slot,{type:'stream_event',event:{type:'content_block_delta',index,delta:{type:'text_delta',text}}} as any,'live');slot={...slot,...result.patch}}
  expect((slot.messages.at(-1) as any).textContent).toBe('firstsecond');
  const msg=assistant('a2',[{type:'text',text:'first'},{type:'text',text:'second'}]);
  const completed=reduceAgentMessage(slot,msg,'live');expect((completed.patch!.messages!.at(-1) as any).textContent).toBe('firstsecond');
  const replay=buildReplayedMessages([msg]);expect((replay[0] as any).textContent).toBe('firstsecond');
 });
 it('binds SDK task creation results before applying updates',()=>{
  let slot=emptySlot();
  const messages=[assistant('a1',[{type:'tool_use',id:'tool-create',name:'TaskCreate',input:{subject:'Example'}}]),{type:'user',uuid:'result1',message:{content:[{type:'tool_result',tool_use_id:'tool-create',content:'Task #1 created successfully: Example'}]}},assistant('a2',[{type:'tool_use',id:'tool-update',name:'TaskUpdate',input:{taskId:'1',status:'completed'}}])];
  for(const msg of messages){slot={...slot,...reduceAgentMessage(slot,msg as any,'live').patch}}
  expect(slot.todoList!.tasks).toHaveLength(1);expect(slot.todoList!.tasks[0].taskId).toBe('1');expect(slot.todoList!.tasks[0].status).toBe('completed');
 });
});
