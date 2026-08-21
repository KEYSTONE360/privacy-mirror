import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");

async function copy(source, target) {
  await mkdir(dirname(target), { recursive: true });
  await cp(resolve(root, source), resolve(dist, target), { recursive: true });
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const browser of ["chrome", "firefox"]) {
  await copy(`apps/${browser}/manifest.json`, `${browser}/manifest.json`);
  await copy("apps/extension-shared/main-world.js", `${browser}/main-world.js`);
  await copy("apps/extension-shared/bridge.js", `${browser}/bridge.js`);
  await copy("apps/extension-shared/background.js", `${browser}/background.js`);
  await copy("apps/extension-shared/sidepanel.html", `${browser}/sidepanel.html`);
  await copy("apps/extension-shared/sidepanel.css", `${browser}/sidepanel.css`);
  await copy("apps/extension-shared/sidepanel.js", `${browser}/sidepanel.js`);
  await copy("apps/extension-shared/rules", `${browser}/rules`);
  await copy("packages/core/src/privacy-mirror-core.js", `${browser}/core/privacy-mirror-core.js`);
  await copy("packages/ai/src/evidence-sanitizer.js", `${browser}/ai/evidence-sanitizer.js`);
  await copy(`packages/browser-adapter/src/${browser}-adapter.js`, `${browser}/adapters/${browser}-adapter.js`);
}
await copy("apps/dashboard", "dashboard");
await writeFile(resolve(dist, "BUILD_INFO.json"), JSON.stringify({ version: "0.1.0", reproducible: true, generatedAt: "not-recorded" }, null, 2));

const forbidden = ["nvapi-", "api_key =", "api_key="];
for (const path of ["chrome/manifest.json", "firefox/manifest.json", "dashboard/app.js"]) {
  const text = (await readFile(resolve(dist, path), "utf8")).toLowerCase();
  for (const marker of forbidden) if (text.includes(marker)) throw new Error(`Secret-like marker found in dist/${path}`);
}
console.log("Built Chrome, Firefox, and dashboard artifacts in dist/.");
