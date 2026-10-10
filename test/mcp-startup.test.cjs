'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const {dependency}=require('../sdk.cjs');const {createTempState,cleanupTempState}=require('./temp-state.cjs');
test('worker MCP opens before broker; explicit registration recovers when controller starts',async()=>{
 const {Client}=dependency('@modelcontextprotocol/sdk/client/index.js');const {StdioClientTransport}=dependency('@modelcontextprotocol/sdk/client/stdio.js');
 const state=createTempState('lazy-startup');const workspace=path.resolve(__dirname,'..');let w,c,brokerPid;
 async function open(role){const client=new Client({name:'lazy-startup-'+role,version:'1.0.0'});const transport=new StdioClientTransport({command:process.execPath,args:[path.join(workspace,'relay-mcp.cjs'),role],env:{...process.env,ZCODE_RELAY_STATE:state,ZCODE_BRIDGE_ALLOWED_ROOTS:JSON.stringify([workspace])},stderr:'pipe'});transport.stderr?.on('data',d=>process.stderr.write(d));await client.connect(transport);return client;}
 const call=(client,name,args)=>client.callTool({name,arguments:args},undefined,{timeout:10000});const data=r=>r.structuredContent||JSON.parse(r.content[0].text);
 try{
  w=await open('worker');assert.equal(w.getServerVersion().version,'0.3.0');assert.equal((await w.listTools()).tools.length,4);
  assert.equal(fs.existsSync(path.join(state,'relay.json')),false);
  const model={providerId:'regression',modelId:'fake-model',effort:'low'};const registration={workerId:'worker',model,profiles:[]};
  const unavailable=await call(w,'register_worker',registration);assert.equal(unavailable.isError,true);assert.match(unavailable.content[0].text,/start the Codex controller first/);
  c=await open('controller');assert.equal(fs.existsSync(path.join(state,'relay.json')),false);
  const models=data(await call(c,'zcode_models',{}));assert.equal(models.bridgeVersion,'0.3.0');assert.deepEqual(models.workers,[]);
  brokerPid=JSON.parse(fs.readFileSync(path.join(state,'broker-info.json'),'utf8')).pid;
  const ready=await call(w,'register_worker',registration);assert.notEqual(ready.isError,true);
  const task=data(await call(c,'zcode_spawn',{workspace,prompt:'No real inference; lazy startup regression',...model}));
  const delivered=data(await call(w,'receive_task',{workerId:'worker'}));assert.equal(delivered.taskId,task.taskId);
  await call(w,'report_result',{taskId:delivered.taskId,lease:delivered.lease,status:'completed',response:'LAZY_STARTUP_OK'});
  assert.equal(data(await call(c,'zcode_wait',{taskIds:[task.taskId],timeoutMs:0})).jobs[0].response,'LAZY_STARTUP_OK');
 }finally{await Promise.allSettled([c?.close(),w?.close()]);if(brokerPid)try{process.kill(brokerPid);}catch(e){if(e.code!=='ESRCH')throw e;}cleanupTempState(state);}
});
