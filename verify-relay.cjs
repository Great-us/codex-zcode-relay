const assert=require('node:assert/strict');
const path=require('node:path');
const {createTempState,cleanupTempState}=require('./test/temp-state.cjs');
const {RelayClient}=require('./relay-client.cjs');
const {dependency}=require('./sdk.cjs');
const {Client}=dependency('@modelcontextprotocol/sdk/client/index.js');
const {StdioClientTransport}=dependency('@modelcontextprotocol/sdk/client/stdio.js');
async function open(role,state){
 const client=new Client({name:'relay-protocol-verifier-'+role,version:'1.0.0'});
 const transport=new StdioClientTransport({command:process.execPath,args:[path.join(__dirname,'relay-mcp.cjs'),role],env:{...process.env,ZCODE_RELAY_STATE:state,ZCODE_BRIDGE_ALLOWED_ROOTS:JSON.stringify([path.resolve(__dirname)])},stderr:'pipe'});
 transport.stderr?.on('data',data=>process.stderr.write(data));
 await client.connect(transport);return client;
}
async function call(client,name,args){const result=await client.callTool({name,arguments:args},undefined,{timeout:65000});if(result.isError)throw Error(result.content?.[0]?.text);return result.structuredContent??JSON.parse(result.content[0].text);}
async function main(){
 const state=createTempState('protocol');
 let controller,worker;const bootstrap=new RelayClient({state});
 try{
  await bootstrap.connect('controller');
  controller=await open('controller',state);worker=await open('worker',state);
  const model={providerId:'protocol-test',modelId:'fake-model',effort:'low'};
  const tools=await controller.listTools();assert.equal(tools.tools.length,6);
  await call(worker,'register_worker',{workerId:'protocol-test-worker',model,profiles:[{name:'fake-native-profile',...model}]});
  const delivery=call(worker,'receive_task',{workerId:'protocol-test-worker'});
  const task=await call(controller,'zcode_spawn',{workspace:path.resolve(__dirname),prompt:'Transport smoke: no model inference.',...model});
  const resultWait=call(controller,'zcode_wait',{taskIds:[task.taskId],timeoutMs:5000});
  const received=await delivery;assert.equal(received.taskId,task.taskId);assert.equal(received.profile.name,'fake-native-profile');
  await call(worker,'report_result',{taskId:received.taskId,lease:received.lease,status:'completed',response:'TRANSPORT_OK'});
  const result=await resultWait;assert.equal(result.jobs[0].response,'TRANSPORT_OK');assert.equal(result.jobs[0].status,'completed');
  const revision=await call(controller,'zcode_send',{taskId:task.taskId,prompt:'Revision transport smoke.'});assert.notEqual(revision.taskId,task.taskId);
  const cancel=await call(controller,'zcode_cancel',{taskId:revision.taskId});assert.equal(cancel.status,'cancelled');
  console.log(JSON.stringify({ok:true,kind:'MCP transport only, no actual model call',tools:tools.tools.map(x=>x.name),dispatchReceiveReportWait:'passed',revisionAndQueuedCancellation:'passed'}));
 }finally{
  await Promise.allSettled([controller?.close(),worker?.close(),bootstrap.close()]);
  // This unique state and PID belong only to this verifier.
  if(bootstrap.startedBrokerPid)try{process.kill(bootstrap.startedBrokerPid);}catch{}
  cleanupTempState(state);
 }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
