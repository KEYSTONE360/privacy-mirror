"use strict";
const CLASSIFICATIONS = new Set(["LIKELY_TRACKING", "POSSIBLE_TRACKING", "AMBIGUOUS", "LIKELY_BENIGN"]);
const FORBIDDEN_CLAIMS = /definitely transmitted|uniquely identified|sold the data|site is malicious|identity was exposed/i;

function validateAnalysis(value, evidencePackage) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("AI response must be an object");
  if (!CLASSIFICATIONS.has(value.classification)) throw new Error("classification is invalid");
  const eventIds = new Set(evidencePackage.events.map((event) => event.id));
  const actions = new Set(evidencePackage.protectionsAvailable.map((item) => item.action));
  const normalized = {
    classification: value.classification,
    aiConfidence: score(value.aiConfidence, "aiConfidence"),
    benignPlausibility: score(value.benignPlausibility, "benignPlausibility"),
    evidenceStrength: score(value.evidenceStrength, "evidenceStrength"),
    recommendedActions: arrayOfStrings(value.recommendedActions, 8).filter((item) => actions.has(item)),
    explanation: arrayOfStrings(value.explanation, 8),
    uncertaintyReasons: arrayOfStrings(value.uncertaintyReasons, 8),
    evidenceIds: arrayOfStrings(value.evidenceIds, 20)
  };
  if (normalized.evidenceIds.some((id) => !eventIds.has(id))) throw new Error("hallucinated evidence id");
  if (normalized.explanation.some((line) => FORBIDDEN_CLAIMS.test(line))) throw new Error("unsupported absolute claim");
  return normalized;
}
function score(value, name) { if (!Number.isFinite(value) || value < 0 || value > 100) throw new Error(`${name} is invalid`); return Math.round(value); }
function arrayOfStrings(value, max) { if (!Array.isArray(value)) return []; return value.filter((item) => typeof item === "string").map((item) => item.slice(0, 500)).slice(0, max); }
module.exports = { validateAnalysis };
