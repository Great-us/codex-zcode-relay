'use strict';
const fs=require('node:fs');const path=require('node:path');
const base=path.resolve(__dirname,'../runtime/test');const owned=new Map();
function createTempState(kind){
 if(!/^[a-z0-9-]+$/.test(kind))throw Error('Invalid temporary state kind');
 fs.mkdirSync(base,{recursive:true});const root=fs.mkdtempSync(path.join(base,'codex-zcode-relay-'+kind+'-'));const state=path.join(root,'state');
 owned.set(state,{root,realRoot:fs.realpathSync(root),realBase:fs.realpathSync(base)});return state;
}
function cleanupTempState(state){
 const entry=owned.get(state);if(!entry)throw Error('Refusing cleanup of an unowned temporary state');
 const {root,realRoot,realBase}=entry;
 if(path.resolve(state)!==path.join(root,'state')||path.dirname(root)!==base||!path.basename(root).startsWith('codex-zcode-relay-')||fs.lstatSync(root).isSymbolicLink()||fs.realpathSync(root)!==realRoot||path.dirname(realRoot)!==realBase)throw Error('Refusing cleanup outside the named temporary root');
 fs.rmSync(root,{recursive:true,force:true});owned.delete(state);
}
module.exports={createTempState,cleanupTempState};
