const fs = require('node:fs');
const path = require('node:path');
const {EventEmitter} = require('node:events');
const {randomUUID} = require('node:crypto');

const TERMINAL = new Set(['completed','failed','cancelled','lost']);
function publicJob(job) {
  return {taskId:job.taskId,sessionId:job.sessionId,status:job.status,turn:job.turn,
    workspace:job.workspace,model:job.model,createdAt:job.createdAt,updatedAt:job.updatedAt,
    eventSeq:job.eventSeq,result:job.result ?? null,error:job.error ?? null,
    attention:job.attention ?? null};
}
function validateWorkspace(workspace, roots) {
  if (!path.isAbsolute(workspace)) throw new Error('workspace must be an absolute path.');
  const target = fs.realpathSync(workspace);
  if (!fs.statSync(target).isDirectory()) throw new Error('workspace must be a directory.');
  if (!roots.some(root=>{
    const relative = path.relative(fs.realpathSync(root),target);
    return relative === '' || (!relative.startsWith('..'+path.sep) && relative !== '..' && !path.isAbsolute(relative));
  })) throw new Error('workspace is outside ZCODE_BRIDGE_ALLOWED_ROOTS.');
  return target;
}
function assertModel(snapshot, model) {
  const option = snapshot.settings.model.available.find(item=>item.ref.providerId===model.providerId && item.ref.modelId===model.modelId);
  if (!option) throw new Error('Requested model is unavailable in the authenticated ZCode registry. Call zcode_models.');
  const effort = model.options?.reasoningLevel;
  if (effort && !option.reasoning?.levels.some(level=>level.value===effort)) throw new Error('Requested effort is unavailable for this model. Call zcode_models.');
}
class Controller extends EventEmitter {
  constructor({createClient,roots,state,maxActive=3}) {
    super(); this.createClient=createClient;this.roots=roots;this.state=state;this.maxActive=maxActive;this.jobs=new Map();this.closed=false;
    this.journal=path.join(state,'jobs');fs.mkdirSync(this.journal,{recursive:true});
    // A disconnected worker is never silently relaunched or reported as completed.
    for (const entry of fs.readdirSync(this.journal)) {
      if (!/^[a-f0-9-]+\.json$/.test(entry)) continue;
      try {const job=JSON.parse(fs.readFileSync(path.join(this.journal,entry),'utf8'));
        if (!TERMINAL.has(job.status)) {job.status='lost';job.error='Bridge restarted; the old worker is unavailable. Re-dispatch explicitly.';}
        this.jobs.set(job.taskId,job);
      } catch { /* An incomplete journal entry is not a runnable task. */ }
    }
  }
  persist(job) {
    job.updatedAt=new Date().toISOString();
    const filename=path.join(this.journal,job.taskId+'.json'),temporary=filename+'.tmp';
    fs.writeFileSync(temporary,JSON.stringify(publicJob(job),null,2));fs.renameSync(temporary,filename);
    this.emit('change',job.taskId);
  }
  get(id) {const job=this.jobs.get(id);if(!job)throw new Error('Unknown ZCode task ID.');return job;}
  status(id) {return id?publicJob(this.get(id)):{tasks:[...this.jobs.values()].map(publicJob)};}
  activeCount() {return [...this.jobs.values()].filter(job=>!TERMINAL.has(job.status)&&job.status!=='idle').length;}
  event(job,event) {
    if (event.sessionId!==job.sessionId || event.seq<=job.eventSeq) return;
    job.eventSeq=event.seq;
    if (event.type==='turn.started') {job.turnId=event.turnId;job.status='running';}
    if (event.type==='turn.completed') {
      const result=event.payload;
      job.result={response:result.response,resultType:result.resultType,tokenCount:result.tokenCount,
        toolCallCount:result.toolCallCount,durationMs:result.duration};
      job.status=result.resultType==='success'?'completed':result.resultType==='cancelled'?'cancelled':'failed';
      if(job.status==='failed')job.error=result.resultType;
      job.attention=null;
    }
    if (event.type==='turn.failed') {job.status='failed';job.error=event.payload.error?.message ?? 'ZCode turn failed.';job.attention=null;}
    if (event.type==='userInput.requested' || event.type==='permission.requested') {
      job.attention={type:event.type,reason:'Worker requested interactive input. This bridge does not approve actions automatically.'};
    }
    // Only lifecycle/attention is journaled; streaming output is not repeatedly written.
    if (['turn.started','turn.completed','turn.failed','userInput.requested','permission.requested'].includes(event.type)) this.persist(job);
  }
  bind(job,client) {
    job.client=client;
    client.on('event',event=>this.event(job,event));
    client.on('hostRequest',message=>{
      if (message.method==='session/requestRuntimePreferences')return;
      job.attention={type:message.method,reason:'Host interaction is unavailable; no action was automatically authorized.'};this.persist(job);
    });
    client.on('closed',()=>{
      job.client=null;
      if (!TERMINAL.has(job.status)) {job.status='lost';job.error='ZCode worker disconnected before completion.';this.persist(job);}
    });
  }
  async spawn({workspace,prompt,model,tools=[]}) {
    if(this.closed)throw new Error('Bridge is closing.');
    if(this.activeCount()>=this.maxActive)throw new Error('ZCode concurrency limit reached. Wait for an active task.');
    if([...this.jobs.values()].filter(job=>job.client).length>=6)throw new Error('Six worker contexts are open. Close a finished task before creating another.');
    if(this.jobs.size>=100)throw new Error('Task journal limit reached. Start a new bridge state directory before dispatching more tasks.');
    const directory=validateWorkspace(workspace,this.roots);
    const job={taskId:randomUUID(),workspace:directory,model,status:'starting',turn:0,eventSeq:0,createdAt:new Date().toISOString()};
    this.jobs.set(job.taskId,job);this.persist(job);
    const client=this.createClient(directory);this.bind(job,client);
    try {
      const snapshot=await client.request('session/create',{
        workspace:{workspacePath:directory,workspaceKey:'codex-zcode:'+job.taskId},
        mode:'build',persistence:'deferred',titleGenerationEnabled:false,
        mcpServers:[],toolAllowlist:tools.length?tools:['__no_tools__'],
        offPeakToolEnabled:false,dynamicWorkflowEnabled:false
      });
      job.sessionId=snapshot.session.sessionId;
      assertModel(snapshot,model);
      await client.request('session/setModel',{sessionId:job.sessionId,model,persistAsWorkspaceLastUsed:false});
      const replay=await client.request('session/subscribe',{sessionId:job.sessionId,deliveryKind:'web-remote-replayable',afterSeq:0,includeSnapshot:false});
      for (const event of replay.events??[])this.event(job,event);
      job.eventSeq=Math.max(job.eventSeq,replay.eventSeq??0);
      await this.send(job.taskId,prompt);
      return publicJob(job);
    } catch(error) {
      job.status='failed';job.error=error.message;this.persist(job);await client.close();throw error;
    }
  }
  async send(id,prompt,model) {
    const job=this.get(id);
    if(!job.client)throw new Error('Worker is unavailable. Create a new task.');
    if(['running','waiting','cancelling'].includes(job.status))throw new Error('Task already has an active turn.');
    if(this.activeCount()>=this.maxActive && job.status!=='starting')throw new Error('ZCode concurrency limit reached.');
    if(model) {
      const snapshot=await job.client.request('session/read',{sessionId:job.sessionId});assertModel(snapshot,model);
      await job.client.request('session/setModel',{sessionId:job.sessionId,model,persistAsWorkspaceLastUsed:false});job.model=model;
    }
    job.turn+=1;job.status='running';job.result=null;job.error=null;job.attention=null;job.turnId=null;this.persist(job);
    try {await job.client.request('session/send',{sessionId:job.sessionId,inputId:randomUUID(),content:prompt});}
    catch(error) {if(!TERMINAL.has(job.status)){job.status='failed';job.error=error.message;this.persist(job);}throw error;}
    return publicJob(job);
  }
  async wait(ids,timeoutMs=55000,{signal}={}) {
    for(const id of ids)this.get(id);
    const read=()=>ids.map(id=>publicJob(this.get(id)));
    const ready=()=>read().some(job=>TERMINAL.has(job.status)||job.attention);
    if(ready())return {timedOut:false,tasks:read()};
    if(signal?.aborted)throw new Error('Wait cancelled. Worker continues until zcode_cancel.');
    return new Promise((resolve,reject)=>{
      let timer;
      const cleanup=()=>{clearTimeout(timer);this.off('change',changed);signal?.removeEventListener('abort',abort);};
      const finish=timedOut=>{cleanup();resolve({timedOut,tasks:read()});};
      const changed=id=>{if(ids.includes(id)&&ready())finish(false);};
      const abort=()=>{cleanup();reject(new Error('Wait cancelled. Worker continues until zcode_cancel.'));};
      this.on('change',changed);signal?.addEventListener('abort',abort,{once:true});
      timer=setTimeout(()=>finish(true),Math.min(55000,Math.max(0,timeoutMs)));
      // Avoid a completion between the initial check and event registration.
      if(ready())finish(false);
    });
  }
  async cancel(id) {
    const job=this.get(id);
    if(TERMINAL.has(job.status))return publicJob(job);
    if(!job.client)throw new Error('Worker is unavailable.');
    job.status='cancelling';this.persist(job);
    await job.client.request('session/stop',{sessionId:job.sessionId});
    return publicJob(job); // Completion/cancellation event confirms the final state.
  }
  async closeTask(id) {
    const job=this.get(id);
    if(!TERMINAL.has(job.status))throw new Error('Cancel or wait for the active task before closing it.');
    if(job.client){const client=job.client;job.client=null;await client.request('session/close',{sessionId:job.sessionId}).catch(()=>{});await client.close();}
    return publicJob(job);
  }
  async models(workspace) {
    const directory=validateWorkspace(workspace,this.roots),client=this.createClient(directory);
    try {const snapshot=await client.request('session/create',{workspace:{workspacePath:directory,workspaceKey:'codex-zcode-models:'+randomUUID()},persistence:'deferred',titleGenerationEnabled:false,mcpServers:[],toolAllowlist:['__no_tools__'],offPeakToolEnabled:false,dynamicWorkflowEnabled:false});
      await client.request('session/close',{sessionId:snapshot.session.sessionId});
      return {current:snapshot.settings.model.current,models:snapshot.settings.model.available.map(option=>({selection:option.ref,label:option.label,providerLabel:option.providerLabel,reasoning:option.reasoning}))};
    } finally {await client.close();}
  }
  async close() {this.closed=true;await Promise.all([...this.jobs.values()].map(async job=>{if(job.client){const client=job.client;job.client=null;await client.close();}}));}
}
module.exports={Controller,publicJob,assertModel,validateWorkspace,TERMINAL};
