const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');
const {createHash} = require('node:crypto');

const SUPPORTED_HASH = 'fad4c35c4c36ec210d8a06d3fa0e77de23c8545e2eb6ff90aea1eb38d1e6275f';
const SUPPORTED_VERSION = '0.16.9';
function replaceExactlyOnce(source, before, after) {
  if (source.split(before).length !== 2) throw new Error('ZCode adapter marker mismatch; update adapter before using this version.');
  return source.replace(before, after);
}
function prepare() {
  const install = process.env.ZCODE_BRIDGE_RESOURCES || path.join(os.homedir(), 'AppData/Local/Programs/ZCode/resources');
  const filename = path.join(install, 'glm/zcode.cjs');
  let source = fs.readFileSync(filename, 'utf8');
  const hash = createHash('sha256').update(source).digest('hex');
  if (hash !== SUPPORTED_HASH) throw new Error('Installed ZCode differs from the verified 0.16.9 bundle. Adapter stopped; do not bypass the version guard.');
  const state = path.resolve(process.env.ZCODE_BRIDGE_STATE || path.join(__dirname, 'state'));
  fs.mkdirSync(state, {recursive:true});
  const builtin = path.join(state, 'builtin.json');
  fs.copyFileSync(path.join(install, 'config/provider/zcode-builtin.json'), builtin);
  const personal = path.join(state, 'personal.json');
  if (!fs.existsSync(personal)) fs.writeFileSync(personal, '{"schemaVersion":1,"config":{}}');
  const userConfig = path.join(state, 'user.json');
  fs.writeFileSync(userConfig, JSON.stringify({features:{mcp:false,memory:false},plugins:{enabled:false},skills:{enabled:false},hooks:{}}));
  const env = {...process.env,
    ZCODE_BUILTIN_PROVIDER_CONFIG_FILE:builtin,
    ZCODE_PERSONAL_PROVIDER_CONFIG_FILE:personal,
    ZCODE_DATA_BASE_DIR:path.join(state,'account'),
    ZCODE_STORAGE_DIR:state,
    ZCODE_SESSION_DB_PATH:path.join(state,'sessions.sqlite'),
    ZCODE_LOG_DIR:path.join(state,'logs')
  };
  Object.assign(process.env,env);
  source = replaceExactlyOnce(source, 'Dqt();Ioc();async function Ioc()', 'Dqt();module.exports={bootstrap:()=>{JK();return GK}};async function Ioc()');
  source = replaceExactlyOnce(source, 'create:r(()=>Ykt(z),"create")', 'create:r(()=>Ykt(z,{standalone:{}}),"create")');
  source = replaceExactlyOnce(source, '...Wec(qec(Fe,n),rt.runtime.registryService,rt.configuredDefaultModelSelection),', '...Wec(qec(Fe,n),rt.runtime.registryService,rt.configuredDefaultModelSelection),providerRuntimeHeadersPort:rt.providerRuntimeHeadersPort,skipUserConfig:true,userConfigPath:process.env.ZCODE_BRIDGE_USER_CONFIG,');
  source = replaceExactlyOnce(source, 'let B=K0({env:e.env});g=await', 'let B=K0({env:e.env,skipUserConfig:true,cliOverrides:{features:{mcp:false}}});g=await');
  source = replaceExactlyOnce(source, 'cliOverrides:Gzo(e)', 'cliOverrides:{...Gzo(e),features:{mcp:false,memory:false,skill:false},plugins:{enabled:false},skills:{enabled:false},hooks:{enabled:false,events:{}}}');
  env.ZCODE_BRIDGE_USER_CONFIG = userConfig;
  process.env.ZCODE_BRIDGE_USER_CONFIG = userConfig;
  const adapted = new Module(filename,module);
  adapted.filename = filename;
  adapted.paths = Module._nodeModulePaths(path.dirname(filename));
  adapted._compile(source,filename);
  return {api:adapted.exports.bootstrap(),env,state,hash,version:SUPPORTED_VERSION};
}
module.exports = {prepare,replaceExactlyOnce,SUPPORTED_HASH,SUPPORTED_VERSION};
