import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const pairs = [['GhostFibers', 'a21ea04c-6c6a-458b-8ec6-49a5dc19fc55'], ['MagicRings', '5f95d8d1-ceed-41c5-b5d1-cfa59d256cfe']];
const attachmentRoot = process.argv[2];
if (!attachmentRoot) throw new Error('Pass the attachment directory to compare original shaders');
const extract = source => [...source.replace(/\r\n/g, '\n').matchAll(/const (vertex|fragment|vertexShader|fragmentShader) = \x60([\s\S]*?)\x60;/g)].map(match => [match[1], match[2]]);
for (const [name, folder] of pairs) {
  const actual = extract(await readFile(`apps/ui-effects/${name}.jsx`, 'utf8'));
  const expected = extract(await readFile(`${attachmentRoot}/${folder}/pasted-text.txt`, 'utf8'));
  assert.equal(actual.length, 2); assert.deepEqual(actual, expected);
  console.log(`${name}: vertex and fragment shaders exactly match supplied source`);
}
