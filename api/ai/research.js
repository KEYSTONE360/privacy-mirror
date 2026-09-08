"use strict";
const { analyzeEvidence } = require("../../packages/ai/src/ai-service.cjs");
const { send, validBody } = require("../_response.js");
module.exports = async function research(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "method-not-allowed" });
  try { const input = validBody(req); input.mode = "RESEARCH"; return send(res, 200, await analyzeEvidence(input)); }
  catch (error) { return send(res, error && error.message === "payload-too-large" ? 413 : 400, { error: "invalid-minimized-payload" }); }
};
