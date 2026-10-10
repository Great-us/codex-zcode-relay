'use strict';
const fs=require('node:fs');const path=require('node:path');
function setup(argv=process.argv.slice(2)) {
  const options={};for(let i=0;i<argv.length;i+=2){if(!['--workspace','--state','--out','--worker-id'].includes(argv[i])||!argv[i+1]||argv[i+1].startsWith('--'))throw Error('Usage: node setup.cjs --workspace ABSOLUTE_DIRECTORY [--state ABSOLUTE_DIRECTORY] [--out ABSOLUTE_DIRECTORY] [--worker-id NAME]');if(options[argv[i]])throw Error('Duplicate option');options[argv[i]]=argv[i+1];}
  const workspace=options['--workspace'];if(!workspace||!path.isAbsolute(workspace)||!fs.statSync(workspace).isDirectory())throw Error('--workspace must name an existing absolute directory');
  const state=options['--state']||path.join(__dirname,'runtime','state');const out=options['--out']||path.join(__dirname,'generated');for(const target of [state,out])if(!path.isAbsolute(target))throw Error('State and output directories must be absolute');
  const workerId=options['--worker-id']||'codex-desktop-relay';if(!/^[A-Za-z0-9_-]{1,80}$/.test(workerId))throw Error('Worker ID must contain only letters, digits, underscores or hyphens');
  const common={command:process.execPath,env:{ZCODE_RELAY_STATE:state}};const script=path.join(__dirname,'relay-mcp.cjs');
  const controller={...common,args:[script,'controller'],env:{...common.env,ZCODE_BRIDGE_ALLOWED_ROOTS:JSON.stringify([fs.realpathSync(workspace)])}};
  const worker={type:'stdio',...common,args:[script,'worker'],enabled:true,timeoutMs:2147483647};
  fs.mkdirSync(path.join(out,'profiles'),{recursive:true});
  fs.writeFileSync(path.join(out,'codex.mcp.json'),JSON.stringify({mcpServers:{'zcode-bridge':controller}},null,2)+'\n');
  fs.writeFileSync(path.join(out,'zcode.mcp.json'),JSON.stringify({mcpServers:{'codex-relay':worker}},null,2)+'\n');
  for(const name of fs.readdirSync(path.join(__dirname,'profiles')).filter(x=>x.endsWith('.md')))fs.copyFileSync(path.join(__dirname,'profiles',name),path.join(out,'profiles',name));
  const prompt=fs.readFileSync(path.join(__dirname,'templates','worker-prompt.txt'),'utf8').replaceAll('{{WORKER_ID}}',workerId);fs.writeFileSync(path.join(out,'worker-prompt.txt'),prompt);
  return {output:out,controllerConfig:path.join(out,'codex.mcp.json'),workerConfig:path.join(out,'zcode.mcp.json'),profiles:path.join(out,'profiles'),workerPrompt:path.join(out,'worker-prompt.txt'),state};
}
module.exports={setup};if(require.main===module){try{console.log(JSON.stringify(setup(),null,2));}catch(error){console.error(error.message);process.exitCode=1;}}
