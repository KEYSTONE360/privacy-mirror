"use strict";
const Core = require("../../packages/core/src/privacy-mirror-core.js");

const ALLOWED_KEYS = new Set(["riskScore", "confidenceScore", "categories", "eventCounts", "clientVersion"]);
const ALLOWED_CATEGORIES = new Set(["canvas", "webgl", "environment", "digest", "token", "network", "navigation"]);

function validateMinimizedPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("payload must be an object");
  for (const key of Object.keys(value)) if (!ALLOWED_KEYS.has(key)) throw new Error(`field not allowed: ${key}`);
  const riskScore = numberInRange(value.riskScore, 0, 100, "riskScore");
  const confidenceScore = numberInRange(value.confidenceScore, 0, 100, "confidenceScore");
  const categories = Array.isArray(value.categories) ? [...new Set(value.categories.filter((item) => ALLOWED_CATEGORIES.has(item)))].slice(0, 8) : [];
  const eventCounts = {};
  if (value.eventCounts && typeof value.eventCounts === "object" && !Array.isArray(value.eventCounts)) {
    for (const [key, count] of Object.entries(value.eventCounts)) if (ALLOWED_CATEGORIES.has(key)) eventCounts[key] = numberInRange(count, 0, 10000, `eventCounts.${key}`);
  }
  return { riskScore, confidenceScore, categories, eventCounts, clientVersion: String(value.clientVersion || "unknown").slice(0, 20) };
}

function numberInRange(value, min, max, label) {
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${label} is invalid`);
  return Math.round(value);
}

function analyzeMinimizedPayload(input) {
  const payload = validateMinimizedPayload(input);
  const report = { riskScore: payload.riskScore, confidenceScore: payload.confidenceScore, categories: payload.categories };
  return {
    recommendation: Core.optimizeInterventions(report),
    counterfactuals: Core.INTERVENTIONS.map((item) => Core.counterfactual(report, item)),
    processedAt: Date.now(),
    retention: "none-at-application-layer"
  };
}

module.exports = { validateMinimizedPayload, analyzeMinimizedPayload, ALLOWED_KEYS };
