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
    let validated = validateAnalysis(normalizeProviderResponse(raw, evidence), evidence);
    if (mode === "ADAPTIVE" && initialRoute.tier === "FAST" && shouldEscalate(evidence.localAnalysis.confidenceScore, validated)) {
      const route = { call: true, tier: "DEEP", model: AI_MODELS.DEEP };
      validated = validateAnalysis(normalizeProviderResponse(await gateway.analyze(evidence, route), evidence), evidence); calls.push(route.tier);
    }
    return { status: "OK", route: calls[calls.length - 1], analysis: validated, consensus: consensus(evidence.localAnalysis, validated), calls };
  } catch (error) {
    return { status: "UNAVAILABLE", reason: failureReason(error), consensus: consensus(evidence.localAnalysis, null), calls };
  }
}
function normalizeProviderResponse(value, evidence) {
  const source = value && typeof value === "object" ? value : {};
  const classificationText = String(source.classification || "AMBIGUOUS").toUpperCase();
  const classification = ["LIKELY_TRACKING", "POSSIBLE_TRACKING", "AMBIGUOUS", "LIKELY_BENIGN"].includes(classificationText)
    ? classificationText
    : classificationText.includes("BENIGN") ? "LIKELY_BENIGN"
      : classificationText.includes("LIKELY") && classificationText.includes("TRACK") ? "LIKELY_TRACKING"
        : classificationText.includes("TRACK") || classificationText.includes("FINGERPRINT") ? "POSSIBLE_TRACKING" : "AMBIGUOUS";
  const eventIds = new Set(evidence.events.map((event) => event.id));
  return {
    classification,
    aiConfidence: providerScore(source.aiConfidence, 50),
    benignPlausibility: providerScore(source.benignPlausibility, 50),
    evidenceStrength: providerScore(source.evidenceStrength, 50),
    recommendedActions: stringArray(source.recommendedActions),
    explanation: stringArray(source.explanation),
    uncertaintyReasons: stringArray(source.uncertaintyReasons),
    evidenceIds: stringArray(source.evidenceIds).filter((id) => eventIds.has(id))
  };
}
function providerScore(value, fallback) {
  if (typeof value === "string") {
    const mapped = { WEAK: 25, LOW: 25, MODERATE: 50, MEDIUM: 50, STRONG: 80, HIGH: 80 }[value.toUpperCase()];
    if (mapped) return mapped;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(100, numeric)) : fallback;
}
function stringArray(value) { return Array.isArray(value) ? value : typeof value === "string" ? [value] : []; }
function failureReason(error) {
  if (error && error.name === "AbortError") return "timeout";
  if (error && Number.isFinite(error.status)) return `provider-http-${error.status}`;
  const message = String(error && error.message || "");
  if (/classification|Confidence|Plausibility|evidenceStrength|evidence id|absolute claim|response must/i.test(message)) return "response-validation-failure";
  if (/JSON|content|stream/i.test(message)) return "response-format-failure";
  return "provider-or-validation-failure";
}
module.exports = { analyzeEvidence, failureReason, normalizeProviderResponse };
