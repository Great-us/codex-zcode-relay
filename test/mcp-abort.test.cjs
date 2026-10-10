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
  assert.deepEqual(data(await call(c,'zcode_models',{})).workers,[]);const after=await call(w,'register_worker',{workerId:'worker',model,profiles:[]});assert.equal(after.isError,true);assert.match(after.content[0].text,/Reload the worker MCP/);
  const dispatch=await call(c,'zcode_spawn',{workspace,prompt:'Must not be ghost-delivered',...model});assert.equal(dispatch.isError,true);assert.match(dispatch.content[0].text,/No online worker/);
 }finally{await Promise.allSettled([c?.close(),w?.close(),bootstrap.close()]);if(bootstrap.startedBrokerPid)try{process.kill(bootstrap.startedBrokerPid);}catch(e){if(e.code!=='ESRCH')throw e;}cleanupTempState(state);}
});
