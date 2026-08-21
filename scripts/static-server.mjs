import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
const base = resolve(process.argv[2] || "apps/dashboard");
const port = Number(process.argv[3] || 4173);
const types = { ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".json":"application/json" };
createServer(async (req,res)=>{try{const raw=(req.url||"/").split("?")[0];let path=resolve(base,`.${decodeURIComponent(raw)}`);if(path!==base&&!path.startsWith(base+sep))throw new Error("invalid path");if((await stat(path)).isDirectory())path=resolve(path,"index.html");const body=await readFile(path);res.writeHead(200,{"content-type":types[extname(path)]||"application/octet-stream","cache-control":"no-store"});res.end(body);}catch(_){res.writeHead(404);res.end("Not found");}}).listen(port,"127.0.0.1",()=>console.log(`Dashboard: http://127.0.0.1:${port}`));
