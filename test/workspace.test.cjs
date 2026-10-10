const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {validateWorkspace}=require('../workspace.cjs');
test('workspace allowlist resolves traversal and rejects neighboring directories and files',()=>{
 const root=path.resolve(__dirname,'..');
 assert.equal(validateWorkspace(root,[root]),fs.realpathSync(root));
 assert.equal(validateWorkspace(path.join(root,'test'),[root]),fs.realpathSync(path.join(root,'test')));
 assert.throws(()=>validateWorkspace(path.join(root,'..'),[root]),/outside/);
 assert.throws(()=>validateWorkspace(path.join(root,'relay-mcp.cjs'),[root]),/directory/);
 assert.throws(()=>validateWorkspace('relative',[root]),/absolute/);
});
