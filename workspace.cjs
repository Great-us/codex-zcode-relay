const fs=require('node:fs');
const path=require('node:path');
function validateWorkspace(workspace,roots){
 if(!path.isAbsolute(workspace))throw Error('workspace must be an absolute path.');
 const target=fs.realpathSync(workspace);
 if(!fs.statSync(target).isDirectory())throw Error('workspace must be a directory.');
 if(!roots.some(root=>{const relative=path.relative(fs.realpathSync(root),target);return relative===''||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));}))throw Error('workspace is outside ZCODE_BRIDGE_ALLOWED_ROOTS.');
 return target;
}
module.exports={validateWorkspace};
