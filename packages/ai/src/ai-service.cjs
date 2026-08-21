"use strict";
const { validateSanitizedPackage } = require("./evidence-sanitizer.js");
const { routeEvidence, shouldEscalate } = require("./model-router.cjs");
const { validateAnalysis } = require("./response-validator.cjs");
const { consensus } = require("./consensus-engine.cjs");
const { NimGateway } = require("./nim-gateway.cjs");
const { AI_MODELS } = require("./config.cjs");

async function analyzeEvidence(input, dependencies) {
  const evidence = validateSanitizedPackage(input);
  const mode = evidence.mode || "ADAPTIVE";
  const initialRoute = routeEvidence(evidence.localAnalysis, mode);
  if (!initialRoute.call) return { status: "SKIPPED", reason: initialRoute.reason, consensus: consensus(evidence.localAnalysis, null), calls: [] };
  const gateway = dependencies && dependencies.gateway || new NimGateway();
  const calls = [];
  try {
    const raw = await gateway.analyze(evidence, initialRoute); calls.push(initialRoute.tier);
    let validated = validateAnalysis(raw, evidence);
    if (initialRoute.tier === "FAST" && shouldEscalate(evidence.localAnalysis.confidenceScore, validated)) {
      const route = { call: true, tier: "DEEP", model: AI_MODELS.DEEP };
      validated = validateAnalysis(await gateway.analyze(evidence, route), evidence); calls.push(route.tier);
    }
    return { status: "OK", route: calls[calls.length - 1], analysis: validated, consensus: consensus(evidence.localAnalysis, validated), calls };
  } catch (error) {
    return { status: "UNAVAILABLE", reason: error.name === "AbortError" ? "timeout" : "provider-or-validation-failure", consensus: consensus(evidence.localAnalysis, null), calls };
  }
}
module.exports = { analyzeEvidence };
