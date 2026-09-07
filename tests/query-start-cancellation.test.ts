
import {describe,expect,it,vi} from 'vitest'
const m=vi.hoisted(()=>({query:vi.fn(),convert:vi.fn(),records:new Map<string,any>()}));
vi.mock('electron',()=>({shell:{openExternal:vi.fn()}}));
vi.mock('@anthropic-ai/claude-agent-sdk',()=>({query:m.query}));
vi.mock('../src/main/skill-init',()=>({ensureWorkspaceSkills:async()=>({conflicts:[]}),getAppSkillsCwd:()=>'/app',getAppSkillsDir:()=>'/skills'}));
vi.mock('../src/main/persistence/profile-store',()=>({getApiKey:()=> 'dummy',getActiveProfileUsageIdentity:()=>null}));
vi.mock('../src/main/persistence/workspace-store',()=>({getAuthorizedDirectories:()=>['/workspace'],getSessionRecordById:(id:string)=>m.records.get(id),updateSessionRecord:(id:string,p:any)=>m.records.set(id,{id,...p})}));
vi.mock('../src/main/persistence/settings-store',()=>({getEnabledSkills:()=>[]}));
vi.mock('../src/main/notification-manager',()=>({notifyAgentComplete:vi.fn(),schedulePermissionNotification:vi.fn(),cancelPermissionNotification:vi.fn()}));
vi.mock('../src/main/agent-options',()=>({INTERACTIVE_TASK_TOOLS:[],buildAgentOptions:(p:any)=>p}));
vi.mock('../src/main/session-persistence-adapter',()=>({persistMaterializedSession:vi.fn(),recordCompactionSessionId:vi.fn()}));
vi.mock('../src/main/attachment-conversion',()=>({claimPromptAttachments:()=>({attachmentPaths:['/input.pdf'],convertRequests:[{sourcePath:'/input.pdf'}]}),stripFileConvertMarker:(p:string)=>p,convertAttachmentsToMarkdown:m.convert,appendAttachmentConversionSummary:(p:string)=>p}));
vi.mock('../src/main/path-validator',()=>({isAuthorizedSessionWorkspace:()=>true}));
vi.mock('../src/main/session-files',()=>({ensureSessionWorkingDirectory:async()=>'/workspace/session',ensureAskSessionWorkingDirectory:async()=>'/app/session'}));
vi.mock('../src/main/session-file-catalog',()=>({isSessionFileMutationTool:()=>false}));
vi.mock('../src/main/session-output-metadata',()=>({captureSessionOutputSnapshot:async()=>({}),recordSessionOutputProvenance:async()=>false}));
vi.mock('../src/main/memory-policy',()=>({getGlobalMemoryDirectory:()=>'/memory'}));
vi.mock('../src/main/officecli-runtime',()=>({filterOfficeSkillByRuntimeReadiness:async(s:any)=>s}));
vi.mock('../src/main/feishu-connection',()=>({filterFeishuSkillByConnectorReadiness:async(s:any)=>s,getFeishuConnectorManager:vi.fn()}));
vi.mock('../src/main/feishu-agent-authorization',()=>({createFeishuAgentAuthorizationHook:()=>async()=>({})}));
vi.mock('../src/main/persistence/model-usage-store',()=>({recordModelUsage:vi.fn()}));
import { sendMessage,abortActiveQuery } from '../src/main/query-runner';
import {sessionRuntime} from '../src/main/session-runtime';
describe('startup cancellation reproduction',()=>{
 it('waits for cancelled preparation and never starts the SDK',async()=>{
   let entered!:()=>void,release!:()=>void;const ready=new Promise<void>(r=>entered=r),gate=new Promise<void>(r=>release=r);
   m.convert.mockImplementation(async()=>{entered();await gate;return {converted:[],failed:[]}});
   m.query.mockImplementation(async function*(){yield {type:'result',subtype:'success',uuid:'r1',result:'done'}});
   const window:any={isDestroyed:()=>false,webContents:{send:vi.fn()}};
   const task=sendMessage(window,{prompt:'convert',appSessionId:'new-stop',context:'editor',workspacePath:'/workspace'});
   await ready;expect(m.query).not.toHaveBeenCalled();abortActiveQuery('new-stop');
   let stopped = false;
   const stopping=sessionRuntime.abortWorkspaceAndWait('/workspace').then(ids=>{stopped=true;return ids});
   await Promise.resolve();expect(stopped).toBe(false);
   release();await task;await expect(stopping).resolves.toEqual(['new-stop']);expect(m.query).not.toHaveBeenCalled();
 });
});
