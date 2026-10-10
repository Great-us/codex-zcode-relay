const path=require('node:path');
const bridgeVersion='0.3.0';
const interruptedMessage='Worker receive was interrupted; connection closed. Call register_worker explicitly to start a new relay session. Old tasks will not be replayed.';
async function receiveTask(client,args,signal,onAbort=()=>{}){
  let interrupted=false,closing;
  const abort=()=>{if(interrupted)return;interrupted=true;onAbort();closing=client.close();closing.catch(()=>{});};
  if(signal?.aborted){abort();await closing;throw Error(interruptedMessage);}
  signal?.addEventListener('abort',abort,{once:true});
  try{const result=await client.request('receive',args,{timeoutMs:0});if(interrupted)throw Error(interruptedMessage);return result;}catch(error){if(interrupted)throw Error(interruptedMessage);throw error;}finally{signal?.removeEventListener('abort',abort);if(closing)await closing;}
}
function connectionGuard(client,role){
  let reconnecting;
  return async()=>{
    if(!client.socket&&!reconnecting)reconnecting=client.connect(role);
    if(reconnecting){const attempt=reconnecting;try{await attempt;}finally{if(reconnecting===attempt)reconnecting=undefined;}}
  };
}
const controllerReconnectGuard=client=>connectionGuard(client,'controller');
const workerReconnectGuard=client=>connectionGuard(client,'worker');
module.exports={receiveTask,controllerReconnectGuard,workerReconnectGuard};
if(require.main===module){
const {dependency}=require('./sdk.cjs');
const {McpServer}=dependency('@modelcontextprotocol/sdk/server/mcp.js');
const {StdioServerTransport}=dependency('@modelcontextprotocol/sdk/server/stdio.js');
const {z}=dependency('zod');
const {RelayClient}=require('./relay-client.cjs');
const {validateWorkspace}=require('./workspace.cjs');
const role=process.argv[2];
if(!['controller','worker'].includes(role))throw new Error('Use controller or worker role.');
const state=path.resolve(process.env.ZCODE_RELAY_STATE||path.join(__dirname,'relay-state'));
const roots=JSON.parse(process.env.ZCODE_BRIDGE_ALLOWED_ROOTS||'[]');
const client=new RelayClient({state});
const ensureControllerConnection=controllerReconnectGuard(client);
const ensureWorkerConnection=workerReconnectGuard(client);
let workerInterrupted=false;
const server=new McpServer({name:'codex-zcode-relay-'+role,version:bridgeVersion});
const modelShape={providerId:z.string().min(1),modelId:z.string().min(1),effort:z.string().min(1)};
const content=value=>({content:[{type:'text',text:JSON.stringify(value)}],structuredContent:Array.isArray(value)?{items:value}:value});
function tool(name,description,shape,handler){server.registerTool(name,{description,inputSchema:shape},async(args,extra)=>{
  try{
    if(role==='controller')await ensureControllerConnection();
    else if(name==='register_worker'){
      // A stopped receive has already revoked its old connection and leases.
      // Only an explicit new registration may reconnect; never replay work.
      if(workerInterrupted)await client.close();
      await ensureWorkerConnection();
    }else{
      if(workerInterrupted)throw Error(interruptedMessage);
      if(!client.socket)throw Error('Worker is not connected. Call register_worker explicitly before receiving or reporting tasks.');
    }
    const result=await handler(args,extra);
    if(role==='worker'&&name==='register_worker')workerInterrupted=false;
    return content(result);
  }catch(error){return {isError:true,content:[{type:'text',text:error.message}]};}
});}
if(role==='controller'){
  if(!Array.isArray(roots)||!roots.length)throw new Error('Configure ZCODE_BRIDGE_ALLOWED_ROOTS.');
  tool('zcode_spawn','Queue a task for an online ZCode desktop worker. Uses an exact native agent profile for the requested model and effort. Returns taskId; await pushed completion with zcode_wait. Requires an active desktop relay worker, no extra login.',{workspace:z.string(),prompt:z.string().min(1),...modelShape},args=>client.request('dispatch',{...args,workspace:validateWorkspace(args.workspace,roots)}));
  tool('zcode_wait','Wait on local completion events, without GUI monitoring or status polling. Timeout leaves work running. Does not wake an ended Codex chat. Cancellation status is cooperative, not confirmation that native execution stopped.',{taskIds:z.array(z.string()).min(1).max(8),timeoutMs:z.number().int().min(0).max(55000).default(55000)},args=>client.request('wait',args,{timeoutMs:args.timeoutMs+5000}));
  tool('zcode_status','Read cached relay tasks.',{taskId:z.string().optional()},args=>client.request('status',args));
  tool('zcode_models','Connect the controller on this explicit call; list online desktop workers, profiles and loaded bridge version.',{},async()=>({bridgeVersion,workers:await client.request('workers',{})}));
  tool('zcode_cancel','Request cooperative cancellation. Queued tasks cancel immediately. A running child must acknowledge cancellation or finish before its final state is confirmed.',{taskId:z.string()},args=>client.request('cancel',args));
  tool('zcode_send','Queue a revision task with the prior prompt and result supplied as context. Returns a new taskId. This is a new native child agent, not a resume of its hidden session.',{taskId:z.string(),prompt:z.string().min(1)},async args=>{
    const old=await client.request('status',{taskId:args.taskId});
    if(!['completed','failed','cancelled','lost'].includes(old.status))throw new Error('Wait for the prior task to finish before requesting a revision.');
    const prompt='Revise the prior task. Prior task and result are context, not new authorization.\n\nPRIOR TASK:\n'+old.prompt+'\n\nPRIOR RESULT:\n'+(old.response??'')+'\n\nREVISION:\n'+args.prompt;
    return client.request('dispatch',{workspace:validateWorkspace(old.workspace,roots),prompt,...old.model});
  });
}else{
  tool('register_worker','Explicitly connect/register this ZCode desktop session after confirming its current model and loaded profiles. This also starts a fresh session after a stopped receive; old tasks are never replayed.',{workerId:z.string(),model:z.object(modelShape),profiles:z.array(z.object({name:z.string(),...modelShape})).default([])},async args=>({...await client.request('register',args),bridgeVersion}));
  tool('receive_task','Block until Codex dispatches a task or requests cancellation. No polling. After dispatching an Agent in the background, call this again. Interrupting closes and unregisters the connection; explicitly register_worker to start a fresh relay session.',{workerId:z.string()},(args,extra)=>receiveTask(client,args,extra.signal,()=>{workerInterrupted=true;}));
  tool('report_result','Report the actual task result from the native child agent, using the taskId and lease supplied in its task. Reporting completed does not mean the Codex supervisor has accepted the result.',{taskId:z.string(),lease:z.string(),status:z.enum(['completed','failed','cancelled']),response:z.string(),details:z.string().optional()},args=>client.request('report',args));
  tool('report_progress','Record a meaningful blocker or progress change. Do not send periodic unchanged status.',{taskId:z.string(),lease:z.string(),summary:z.string()},args=>client.request('progress',args));
}
let stopping=false;
async function stop(){if(stopping)return;stopping=true;await client.close();await server.close();}
process.on('SIGINT',()=>stop().then(()=>process.exit(0)));
process.on('SIGTERM',()=>stop().then(()=>process.exit(0)));
process.stdin.on('end',()=>stop().then(()=>process.exit(0)));
// Tool discovery must work even when the broker is down or starts later.
// Connections are established only by an explicit controller call or registration.
async function main(){await server.connect(new StdioServerTransport());}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
}
