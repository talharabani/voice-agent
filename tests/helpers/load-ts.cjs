const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
function load(file, dependencies = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, {
    exports, process: { env: {} }, console, AbortSignal, AbortController, ReadableStream, TextDecoder, TextEncoder, Response, setTimeout, clearTimeout,
    require: name => {
      if (name === 'server-only') return {};
      if (name in dependencies) return dependencies[name];
      if (name.startsWith('@/')) return load('src/' + name.slice(2) + '.ts', dependencies, globals);
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name) + '.ts', dependencies, globals);
      if (name === 'zod') return require('zod');
      throw new Error(`Unexpected dependency ${name}`);
    }, ...globals,
  });
  return exports;
}
module.exports = { load };
