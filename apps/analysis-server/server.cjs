"use strict";
const fs = require("node:fs");
const https = require("node:https");
const http = require("node:http");
const { analyzeMinimizedPayload } = require("./server-lib.cjs");
const { analyzeEvidence } = require("../../packages/ai/src/ai-service.cjs");

const MAX_BODY_BYTES = 64 * 1024;

function send(res, status, body) {
  const encoded = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": encoded.length,
    "cache-control": "no-store, max-age=0",
    "pragma": "no-cache",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff"
  });
  res.end(encoded);
}

function handler(req, res) {
  if (req.method === "GET" && req.url === "/healthz") return send(res, 200, { ok: true });
  const aiRoutes = new Set(["/api/ai/analyze", "/api/ai/investigate", "/api/ai/research"]);
  const isLocalRoute = req.url === "/v1/analyze";
  const isAiRoute = aiRoutes.has(req.url);
  if (req.method !== "POST" || (!isLocalRoute && !isAiRoute)) return send(res, 404, { error: "not-found" });
  if (!String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json")) return send(res, 415, { error: "json-required" });
  let chunks = [];
  let size = 0;
  req.on("data", (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) { chunks = []; req.destroy(); }
    else chunks.push(chunk);
  });
  req.on("end", async () => {
    if (size > MAX_BODY_BYTES) return send(res, 413, { error: "payload-too-large" });
    try {
      const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      chunks = [];
      if (req.url === "/api/ai/research") input.mode = "RESEARCH";
      const result = isAiRoute ? await analyzeEvidence(input) : analyzeMinimizedPayload(input);
      send(res, 200, result);
    } catch (_) {
      chunks = [];
      send(res, 400, { error: "invalid-minimized-payload" });
    }
  });
}

function startServer() {
  const localLoopback = process.env.PM_ALLOW_INSECURE_LOOPBACK === "1";
  const certPath = process.env.PM_TLS_CERT_PATH;
  const keyPath = process.env.PM_TLS_KEY_PATH;
  if (!localLoopback && (!certPath || !keyPath)) throw new Error("PM_TLS_CERT_PATH and PM_TLS_KEY_PATH are required outside local loopback mode");
  const server = localLoopback
    ? http.createServer(handler)
    : https.createServer({ cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) }, handler);
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  const port = Number(process.env.PM_PORT || 8443);
  server.listen(port, "127.0.0.1", () => {
    if (localLoopback) process.stdout.write(`Privacy Mirror local AI ready on http://127.0.0.1:${port}\n`);
  });
  return server;
}

if (require.main === module) startServer();

module.exports = { handler, startServer };
