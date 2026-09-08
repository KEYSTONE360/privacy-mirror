import { access, readFile, readdir } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const forbidden = [/nvapi-[A-Za-z0-9_-]{16,}/, /NVIDIA_API_KEY_[A-Z]+\s*=\s*[^<\s]/];

async function filesUnder(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path));
    else files.push(path);
  }
  return files;
}

async function requireFile(base, relativePath) {
  if (!relativePath) return;
  await access(resolve(base, relativePath));
}

for (const browser of ["chrome", "firefox"]) {
  const base = resolve(root, "dist", browser);
  const manifest = JSON.parse(await readFile(join(base, "manifest.json"), "utf8"));
  const references = [
    manifest.background && manifest.background.service_worker,
    ...(manifest.background && manifest.background.scripts || []),
    manifest.action && manifest.action.default_popup,
    manifest.side_panel && manifest.side_panel.default_path,
    manifest.sidebar_action && manifest.sidebar_action.default_panel,
    ...manifest.content_scripts.flatMap((item) => item.js || []),
    ...manifest.declarative_net_request.rule_resources.map((item) => item.path),
    "dashboard/index.html"
  ].filter(Boolean);
  for (const reference of references) await requireFile(base, reference);
  for (const path of await filesUnder(base)) {
    if (![".js", ".json", ".html", ".css"].includes(extname(path))) continue;
    const text = await readFile(path, "utf8");
    for (const pattern of forbidden) if (pattern.test(text)) throw new Error(`Secret-like value found in ${path.slice(root.length + 1)}`);
  }
  console.log(`${browser}: ${references.length} manifest/UI references and secret scan passed.`);
}
