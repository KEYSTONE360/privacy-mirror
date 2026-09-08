import { readFile } from 'node:fs/promises';
const mapping = [
  ...['api/_response.js','api/healthz.js','api/ai/analyze.js','api/ai/research.js','vercel.json','packages/core/src/privacy-mirror-core.js','packages/ai/src/ai-service.cjs','packages/ai/src/evidence-sanitizer.js','packages/ai/src/model-router.cjs','packages/ai/src/nim-gateway.cjs','packages/ai/src/config.cjs','packages/ai/src/prompts.cjs','packages/ai/src/response-validator.cjs','packages/ai/src/consensus-engine.cjs'].map(path => [path,path]),
  ...['index.html','app.js','connection.js','styles.css','history.css','refinements.css'].map(name => [`dist/dashboard/${name}`,`dashboard/${name}`]),
  ...['effects.js','effects.css'].map(name => [`dist/effects/${name}`,`effects/${name}`]),
  ['test-pages/tracking-stress-lab.html','test-pages/tracking-stress-lab.html']
];
const index = Number(process.argv[2]);
if (!Number.isInteger(index) || !mapping[index]) throw new Error('invalid file index');
const [path,file] = mapping[index];
const data = await readFile(path, 'utf8');
if (/nvapi-[A-Za-z0-9_-]{16,}/.test(data)) throw new Error('secret-like content');
const offset = Number(process.argv[3] || 0);
process.stdout.write(JSON.stringify({file,data:data.slice(offset, offset + 20000),total:data.length}).replace(/[\u007f-\uffff]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')));
