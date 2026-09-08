"use strict";
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const envPath = path.join(root, ".env.local");

if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

if (!process.env.NVIDIA_API_KEY_FAST && !process.env.NVIDIA_API_KEY) {
  throw new Error("Add NVIDIA_API_KEY_FAST to .env.local before starting local AI");
}

process.env.PM_ALLOW_INSECURE_LOOPBACK = "1";
process.env.PM_PORT = process.env.PM_PORT || "8443";
require("../apps/analysis-server/server.cjs").startServer();
