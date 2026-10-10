const {createRequire} = require('node:module');
const path = require('node:path');
function dependency(name) {
  try {return require(name);} catch (error) {
    const base = process.env.ZCODE_BRIDGE_SDK_BASE;
    if (!base) throw new Error('Install package dependencies or configure ZCODE_BRIDGE_SDK_BASE.');
    return createRequire(path.resolve(base))(name);
  }
}
module.exports = {dependency};
