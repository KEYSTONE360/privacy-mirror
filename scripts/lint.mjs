import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import vm from "node:vm";

const root = resolve(import.meta.dirname, "..");
const ignored = new Set(["dist", "node_modules", ".git", "work", "outputs"]);
const files = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if ([".js", ".cjs", ".mjs", ".json"].includes(extname(path))) files.push(path);
  }
}
await walk(root);
for (const path of files) {
  const source = await readFile(path, "utf8");
  const name = relative(root, path);
  if (extname(path) === ".json") JSON.parse(source);
  else if (extname(path) !== ".mjs") new vm.Script(source, { filename: name });
  if (/\beval\s*\(/.test(source)) throw new Error(`eval is forbidden: ${name}`);
  if (/nvapi-[A-Za-z0-9_-]{16,}/.test(source)) throw new Error(`NVIDIA secret detected: ${name}`);
  if (/https?:\/\/[^"']+\.js["']/.test(source)) throw new Error(`Remote JavaScript reference detected: ${name}`);
}
console.log(`Linted ${files.length} source and configuration files.`);
