if (process.env.ZCODE_ENABLE_LEGACY_EXPERIMENT !== '1') throw new Error('Archived, unauthenticated experiment. Read experiments/zcode-cli/README.md before explicitly enabling it.');
const path = require('node:path');
const {dependency} = require('../../sdk.cjs');
const {McpServer} = dependency('@modelcontextprotocol/sdk/server/mcp.js');
const {StdioServerTransport} = dependency('@modelcontextprotocol/sdk/server/stdio.js');
const {z} = dependency('zod');
const {ProtocolClient} = require('./protocol.cjs');
const {Controller} = require('./controller.cjs');
const state=path.resolve(process.env.ZCODE_BRIDGE_STATE || path.join(__dirname,'state'));
const roots=JSON.parse(process.env.ZCODE_BRIDGE_ALLOWED_ROOTS || '[]');
if(!Array.isArray(roots)||!roots.length)throw new Error('Configure ZCODE_BRIDGE_ALLOWED_ROOTS as a JSON array of authorized workspace directories.');
const controller=new Controller({state,roots,createClient:cwd=>new ProtocolClient({
  command:process.execPath,args:[path.join(__dirname,'native-runner.cjs'),'worker',cwd],env:{...process.env,ZCODE_BRIDGE_STATE:state},cwd
})});
const server=new McpServer({name:'zcode-bridge',version:'0.1.0'});
const modelShape={providerId:z.string().min(1),modelId:z.string().min(1),effort:z.string().min(1)};
const selection=({providerId,modelId,effort})=>({providerId,modelId,options:{reasoningLevel:effort}});
const result=value=>({content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value});
function register(name,description,shape,handler) {
  server.registerTool(name,{description,inputSchema:shape},async(args,extra)=>{
    try {return result(await handler(args,extra));}
    catch(error){return {isError:true,content:[{type:'text',text:error.message}]};}
  });
}
register('zcode_spawn','Dispatch an independent ZCode worker with explicit model and reasoning effort. Returns immediately after prompt acceptance. Use zcode_wait for event-driven completion, then inspect changed files yourself. No tools are allowed by default.',{
  workspace:z.string(),prompt:z.string().min(1),...modelShape,
  tools:z.array(z.enum(['Read','Glob','Grep','Bash','Edit','Write'])).default([])
},args=>controller.spawn({...args,model:selection(args)}));
register('zcode_send','Send a follow-up to a completed ZCode task using the same context and model.',{taskId:z.string(),prompt:z.string().min(1)},args=>controller.send(args.taskId,args.prompt));
register('zcode_wait','Wait for a task completion, failure or required input using pushed ZCode events. No GUI monitoring or background polling. A timeout leaves workers running; call wait again while doing other work. Does not wake an ended Codex chat.',{
  taskIds:z.array(z.string()).min(1).max(3),timeoutMs:z.number().int().min(0).max(55000).default(55000)
},(args,extra)=>controller.wait(args.taskIds,args.timeoutMs,{signal:extra.signal}));
register('zcode_status','Read cached local task results. Does not poll ZCode.',{taskId:z.string().optional()},args=>controller.status(args.taskId));
register('zcode_cancel','Request cancellation of an active worker; wait for its terminal event to confirm.',{taskId:z.string()},args=>controller.cancel(args.taskId));
register('zcode_models','List the authenticated ZCode models and each model\'s supported effort values.',{workspace:z.string()},args=>controller.models(args.workspace));
register('zcode_close','Release a finished worker process, keeping its result journal.',{taskId:z.string()},args=>controller.closeTask(args.taskId));
let shuttingDown=false;
async function shutdown(){if(shuttingDown)return;shuttingDown=true;await controller.close();await server.close();}
process.on('SIGINT',()=>shutdown().then(()=>process.exit(0)));
process.on('SIGTERM',()=>shutdown().then(()=>process.exit(0)));
process.stdin.on('end',()=>shutdown().then(()=>process.exit(0)));
server.connect(new StdioServerTransport()).catch(error=>{console.error(error.message);process.exitCode=1;});
