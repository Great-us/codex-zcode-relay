'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');const {RelayClient}=require('../relay-client.cjs');const {dependency}=require('../sdk.cjs');
const {createTempState,cleanupTempState}=require('./temp-state.cjs');
test('actual stdio MCP cancellation unregisters worker and fails in-flight job',async()=>{
 const {Client}=dependency('@modelcontextprotocol/sdk/client/index.js');const {StdioClientTransport}=dependency('@modelcontextprotocol/sdk/client/stdio.js');
 const state=createTempState('mcp-abort');const workspace=path.resolve(__dirname,'..');const bootstrap=new RelayClient({state});let c,w;
 async function open(role){const client=new Client({name:'abort-regression-'+role,version:'1.0.0'});const transport=new StdioClientTransport({command:process.execPath,args:[path.join(workspace,'relay-mcp.cjs'),role],env:{...process.env,ZCODE_RELAY_STATE:state,ZCODE_BRIDGE_ALLOWED_ROOTS:JSON.stringify([workspace])},stderr:'pipe'});transport.stderr?.on('data',data=>process.stderr.write(data));await client.connect(transport);return client;}
 async function call(client,name,args,options){const result=await client.callTool({name,arguments:args},undefined,{timeout:10000,...options});return result;}
 const data=result=>result.structuredContent||JSON.parse(result.content[0].text);
 try{
  await bootstrap.connect('controller');c=await open('controller');w=await open('worker');const model={providerId:'regression',modelId:'fake-model',effort:'low'};
  await call(w,'register_worker',{workerId:'worker',model,profiles:[]});const task=data(await call(c,'zcode_spawn',{workspace,prompt:'Cancellation protocol regression only',...model}));const delivered=data(await call(w,'receive_task',{workerId:'worker'}));assert.equal(delivered.taskId,task.taskId);
  const abort=new AbortController();const receiving=call(w,'receive_task',{workerId:'worker'},{signal:abort.signal});const rejected=assert.rejects(receiving);
  // Same-stream request ordering confirms the blocked receive has reached the server.
  await call(w,'report_progress',{taskId:task.taskId,lease:delivered.lease,summary:'Pending receive cancellation regression'});
  const final=call(c,'zcode_wait',{taskIds:[task.taskId],timeoutMs:3000});abort.abort();await rejected;const result=data(await final);assert.equal(result.timedOut,false);assert.equal(result.jobs[0].status,'failed');assert.equal(result.jobs[0].details.reason,'worker_lost');
  assert.deepEqual(data(await call(c,'zcode_models',{})).workers,[]);
  const before=await call(w,'receive_task',{workerId:'worker'});assert.equal(before.isError,true);assert.match(before.content[0].text,/Call register_worker explicitly/);
  const after=await call(w,'register_worker',{workerId:'worker',model,profiles:[]});assert.notEqual(after.isError,true);
  assert.equal(data(await call(c,'zcode_models',{})).workers.length,1);
  const dispatch=data(await call(c,'zcode_spawn',{workspace,prompt:'Fresh task after explicit registration',...model}));
  assert.notEqual(dispatch.taskId,task.taskId);const fresh=data(await call(w,'receive_task',{workerId:'worker'}));assert.equal(fresh.taskId,dispatch.taskId);
  assert.equal(data(await call(c,'zcode_status',{taskId:task.taskId})).status,'failed');
  const oldReport=await call(w,'report_result',{taskId:task.taskId,lease:delivered.lease,status:'completed',response:'Must not resurrect old work'});assert.equal(oldReport.isError,true);
  await call(w,'report_result',{taskId:fresh.taskId,lease:fresh.lease,status:'completed',response:'Fresh registration works'});
 }finally{await Promise.allSettled([c?.close(),w?.close(),bootstrap.close()]);if(bootstrap.startedBrokerPid)try{process.kill(bootstrap.startedBrokerPid);}catch(e){if(e.code!=='ESRCH')throw e;}cleanupTempState(state);}
});
