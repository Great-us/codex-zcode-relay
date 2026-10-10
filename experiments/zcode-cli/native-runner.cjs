const {prepare} = require('./native-bundle.cjs');
async function main() {
  const {api,env,version} = prepare();
  const command = process.argv[2];
  if (command === 'login') {
    // Native OAuth performs its own token exchange and encrypted credential writes.
    // No tokens, cookies, API keys or OAuth state are logged by this adapter.
    const result = await api.loginBigmodelCodingPlan({env,timeoutMs:300000,
      onAuthorizeUrl:()=>console.error('Complete the official BigModel authorization in the browser.'),
      onBrowserOpen:()=>console.error('Official authorization browser opened.')});
    console.log(JSON.stringify({loggedIn:true,providerId:result.providerId,model:result.model}));
    return;
  }
  if (command === 'diagnose') {
    const configured = await api.hasConfiguredStandaloneCodingPlan({env});
    let runtime;
    try {
      runtime = await api.startProcessProviderRegistryRuntime(env,{standalone:{}});
      const registry = runtime.runtime.registryService.getSnapshot().registry;
      console.log(JSON.stringify({version,configured,providerCount:registry.providers.length,
        modelCount:registry.models?.length ?? null},null,2));
    } finally {runtime?.dispose();}
    return;
  }
  if (!['worker','inspect'].includes(command)) throw new Error('Use login, diagnose, inspect or worker.');
  if (command==='worker' && !(await api.hasConfiguredStandaloneCodingPlan({env}))) throw new Error('ZCODE_LOGIN_REQUIRED: Run native-runner.cjs login once. Desktop login is separate.');
  console.log = (...args)=>console.error(...args);
  await api.runZCodeProtocolAgent({env,version,cwd:process.argv[3],presentationSurface:'terminal'});
}
main().then(()=>{process.exitCode=0;},err=>{console.error(err.message);process.exitCode=1;});
