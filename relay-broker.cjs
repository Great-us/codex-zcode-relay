'use strict';
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const terminal = new Set(['completed', 'failed', 'cancelled']);
const match = (a,b) => a && b && a.providerId === b.providerId && a.modelId === b.modelId && (a.effort || '') === (b.effort || '');
class BrokerState extends EventEmitter {
  constructor(token) { super(); this.setMaxListeners(0); this.token=token; this.clients=new Map(); this.jobs=new Map(); }
  attach(id) { this.clients.set(id,{id,authenticated:false,worker:null}); }
  changed() { this.emit('change'); }
  client(id,role) { const c=this.clients.get(id); if(!c || !c.authenticated) throw Error('Authentication required'); if(role && c.role!==role) throw Error('Role not authorized'); return c; }
  worker(id,workerId) { const c=this.client(id,'worker'); if(!c.worker || (workerId && workerId!==c.worker.workerId)) throw Error('Unknown worker'); return c.worker; }
  view(j) { return {...j}; }
  finish(j,status,response,details) { j.status=status; j.response=response; if(details!==undefined) j.details=details; j.updatedAt=new Date().toISOString(); this.changed(); }
  deliver(id) {
    const w=this.worker(id); const cancellation=[...this.jobs.values()].find(j=>j.assignedWorkerId===w.workerId && j.status==='cancel_requested' && !j.cancelDelivered);
    if(cancellation) { cancellation.cancelDelivered=true; return {type:'cancel',taskId:cancellation.taskId,lease:cancellation.lease}; }
    const j=[...this.jobs.values()].find(j=>j.assignedWorkerId===w.workerId && j.status==='queued');
    if(!j) return null; j.status='running'; j.lease=crypto.randomUUID(); j.updatedAt=new Date().toISOString(); queueMicrotask(()=>this.changed()); return {type:'task',...this.view(j)};
  }
  async request(id,method,p={}) {
    if(typeof method!=='string'||!method||!p||typeof p!=='object'||Array.isArray(p))throw Error('Invalid request');
    if(method==='hello') { const c=this.clients.get(id); if(!c || p.token!==this.token || !['controller','worker'].includes(p.role)) throw Error('Authentication failed'); if(c.authenticated && c.role!==p.role) throw Error('Role already established'); c.authenticated=true; c.role=p.role; return {role:c.role,protocolVersion:1}; }
    const c=this.client(id);
    if(method==='register') {
      this.client(id,'worker'); if(typeof p.workerId!=='string'||!p.workerId||!p.model?.providerId||!p.model?.modelId||!Array.isArray(p.profiles)||p.profiles.some(x=>!x?.name||!x.providerId||!x.modelId)) throw Error('Invalid worker registration');
      if(c.worker && c.worker.workerId!==p.workerId) throw Error('Worker identity already established');
      if([...this.clients.values()].some(x=>x.id!==id&&x.worker?.workerId===p.workerId)) throw Error('Worker already online');
      c.worker={workerId:p.workerId,model:p.model,profiles:p.profiles,online:true}; this.changed(); return c.worker;
    }
    if(method==='workers') { this.client(id,'controller'); return [...this.clients.values()].filter(x=>x.worker).map(x=>x.worker); }
    if(method==='dispatch') {
      this.client(id,'controller'); if(typeof p.workspace!=='string'||!p.workspace||typeof p.prompt!=='string'||!p.prompt||!p.providerId||!p.modelId) throw Error('Invalid dispatch');
      const workers=[...this.clients.values()].filter(x=>x.worker).map(x=>x.worker);
      const w=workers.find(w=>match(w.model,p)||w.profiles.some(x=>match(x,p))); if(!w) throw Error('No online worker supports requested model and effort');
      const profile=w.profiles.find(x=>match(x,p)) || null; const taskId=crypto.randomUUID();
      this.jobs.set(taskId,{taskId,assignedWorkerId:w.workerId,status:'queued',workspace:p.workspace,prompt:p.prompt,model:{providerId:p.providerId,modelId:p.modelId,effort:p.effort},profile,createdAt:new Date().toISOString()}); this.changed(); return {taskId};
    }
    if(method==='receive') {
      this.worker(id,p.workerId); const available=this.deliver(id); if(available) return available;
      return new Promise((resolve,reject)=>{ let checking=false,settled=false;const check=()=>{if(checking||settled)return;checking=true;try {const next=this.deliver(id); if(next){settled=true;cleanup(); resolve(next);}}catch(e){settled=true;cleanup();reject(e);}finally{checking=false;}}; const cleanup=()=>{this.off('change',check);}; this.on('change',check); });
    }
    if(method==='report'||method==='progress') {
      const w=this.worker(id); const j=this.jobs.get(p.taskId); if(!j || j.assignedWorkerId!==w.workerId || !j.lease || p.lease!==j.lease) throw Error('Invalid task lease');
      if(method==='progress') { if(terminal.has(j.status)) throw Error('Task already finished'); if(typeof p.summary!=='string') throw Error('Invalid progress summary'); j.summary=p.summary; this.changed(); return {ok:true}; }
      if(!terminal.has(p.status)) throw Error('Invalid report status');
      if(terminal.has(j.status)) { if(j.status!==p.status || JSON.stringify(j.response)!==JSON.stringify(p.response)) throw Error('Conflicting duplicate report'); return {ok:true,duplicate:true}; }
      this.finish(j,p.status,p.response,p.details); return {ok:true};
    }
    if(method==='status') { this.client(id,'controller'); if(p.taskId){ const j=this.jobs.get(p.taskId); if(!j)throw Error('Unknown task');return this.view(j);} return {jobs:[...this.jobs.values()].map(j=>this.view(j))}; }
    if(method==='cancel') { this.client(id,'controller');const j=this.jobs.get(p.taskId);if(!j)throw Error('Unknown task'); if(j.status==='queued')this.finish(j,'cancelled','Cancelled before execution');else if(j.status==='running'){j.status='cancel_requested';this.changed();} return this.view(j); }
    if(method==='wait') {
      this.client(id,'controller'); if(!Array.isArray(p.taskIds)||!p.taskIds.length||p.taskIds.some(x=>!this.jobs.has(x)))throw Error('Unknown task');
      const ms=p.timeoutMs===undefined?55000:p.timeoutMs; if(!Number.isFinite(ms)||ms<0||ms>55000)throw Error('Invalid wait timeout');
      const ready=()=>p.taskIds.map(x=>this.jobs.get(x)).filter(j=>terminal.has(j.status)).map(j=>this.view(j));
      const found=ready(); if(found.length||ms===0)return {jobs:found,timedOut:!found.length};
      return new Promise((resolve,reject)=>{const cleanup=()=>{clearTimeout(timer);this.off('change',check);};const check=()=>{if(!this.clients.has(id)){cleanup();reject(Error('Client disconnected'));return;}const jobs=ready();if(jobs.length){cleanup();resolve({jobs,timedOut:false});}};const timer=setTimeout(()=>{cleanup();resolve({jobs:[],timedOut:true});},ms);this.on('change',check);});
    }
    throw Error('Unknown method');
  }
  disconnect(id) {const c=this.clients.get(id);this.clients.delete(id);if(c?.worker)for(const j of this.jobs.values())if(j.assignedWorkerId===c.worker.workerId&&!terminal.has(j.status)){j.status='failed';j.response='Worker disconnected';j.details={reason:'worker_lost'};}this.changed();}
}
async function metadata(state) {
  fs.mkdirSync(state,{recursive:true}); const file=path.join(state,'relay.json');
  const hash=crypto.createHash('sha256').update(path.resolve(state).toLowerCase()).digest('hex').slice(0,28);
  const data={endpoint:process.platform==='win32'?`\\\\.\\pipe\\zcode-relay-${hash}`:path.join(state,'relay.sock'),token:crypto.randomBytes(32).toString('hex'),protocolVersion:1};
  let wake; const watcher=fs.watch(state,()=>wake?.());
  try {try {fs.writeFileSync(file,JSON.stringify(data),{flag:'wx',mode:0o600});return data;}catch(e){if(e.code!=='EEXIST')throw e;}
    return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Broker metadata unavailable')),10000);wake=()=>{try{const existing=JSON.parse(fs.readFileSync(file,'utf8'));clearTimeout(timer);resolve(existing);}catch(e){if(!(e instanceof SyntaxError)&&e.code!=='ENOENT'){clearTimeout(timer);reject(e);}}};wake();});
  }finally{watcher.close();}
}
function lifecycle(state,event,fields={}) {fs.appendFileSync(path.join(state,'lifecycle.jsonl'),JSON.stringify({at:new Date().toISOString(),pid:process.pid,event,...fields})+'\n',{mode:0o600});}
async function serve(state,{ownerRole='controller'}={}) {
  if(!path.isAbsolute(state))throw Error('State path must be absolute');if(ownerRole!=='controller')throw Error('Only controller may own the broker');const info=await metadata(state); const broker=new BrokerState(info.token);let idle;
  const log=(event,fields)=>lifecycle(state,event,fields);
  const arm=()=>{clearTimeout(idle);if(!broker.clients.size)idle=setTimeout(()=>{log('idle_exit');server.close(()=>process.exit(0));},300000);};
  const server=net.createServer(socket=>{const id=crypto.randomUUID();broker.attach(id);log('connection',{connectionId:id});arm();let buffer='';socket.setEncoding('utf8');socket.on('error',e=>log('socket_error',{connectionId:id,code:e.code||'UNKNOWN'}));socket.on('close',hadError=>{log('disconnect',{connectionId:id,hadError});broker.disconnect(id);arm();});socket.on('data',chunk=>{buffer+=chunk;if(buffer.length>4*1024*1024){log('input_limit',{connectionId:id,bytes:Buffer.byteLength(buffer)});socket.destroy();return;}let split;while((split=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,split);buffer=buffer.slice(split+1);let req;try{req=JSON.parse(line);}catch{log('invalid_json',{connectionId:id});socket.write(JSON.stringify({id:null,error:{message:'Invalid JSON'}})+'\n');continue;}const validId=req && ((typeof req.id==='string'&&req.id.length>0)||(typeof req.id==='number'&&Number.isSafeInteger(req.id)));if(!req||typeof req!=='object'||Array.isArray(req)||!validId||typeof req.method!=='string'||!req.method||!req.params||typeof req.params!=='object'||Array.isArray(req.params)){log('invalid_envelope',{connectionId:id});socket.write(JSON.stringify({id:validId?req.id:null,error:{message:'Invalid request envelope'}})+'\n');continue;}const requestId=req.id;Promise.resolve().then(()=>broker.request(id,req.method,req.params)).then(result=>{if(!socket.destroyed)socket.write(JSON.stringify({id:requestId,result})+'\n');},error=>{if(!socket.destroyed)socket.write(JSON.stringify({id:requestId,error:{message:error.message}})+'\n');});}});});
  server.on('error',e=>{log('server_error',{code:e.code||'UNKNOWN'});if(e.code==='EADDRINUSE'){if(process.send)process.send({ready:true},()=>process.exit(0));else process.exit(0);}else{if(process.send)process.send({error:'Broker startup failed'},()=>process.exit(1));else process.exit(1);}});
  server.listen(info.endpoint,()=>{fs.writeFileSync(path.join(state,'broker-info.json'),JSON.stringify({pid:process.pid,ppid:process.ppid,startedAt:new Date().toISOString(),ownerRole}),{mode:0o600});log('server_listen',{ownerRole});arm();if(process.send)process.send({ready:true});}); return server;
}
module.exports={BrokerState,metadata,serve};
if(require.main===module){const at=process.argv.indexOf('--state'),ownerAt=process.argv.indexOf('--owner');if(process.argv[2]!=='serve'||at<0||ownerAt<0||process.argv[ownerAt+1]!=='controller')process.exit(2);const state=process.argv[at+1];const fatal=(event,error)=>{try{fs.mkdirSync(state,{recursive:true});lifecycle(state,event,{code:error?.code||'UNKNOWN',name:error?.name||'Error'});}finally{process.exit(1);}};process.on('uncaughtException',e=>fatal('uncaught_exception',e));process.on('unhandledRejection',e=>fatal('unhandled_rejection',e));serve(state,{ownerRole:'controller'}).catch(error=>{try{fs.mkdirSync(state,{recursive:true});lifecycle(state,'startup_error',{code:error?.code||'UNKNOWN',name:error?.name||'Error'});}finally{if(process.send)process.send({error:'Broker startup failed'},()=>process.exit(1));else process.exit(1);}});}
