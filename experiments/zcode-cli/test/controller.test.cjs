const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Controller,validateWorkspace}=require('../controller.cjs');
const model={providerId:'test',modelId:'test-model',options:{reasoningLevel:'low'}};
class FakeClient extends EventEmitter {
  constructor(){super();this.calls=[];this.seq=0;this.closed=false;this.behavior='complete';}
  emitEvent(type,payload){this.emit('event',{sessionId:'owned-session',eventId:'event-'+(++this.seq),seq:this.seq,type,payload});}
  async request(method,params){this.calls.push({method,params});
    if(method==='session/create'||method==='session/read')return {session:{sessionId:'owned-session'},settings:{model:{available:[{ref:{providerId:'test',modelId:'test-model'},reasoning:{levels:[{value:'low'}]}}]}}};
    if(method==='session/subscribe')return {eventSeq:0,events:[]};
    if(method==='session/send'){this.emitEvent('turn.started',{});if(this.behavior==='complete')this.emitEvent('turn.completed',{response:'323',resultType:'success',tokenCount:4,toolCallCount:0,duration:10});}
    if(method==='session/stop')this.emitEvent('turn.completed',{response:'',resultType:'cancelled',tokenCount:0,toolCallCount:0,duration:10});
    return {};
  }
  async close(){this.closed=true;this.emit('closed',new Error('closed'));}
}
function setup(t,behavior='complete'){
  const testRoot=path.resolve(__dirname,'../../../runtime/test/legacy-controller');fs.mkdirSync(testRoot,{recursive:true});
  const dir=fs.mkdtempSync(path.join(testRoot,'case-'));let client;
  const controller=new Controller({state:dir,roots:[dir],createClient:()=>{client=new FakeClient();client.behavior=behavior;return client;}});
  t.after(async()=>{await controller.close();if(path.dirname(dir)!==testRoot)throw new Error('Unsafe test cleanup path');fs.rmSync(dir,{recursive:true,force:true});});
  return {controller,dir,client:()=>client};
}
test('completion before send response is retained and duplicate events cannot change result',async t=>{
  const s=setup(t),job=await s.controller.spawn({workspace:s.dir,prompt:'17*19',model});
  assert.equal(job.status,'completed');assert.equal(job.result.response,'323');
  s.client().emit('event',{sessionId:job.sessionId,seq:1,type:'turn.failed',payload:{error:{message:'duplicate'}}});
  const waited=await s.controller.wait([job.taskId],1000);assert.equal(waited.timedOut,false);assert.equal(waited.tasks[0].status,'completed');
  assert.deepEqual(s.client().calls.find(x=>x.method==='session/create').params.toolAllowlist,['__no_tools__']);
});
test('wait wakes on a pushed event and does not issue status requests',async t=>{
  const s=setup(t,'pending'),job=await s.controller.spawn({workspace:s.dir,prompt:'work',model});
  const before=s.client().calls.length,wait=s.controller.wait([job.taskId],1000);
  setImmediate(()=>s.client().emitEvent('turn.completed',{response:'done',resultType:'success'}));
  const result=await wait;assert.equal(result.tasks[0].result.response,'done');assert.equal(s.client().calls.length,before);
});
test('wait timeout leaves worker active; cancellation requires terminal event',async t=>{
  const s=setup(t,'pending'),job=await s.controller.spawn({workspace:s.dir,prompt:'work',model});
  assert.equal((await s.controller.wait([job.taskId],1)).timedOut,true);
  assert.equal(s.controller.status(job.taskId).status,'running');
  assert.equal((await s.controller.cancel(job.taskId)).status,'cancelled');
});
test('unsupported model or effort fails without prompt submission',async t=>{
  const s=setup(t);
  await assert.rejects(s.controller.spawn({workspace:s.dir,prompt:'work',model:{...model,options:{reasoningLevel:'unknown'}}}),/effort is unavailable/);
  assert.equal(s.client().calls.some(x=>x.method==='session/send'),false);assert.equal(s.client().closed,true);
});
test('follow-up reuses task and context; concurrent send is rejected',async t=>{
  const s=setup(t),job=await s.controller.spawn({workspace:s.dir,prompt:'first',model});
  s.client().behavior='pending';assert.equal((await s.controller.send(job.taskId,'second')).turn,2);
  await assert.rejects(s.controller.send(job.taskId,'third'),/active turn/);
  s.client().emit('closed',new Error('disconnected'));assert.equal(s.controller.status(job.taskId).status,'lost');
});
test('persisted in-progress jobs become lost on restart rather than silently resuming',async t=>{
  const s=setup(t,'pending'),job=await s.controller.spawn({workspace:s.dir,prompt:'work',model});
  const restarted=new Controller({state:s.dir,roots:[s.dir],createClient:()=>{throw new Error('must not auto-spawn');}});
  assert.equal(restarted.status(job.taskId).status,'lost');await restarted.close();
});
test('attention event wakes wait and the bridge never auto-approves',async t=>{
  const s=setup(t,'pending'),job=await s.controller.spawn({workspace:s.dir,prompt:'work',model});
  const wait=s.controller.wait([job.taskId],1000);s.client().emit('hostRequest',{method:'interaction/requestPermission'});
  assert.equal((await wait).tasks[0].attention.type,'interaction/requestPermission');
});
test('workspace containment checks reject traversal and resolve paths',t=>{
  const s=setup(t);assert.equal(validateWorkspace(s.dir,[s.dir]),fs.realpathSync(s.dir));
  assert.throws(()=>validateWorkspace(path.dirname(s.dir),[s.dir]),/outside/);assert.throws(()=>validateWorkspace('../',[s.dir]),/absolute/);
});
